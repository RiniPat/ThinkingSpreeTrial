/**
 * Google Drive helpers for the Sales follow-up feature.
 *
 * Uploaded docs and generated Growth Prospects files are stored in the
 * consultant's own Google Drive via their existing OAuth (Drive scope already
 * granted) — there is no S3/object store. The DB keeps only references
 * (fileId + webViewLink) + extracted text, never the bytes.
 *
 * Google Docs the consultant links are READ via `files.export` as text/plain.
 */

import { google, type Auth } from "googleapis";
import { Readable } from "node:stream";
import { getAuthedClient } from "./google";

export const SALES_DRIVE_FOLDER_NAME =
  process.env.SALES_DRIVE_FOLDER_NAME?.trim() || "ThinkingSpree/Sales Follow-ups";

export async function driveFor(userId: number) {
  const client = await getAuthedClient(userId);
  if (!client) {
    throw new Error("Google isn't connected for this account. Open Settings → Google Connections and connect Drive access.");
  }
  return google.drive({ version: "v3", auth: client as Auth.OAuth2Client });
}

/** Extract a Google Docs / Drive file id from a URL (or return a bare id). */
export function extractDriveFileId(input: string): string | null {
  const s = (input ?? "").trim();
  if (!s) return null;
  if (/^[A-Za-z0-9_-]{20,}$/.test(s)) return s;
  const m =
    s.match(/\/document\/d\/([A-Za-z0-9_-]+)/) ||
    s.match(/\/(?:file|presentation|spreadsheets)\/d\/([A-Za-z0-9_-]+)/) ||
    s.match(/[?&]id=([A-Za-z0-9_-]+)/) ||
    s.match(/\/d\/([A-Za-z0-9_-]+)/);
  return m ? m[1] : null;
}

type Drive = Awaited<ReturnType<typeof driveFor>>;

/** Find (or create) a single child folder by name under `parentId` (root if null). */
async function ensureChildFolder(drive: Drive, name: string, parentId: string | null): Promise<string> {
  const safe = name.replace(/'/g, "\\'");
  const parentClause = parentId ? ` and '${parentId}' in parents` : " and 'root' in parents";
  const q = `mimeType='application/vnd.google-apps.folder' and name='${safe}' and trashed=false${parentClause}`;
  const found = await drive.files.list({ q, fields: "files(id)", pageSize: 1 });
  const hit = found.data.files?.[0]?.id;
  if (hit) return hit;
  const created = await drive.files.create({
    requestBody: { name, mimeType: "application/vnd.google-apps.folder", parents: parentId ? [parentId] : undefined },
    fields: "id",
  });
  if (!created.data.id) throw new Error("Failed to create Drive folder.");
  return created.data.id;
}

/** Resolve the nested destination folder "ThinkingSpree/Sales Follow-ups/<startup>". */
export async function ensureSalesFolder(drive: Drive, startup: string): Promise<string> {
  const parts = [...SALES_DRIVE_FOLDER_NAME.split("/").map((p) => p.trim()).filter(Boolean), startup.trim() || "Company"];
  let parent: string | null = null;
  for (const p of parts) parent = await ensureChildFolder(drive, p, parent);
  return parent as string;
}

export type UploadedRef = { fileId: string; webViewLink: string | null };

/** Store bytes in Drive under the sales folder; returns the fileId + link. */
export async function uploadToDrive(
  drive: Drive, folderId: string, filename: string, mimeType: string, buffer: Buffer,
): Promise<UploadedRef> {
  const created = await drive.files.create({
    requestBody: { name: filename, parents: [folderId] },
    media: { mimeType: mimeType || "application/octet-stream", body: Readable.from(buffer) },
    fields: "id,webViewLink",
  });
  if (!created.data.id) throw new Error("Failed to store the file in Drive.");
  return { fileId: created.data.id, webViewLink: created.data.webViewLink ?? null };
}

/** Read a Google Doc as plain text via export. Throws a clear message on 403/404. */
export async function readGoogleDocText(drive: Drive, fileId: string): Promise<string> {
  try {
    const res = await drive.files.export(
      { fileId, mimeType: "text/plain" },
      { responseType: "arraybuffer" },
    );
    const data = res.data as unknown as ArrayBuffer;
    return Buffer.from(new Uint8Array(data)).toString("utf8").trim();
  } catch (err: any) {
    const code = err?.response?.status ?? err?.code;
    if (code === 403) throw new Error("Couldn't open this doc — check it's shared with your Google account.");
    if (code === 404) throw new Error("Couldn't find this doc — check the link.");
    // Some links are uploaded (non-native) files, not Google Docs → export fails.
    throw new Error(err?.message || "Couldn't read this Google Doc.");
  }
}

/** Download a Drive file's bytes (for attaching stored docs to the email). */
export async function downloadDriveFile(drive: Drive, fileId: string): Promise<Buffer> {
  const res = await drive.files.get({ fileId, alt: "media" }, { responseType: "arraybuffer" });
  return Buffer.from(new Uint8Array(res.data as unknown as ArrayBuffer));
}

/** Best-effort delete (used to keep the follow-up folder clean on re-analyse). */
export async function deleteDriveFile(drive: Drive, fileId: string): Promise<void> {
  try { await drive.files.delete({ fileId }); } catch { /* orphan is acceptable */ }
}
