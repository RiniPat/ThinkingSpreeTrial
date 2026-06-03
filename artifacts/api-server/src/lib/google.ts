/**
 * Google OAuth + API client helpers.
 *
 * Uses the official `googleapis` npm package. Tokens are persisted in
 * the `google_tokens` table (one row per Thinking Spree user).
 *
 * ENV VARS required (see GOOGLE_INTEGRATION_SETUP.md):
 *   GOOGLE_CLIENT_ID
 *   GOOGLE_CLIENT_SECRET
 *   GOOGLE_REDIRECT_URI   (e.g. https://your-app.example.com/api/google/oauth/callback)
 *   APP_BASE_URL          (where to send the browser back after callback success)
 *
 * Each "scope group" below corresponds to one user-visible toggle in
 * Settings → Integrations.
 */
import { google, type Auth } from "googleapis";
import { db, googleTokensTable } from "@workspace/db";
import { eq } from "drizzle-orm";

export const SCOPE_GROUPS = {
  profile: [
    "openid",
    "https://www.googleapis.com/auth/userinfo.email",
    "https://www.googleapis.com/auth/userinfo.profile",
  ],
  calendar: ["https://www.googleapis.com/auth/calendar"],
  gmail: ["https://www.googleapis.com/auth/gmail.send", "https://www.googleapis.com/auth/gmail.readonly"],
  drive: ["https://www.googleapis.com/auth/drive.readonly", "https://www.googleapis.com/auth/drive.file"],
  sheets: ["https://www.googleapis.com/auth/spreadsheets"],
} as const;

export const ALL_SCOPES = [
  ...SCOPE_GROUPS.profile,
  ...SCOPE_GROUPS.calendar,
  ...SCOPE_GROUPS.gmail,
  ...SCOPE_GROUPS.drive,
  ...SCOPE_GROUPS.sheets,
];

export function isGoogleOAuthConfigured(): boolean {
  return Boolean(
    process.env.GOOGLE_CLIENT_ID &&
    process.env.GOOGLE_CLIENT_SECRET &&
    process.env.GOOGLE_REDIRECT_URI
  );
}

export function makeOAuthClient(): Auth.OAuth2Client {
  if (!isGoogleOAuthConfigured()) {
    throw new Error("Google OAuth not configured. Set GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI.");
  }
  return new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI,
  );
}

export function buildAuthUrl(state: string, scopes: string[] = ALL_SCOPES): string {
  const oAuth2 = makeOAuthClient();
  return oAuth2.generateAuthUrl({
    access_type: "offline",
    prompt: "consent", // forces a refresh_token even on re-auth
    scope: scopes,
    state,
    include_granted_scopes: true,
  });
}

/** Exchange the ?code= for tokens and persist them, then return the granted scope set. */
export async function exchangeCodeAndStore(userId: number, code: string) {
  const oAuth2 = makeOAuthClient();
  const { tokens } = await oAuth2.getToken(code);
  oAuth2.setCredentials(tokens);

  // Fetch user profile to display "Connected as foo@gmail.com"
  let googleEmail: string | null = null;
  let googleProfile: any = null;
  try {
    const oauth2 = google.oauth2({ auth: oAuth2, version: "v2" });
    const profile = await oauth2.userinfo.get();
    googleEmail = profile.data.email ?? null;
    googleProfile = profile.data;
  } catch {
    // non-fatal
  }

  const scopeStr = tokens.scope ?? "";
  const expiryDate = tokens.expiry_date ? new Date(tokens.expiry_date) : null;
  const flags = {
    hasCalendar: SCOPE_GROUPS.calendar.some(s => scopeStr.includes(s)) ? "yes" : null,
    hasGmail:    SCOPE_GROUPS.gmail.some(s => scopeStr.includes(s)) ? "yes" : null,
    hasDrive:    SCOPE_GROUPS.drive.some(s => scopeStr.includes(s)) ? "yes" : null,
    hasSheets:   SCOPE_GROUPS.sheets.some(s => scopeStr.includes(s)) ? "yes" : null,
  };

  const existing = await db.select().from(googleTokensTable).where(eq(googleTokensTable.userId, userId)).limit(1);
  if (existing.length > 0) {
    await db.update(googleTokensTable).set({
      accessToken:  tokens.access_token  ?? existing[0].accessToken,
      // refresh_token is only returned the first time unless prompt=consent — preserve it if not present
      refreshToken: tokens.refresh_token ?? existing[0].refreshToken,
      scope: scopeStr || existing[0].scope,
      tokenType: tokens.token_type ?? existing[0].tokenType,
      expiryDate: expiryDate ?? existing[0].expiryDate,
      ...flags,
      googleEmail: googleEmail ?? existing[0].googleEmail,
      googleProfile: googleProfile ?? existing[0].googleProfile,
      updatedAt: new Date(),
    }).where(eq(googleTokensTable.userId, userId));
  } else {
    await db.insert(googleTokensTable).values({
      userId,
      accessToken:  tokens.access_token  ?? null,
      refreshToken: tokens.refresh_token ?? null,
      scope: scopeStr,
      tokenType: tokens.token_type ?? null,
      expiryDate,
      ...flags,
      googleEmail,
      googleProfile,
    });
  }

  return { scope: scopeStr, googleEmail, flags };
}

