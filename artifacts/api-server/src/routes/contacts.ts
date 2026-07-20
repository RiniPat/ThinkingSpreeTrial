/**
 * Inbox CRM (the new Sales tab). Sales/Admin only.
 *
 * PERFORMANCE MODEL — why this never slows the app:
 *  • Gmail is touched ONLY inside a background job (fire-and-forget), never in
 *    a request the UI is waiting on. Sync/Refresh return immediately (202) and
 *    the UI polls a tiny sync-status row for progress.
 *  • The grid and analytics read the `contacts` table (indexed, paginated,
 *    server-side filtered) — they never call Gmail on render.
 *  • Message fetches use format:'metadata' (headers only, not bodies), run with
 *    bounded concurrency, and are capped.
 *  • Classification uses cheap domain heuristics first; the AI only sees the
 *    ambiguous remainder, in batches — tens of model calls for a whole inbox.
 *  • Refresh is incremental: only messages newer than the last sync.
 */
import { Router } from "express";
import { google } from "googleapis";
import { db, contactsTable, contactSyncStateTable, salesLeadsTable, usersTable } from "@workspace/db";
import { and, eq, or, ilike, sql, lt, inArray } from "drizzle-orm";
import { canAccessInboxCrm } from "@workspace/db";
import { getAuthedClient } from "../lib/google";
import { heuristicRole, classifyContactsBatch, type ContactRole } from "../lib/contactsAi";

const router = Router();
const MAX_MESSAGES = 6000;          // safety cap per sync run
const GET_CONCURRENCY = 8;
const CLASSIFY_BATCH = 40;
const COLD_DAYS = 90;

async function getMe(req: any, res: any) {
  const uid = req.session?.userId;
  if (!uid) { res.status(401).json({ error: "Not authenticated" }); return null; }
  const [u] = await db.select().from(usersTable).where(eq(usersTable.id, uid)).limit(1);
  if (!u) { res.status(401).json({ error: "User not found" }); return null; }
  if (!canAccessInboxCrm(u.role)) { res.status(403).json({ error: "The Inbox CRM is available to Sales and Admin roles only." }); return null; }
  return u;
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  async function worker() { while (i < items.length) { const idx = i++; out[idx] = await fn(items[idx]); } }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

function header(headers: any[], name: string): string {
  const h = headers?.find((x) => x.name?.toLowerCase() === name.toLowerCase());
  return h?.value ?? "";
}
function parseAddresses(v: string): { email: string; name: string }[] {
  if (!v) return [];
  return v.split(",").map((part) => {
    const m = part.match(/"?([^"<]*)"?\s*<([^>]+)>/);
    if (m) return { name: m[1].trim(), email: m[2].trim().toLowerCase() };
    const e = part.trim().toLowerCase();
    return e.includes("@") ? { name: "", email: e } : null;
  }).filter(Boolean) as { email: string; name: string }[];
}
const domainOf = (email: string) => email.split("@")[1] || "";

// ─────────────────────────── background sync ────────────────────────────
async function setState(ownerId: number, patch: Record<string, unknown>) {
  await db.insert(contactSyncStateTable).values({ ownerId, updatedAt: new Date(), ...patch } as any)
    .onConflictDoUpdate({ target: contactSyncStateTable.ownerId, set: { updatedAt: new Date(), ...patch } });
}

async function runSync(ownerId: number, opts: { windowMonths: number | null; incremental: boolean }) {
  try {
    await setState(ownerId, { status: "running", phase: "scanning", processed: 0, total: 0, message: null, windowMonths: opts.windowMonths });
    const client = await getAuthedClient(ownerId);
    if (!client) { await setState(ownerId, { status: "error", message: "Gmail isn't connected. Connect Google in Settings." }); return; }
    const gmail = google.gmail({ version: "v1", auth: client });
    const me = (await gmail.users.getProfile({ userId: "me" })).data.emailAddress?.toLowerCase() || "";

    // Build the Gmail search query for the chosen window / incremental delta.
    let q = "";
    if (opts.incremental) {
      const [st] = await db.select().from(contactSyncStateTable).where(eq(contactSyncStateTable.ownerId, ownerId)).limit(1);
      const since = st?.lastSyncedAt ? Math.floor(new Date(st.lastSyncedAt).getTime() / 1000) : Math.floor((Date.now() - 30 * 864e5) / 1000);
      q = `after:${since}`;
    } else if (opts.windowMonths) {
      q = `newer_than:${opts.windowMonths}m`;
    }

    // 1) collect message ids (paginated, capped)
    const ids: string[] = [];
    let pageToken: string | undefined;
    do {
      const r = await gmail.users.messages.list({ userId: "me", q: q || undefined, maxResults: 500, pageToken });
      for (const m of r.data.messages ?? []) if (m.id) ids.push(m.id);
      pageToken = r.data.nextPageToken ?? undefined;
    } while (pageToken && ids.length < MAX_MESSAGES);
    await setState(ownerId, { total: ids.length });

    // 2) fetch headers only, aggregate per counterparty
    type Agg = { email: string; name: string; domain: string; sent: number; received: number; first: number; last: number; lastDir: string; subjects: string[] };
    const map = new Map<string, Agg>();
    let processed = 0;
    const bump = (email: string, name: string, dir: "sent" | "received", ts: number, subject: string) => {
      if (!email || email === me) return;
      let a = map.get(email);
      if (!a) { a = { email, name, domain: domainOf(email), sent: 0, received: 0, first: ts, last: ts, lastDir: dir, subjects: [] }; map.set(email, a); }
      if (dir === "sent") a.sent++; else a.received++;
      if (name && !a.name) a.name = name;
      if (ts < a.first) a.first = ts;
      if (ts >= a.last) { a.last = ts; a.lastDir = dir; }
      if (subject && a.subjects.length < 3) a.subjects.push(subject);
    };

    const chunkSize = 200;
    for (let start = 0; start < ids.length; start += chunkSize) {
      const chunk = ids.slice(start, start + chunkSize);
      await mapLimit(chunk, GET_CONCURRENCY, async (id) => {
        try {
          const msg = await gmail.users.messages.get({ userId: "me", id, format: "metadata", metadataHeaders: ["From", "To", "Cc", "Date", "Subject"] });
          const hs = msg.data.payload?.headers ?? [];
          const from = parseAddresses(header(hs, "From"))[0];
          const to = [...parseAddresses(header(hs, "To")), ...parseAddresses(header(hs, "Cc"))];
          const ts = Number(msg.data.internalDate) || Date.now();
          const subject = header(hs, "Subject");
          const isSent = from?.email === me;
          if (isSent) { for (const r of to) bump(r.email, r.name, "sent", ts, subject); }
          else if (from) { bump(from.email, from.name, "received", ts, subject); }
        } catch { /* skip unreadable message */ }
      });
      processed = Math.min(start + chunk.length, ids.length);
      await setState(ownerId, { processed });
    }

    // 3) figure out which contacts need a role (respect user-locked roles)
    await setState(ownerId, { phase: "classifying" });
    const emails = [...map.keys()];
    const existing = emails.length
      ? await db.select({ email: contactsTable.email, roleSource: contactsTable.roleSource }).from(contactsTable).where(and(eq(contactsTable.ownerId, ownerId), inArray(contactsTable.email, emails)))
      : [];
    const lockedOrKnown = new Map(existing.map((e) => [e.email, e.roleSource]));

    const roleFor = new Map<string, { role: ContactRole; confidence: number }>();
    const needAI: Agg[] = [];
    for (const a of map.values()) {
      if (lockedOrKnown.get(a.email) === "user") continue; // never overwrite a human decision
      const h = heuristicRole(a.email, a.domain);
      if (h) roleFor.set(a.email, { role: h.role, confidence: h.confidence });
      else needAI.push(a);
    }
    for (let i = 0; i < needAI.length; i += CLASSIFY_BATCH) {
      const batch = needAI.slice(i, i + CLASSIFY_BATCH);
      const res = await classifyContactsBatch(batch.map((a) => ({ email: a.email, name: a.name, domain: a.domain, sampleSubjects: a.subjects })));
      batch.forEach((a, j) => roleFor.set(a.email, { role: res[j].role, confidence: res[j].confidence }));
    }

    // 4) upsert contacts (increment counts on incremental, set absolute on full)
    for (const a of map.values()) {
      const replyStatus = a.sent > 0 && a.received > 0 ? "replied" : a.received > 0 ? "awaiting" : "none";
      const rf = roleFor.get(a.email);
      const base: any = {
        ownerId, email: a.email, name: a.name || null, domain: a.domain || null,
        company: a.domain ? a.domain.split(".")[0].replace(/^\w/, (c: string) => c.toUpperCase()) : null,
        firstSeen: new Date(a.first), lastContactAt: new Date(a.last), lastDirection: a.lastDir, replyStatus,
        emailsTotal: a.sent + a.received, sentCount: a.sent, receivedCount: a.received, updatedAt: new Date(),
      };
      if (rf) { base.role = rf.role; base.confidence = rf.confidence; base.roleSource = "ai"; }
      const setOnConflict: any = {
        name: sql`COALESCE(${contactsTable.name}, ${base.name})`,
        lastContactAt: base.lastContactAt, lastDirection: base.lastDirection, replyStatus, updatedAt: new Date(),
        firstSeen: sql`LEAST(${contactsTable.firstSeen}, ${base.firstSeen})`,
      };
      if (opts.incremental) {
        setOnConflict.emailsTotal = sql`${contactsTable.emailsTotal} + ${a.sent + a.received}`;
        setOnConflict.sentCount = sql`${contactsTable.sentCount} + ${a.sent}`;
        setOnConflict.receivedCount = sql`${contactsTable.receivedCount} + ${a.received}`;
      } else {
        setOnConflict.emailsTotal = base.emailsTotal; setOnConflict.sentCount = base.sentCount; setOnConflict.receivedCount = base.receivedCount;
      }
      // Only (re)assign role for non-user-locked rows.
      if (rf && lockedOrKnown.get(a.email) !== "user") { setOnConflict.role = base.role; setOnConflict.confidence = base.confidence; setOnConflict.roleSource = "ai"; }
      await db.insert(contactsTable).values(base).onConflictDoUpdate({ target: [contactsTable.ownerId, contactsTable.email], set: setOnConflict });
    }

    await setState(ownerId, { status: "idle", phase: null, lastSyncedAt: new Date(), message: null, processed: ids.length });
  } catch (err: any) {
    await setState(ownerId, { status: "error", message: err?.message?.slice(0, 200) || "Sync failed" });
  }
}