export async function getStoredTokens(userId: number) {
  const [row] = await db.select().from(googleTokensTable).where(eq(googleTokensTable.userId, userId)).limit(1);
  return row ?? null;
}

/** Returns an OAuth2 client primed with the user's tokens, or null if disconnected. */
export async function getAuthedClient(userId: number): Promise<Auth.OAuth2Client | null> {
  const row = await getStoredTokens(userId);
  if (!row || !row.refreshToken) return null;
  const oAuth2 = makeOAuthClient();
  oAuth2.setCredentials({
    access_token: row.accessToken ?? undefined,
    refresh_token: row.refreshToken,
    scope: row.scope ?? undefined,
    token_type: row.tokenType ?? undefined,
    expiry_date: row.expiryDate?.getTime(),
  });
  // googleapis handles refresh automatically — but stash the new token back on refresh.
  oAuth2.on("tokens", (t) => {
    db.update(googleTokensTable).set({
      accessToken: t.access_token ?? row.accessToken,
      expiryDate: t.expiry_date ? new Date(t.expiry_date) : row.expiryDate,
      updatedAt: new Date(),
    }).where(eq(googleTokensTable.userId, userId)).catch(() => { /* swallow */ });
  });
  return oAuth2;
}

export async function disconnect(userId: number) {
  await db.delete(googleTokensTable).where(eq(googleTokensTable.userId, userId));
}

// ─── Per-service connection tests ─────────────────────────────────────────
// Each returns { ok, message?, detail? }. Tests should be CHEAP (one read).

export async function testCalendar(client: Auth.OAuth2Client) {
  const cal = google.calendar({ version: "v3", auth: client });
  const r = await cal.calendarList.list({ maxResults: 1 });
  return { ok: true, detail: `Found ${r.data.items?.length ?? 0} calendar(s)` };
}

export async function testGmail(client: Auth.OAuth2Client) {
  const gmail = google.gmail({ version: "v1", auth: client });
  const r = await gmail.users.getProfile({ userId: "me" });
  return { ok: true, detail: `Mailbox: ${r.data.emailAddress}` };
}

export async function testDrive(client: Auth.OAuth2Client) {
  const drive = google.drive({ version: "v3", auth: client });
  const r = await drive.about.get({ fields: "user(emailAddress,displayName)" });
  return { ok: true, detail: `Drive of ${r.data.user?.emailAddress}` };
}

export async function testSheets(client: Auth.OAuth2Client) {
  // Sheets has no "list" — verify by hitting Drive for spreadsheets MIME type.
  const drive = google.drive({ version: "v3", auth: client });
  const r = await drive.files.list({
    q: "mimeType='application/vnd.google-apps.spreadsheet' and trashed=false",
    pageSize: 1,
    fields: "files(id,name)",
  });
  return { ok: true, detail: `Sheets API reachable; ${r.data.files?.length ?? 0} sheet(s) visible` };
}