// ─────────────────────────── endpoints ──────────────────────────────────
router.post("/contacts/sync", async (req, res) => {
  const me = await getMe(req, res); if (!me) return;
  const [st] = await db.select().from(contactSyncStateTable).where(eq(contactSyncStateTable.ownerId, me.id)).limit(1);
  const stale = st?.updatedAt ? Date.now() - new Date(st.updatedAt).getTime() > 15 * 60 * 1000 : true;
  if (st?.status === "running" && !stale) { res.status(409).json({ error: "A sync is already running." }); return; }
  const windowMonths = req.body?.windowMonths === null || req.body?.windowMonths === "all" ? null : Number(req.body?.windowMonths) || 12;
  const incremental = !!req.body?.incremental;
  void runSync(me.id, { windowMonths, incremental }); // fire-and-forget
  res.status(202).json({ ok: true, started: true });
});

router.get("/contacts/sync-status", async (req, res) => {
  const me = await getMe(req, res); if (!me) return;
  const [st] = await db.select().from(contactSyncStateTable).where(eq(contactSyncStateTable.ownerId, me.id)).limit(1);
  res.json(st ?? { ownerId: me.id, status: "idle", processed: 0, total: 0, lastSyncedAt: null });
});

router.get("/contacts/stats", async (req, res) => {
  const me = await getMe(req, res); if (!me) return;
  const own = eq(contactsTable.ownerId, me.id);
  const [tot] = await db.select({
    contacts: sql<number>`count(*)::int`,
    emails: sql<number>`coalesce(sum(${contactsTable.emailsTotal}),0)::int`,
    sent: sql<number>`coalesce(sum(${contactsTable.sentCount}),0)::int`,
    received: sql<number>`coalesce(sum(${contactsTable.receivedCount}),0)::int`,
    replied: sql<number>`(count(*) filter (where ${contactsTable.replyStatus} = 'replied'))::int`,
    hadInbound: sql<number>`(count(*) filter (where ${contactsTable.receivedCount} > 0))::int`,
    newWeek: sql<number>`(count(*) filter (where ${contactsTable.firstSeen} > now() - interval '7 days'))::int`,
    cold: sql<number>`(count(*) filter (where ${contactsTable.lastContactAt} < now() - interval '${sql.raw(String(COLD_DAYS))} days'))::int`,
  }).from(contactsTable).where(own);
  const byRole = await db.select({ role: contactsTable.role, n: sql<number>`count(*)::int` }).from(contactsTable).where(own).groupBy(contactsTable.role);
  const [st] = await db.select().from(contactSyncStateTable).where(eq(contactSyncStateTable.ownerId, me.id)).limit(1);
  const replyRate = tot.hadInbound ? Math.round((tot.replied / tot.hadInbound) * 100) : 0;
  res.json({ ...tot, replyRate, byRole, lastSyncedAt: st?.lastSyncedAt ?? null });
});

router.get("/contacts", async (req, res) => {
  const me = await getMe(req, res); if (!me) return;
  const role = String(req.query.role || "all");
  const status = String(req.query.status || "all");
  const search = String(req.query.search || "").trim();
  const sort = String(req.query.sort || "recent");
  const page = Math.max(1, Number(req.query.page) || 1);
  const pageSize = Math.min(100, Math.max(10, Number(req.query.pageSize) || 25));

  const conds: any[] = [eq(contactsTable.ownerId, me.id)];
  if (["founder", "investor", "partner", "other"].includes(role)) conds.push(eq(contactsTable.role, role));
  if (status === "cold") conds.push(lt(contactsTable.lastContactAt, sql`now() - interval '${sql.raw(String(COLD_DAYS))} days'`));
  else if (["replied", "awaiting", "none"].includes(status)) conds.push(eq(contactsTable.replyStatus, status));
  if (search) conds.push(or(ilike(contactsTable.email, `%${search}%`), ilike(contactsTable.name, `%${search}%`), ilike(contactsTable.company, `%${search}%`)) as any);
  const where = and(...conds);

  const orderBy = sort === "emails" ? sql`${contactsTable.emailsTotal} desc nulls last`
    : sort === "name" ? sql`${contactsTable.name} asc nulls last`
    : sql`${contactsTable.lastContactAt} desc nulls last`;

  const [{ total }] = await db.select({ total: sql<number>`count(*)::int` }).from(contactsTable).where(where);
  const rows = await db.select().from(contactsTable).where(where).orderBy(orderBy).limit(pageSize).offset((page - 1) * pageSize);
  res.json({ contacts: rows, total, page, pageSize });
});

router.patch("/contacts/:id", async (req, res) => {
  const me = await getMe(req, res); if (!me) return;
  const id = Number(req.params.id);
  const patch: any = { updatedAt: new Date() };
  if (typeof req.body?.role === "string" && ["founder", "investor", "partner", "other"].includes(req.body.role)) {
    patch.role = req.body.role; patch.roleSource = "user"; patch.confidence = null; // user decision locks it
  }
  if (typeof req.body?.roleLabel === "string") patch.roleLabel = req.body.roleLabel.trim() || null;
  if (typeof req.body?.notes === "string") patch.notes = req.body.notes;
  const [row] = await db.update(contactsTable).set(patch).where(and(eq(contactsTable.id, id), eq(contactsTable.ownerId, me.id))).returning();
  if (!row) { res.status(404).json({ error: "Contact not found" }); return; }
  res.json({ contact: row });
});

router.post("/contacts/:id/promote", async (req, res) => {
  const me = await getMe(req, res); if (!me) return;
  const id = Number(req.params.id);
  const [c] = await db.select().from(contactsTable).where(and(eq(contactsTable.id, id), eq(contactsTable.ownerId, me.id))).limit(1);
  if (!c) { res.status(404).json({ error: "Contact not found" }); return; }
  const [lead] = await db.insert(salesLeadsTable).values({
    ownerId: me.id, companyName: c.company || c.domain || "(unknown)", contactName: c.name,
    contactEmail: c.email, contactRole: c.roleLabel || c.role, linkedinUrl: c.linkedinUrl,
    stage: "cold", source: "inbox-crm", lastTouchAt: c.lastContactAt,
  }).returning();
  await db.update(contactsTable).set({ promotedLeadId: lead.id, updatedAt: new Date() }).where(eq(contactsTable.id, id));
  res.json({ ok: true, leadId: lead.id });
});

export default router;
