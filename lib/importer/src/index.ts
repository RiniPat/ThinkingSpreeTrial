/**
 * Shared importer used by both the deploy-time seed script and the
 * /admin/import upload route in the API server.
 *
 * Append-only by design: when the same sheet is re-uploaded, existing rows
 * (matched by company + sprint date) are left alone; new rows are added;
 * filled fields are never overwritten.
 */
import { db, incubatorsTable, foundersTable, sprintsTable } from "@workspace/db";
import { eq, and, isNull } from "drizzle-orm";
import XLSX from "xlsx";
import fs from "node:fs";

// ─── Helpers ──────────────────────────────────────────────────────────────
type Row = (string | number | null)[];

function readBuffer(buf: Buffer): Record<string, Row[]> {
  const wb = XLSX.read(buf, { type: "buffer", cellDates: true });
  const out: Record<string, Row[]> = {};
  for (const name of wb.SheetNames) {
    out[name] = XLSX.utils.sheet_to_json<Row>(wb.Sheets[name], {
      header: 1, blankrows: false, defval: null,
    }) as Row[];
  }
  return out;
}

/** Read an `.xlsx` file from disk into `{ sheetName: rows }` (used by the
 *  deploy-time seed script). Each row is an array of cell values, header row
 *  included. */
export function readFile(path: string): Record<string, Row[]> {
  return readBuffer(fs.readFileSync(path));
}

/** Same as {@link readFile} but for an in-memory upload buffer (used by the
 *  `/admin/import` route). */
export function readUploadedBuffer(buf: Buffer): Record<string, Row[]> {
  return readBuffer(buf);
}

function s(v: unknown): string | null {
  if (v == null) return null;
  const t = String(v).trim();
  return t.length ? t : null;
}
function n(v: unknown): number | null {
  if (v == null || v === "") return null;
  const x = Number(v);
  return Number.isFinite(x) ? x : null;
}
/** Coerces to an integer or null. Use for INTEGER columns since the source
 *  sheets sometimes have fractional values (e.g. Sprint Session Number = 0.5
 *  for a half-session). Postgres rejects '0.5' for an INTEGER column. */
function ni(v: unknown): number | null {
  const x = n(v);
  return x == null ? null : Math.trunc(x);
}
function asBool(v: unknown): boolean | null {
  if (v == null || v === "") return null;
  const t = String(v).toLowerCase();
  if (["yes", "y", "true", "1"].includes(t)) return true;
  if (["no",  "n", "false","0"].includes(t)) return false;
  return null;
}
function parseRev(v: unknown): string | null {
  if (v == null || v === "") return null;
  if (typeof v === "number") return String(v);
  return String(v).trim();
}

async function getOrCreateIncubator(name: string, type: "isb"|"ju"|"demo", description?: string) {
  const [existing] = await db.select().from(incubatorsTable).where(eq(incubatorsTable.name, name)).limit(1);
  if (existing) return existing;
  const [created] = await db.insert(incubatorsTable).values({ name, type, description }).returning();
  return created;
}

function stripNulls<T extends Record<string, any>>(obj: T): Partial<T> {
  const out: any = {};
  for (const k of Object.keys(obj)) {
    if (obj[k] !== null && obj[k] !== undefined && obj[k] !== "") out[k] = obj[k];
  }
  return out;
}

async function upsertFounder(payload: typeof foundersTable.$inferInsert) {
  const [existing] = await db.select().from(foundersTable)
    .where(and(
      eq(foundersTable.companyName, payload.companyName),
      eq(foundersTable.incubatorId, payload.incubatorId!),
    ))
    .limit(1);
  if (existing) {
    // Append-only semantics: only fill NULL columns, never overwrite filled ones
    const onlyNew = stripNulls(payload);
    const merged: any = {};
    for (const k of Object.keys(onlyNew)) {
      if ((existing as any)[k] === null || (existing as any)[k] === undefined) {
        merged[k] = (onlyNew as any)[k];
      }
    }
    if (Object.keys(merged).length === 0) return existing;
    const [updated] = await db.update(foundersTable).set(merged).where(eq(foundersTable.id, existing.id)).returning();
    return updated;
  }
  const [created] = await db.insert(foundersTable).values(payload).returning();
  return created;
}

// ─── ISB / JU summary sheet importer ──────────────────────────────────────
export async function importSummarySheet(
  rows: Row[],
  programName: "ISB" | "JU",
  incubatorId: number,
): Promise<{ imported: number; skipped: number }> {
  if (rows.length === 0) return { imported: 0, skipped: 0 };

  const headers = (rows[0] ?? []).map(h => String(h ?? "").replace(/\s+/g, " ").trim());
  const idx = (label: string) => headers.findIndex(h => h.toLowerCase().includes(label.toLowerCase()));

  const C = {
    startup:        idx("Startup"),
    consultant:     idx("Consultant"),
    stage:          idx("Stage of the business"),
    goal:           idx("Goal Setting"),
    rev12:          idx("Last 12 months"),
    revMrr:         idx("Last month MRR"),
    teamSize:       idx("no of team members"),
    strength:       idx("Key Strength"),
    gap:            idx("Gap"),
    concept:        idx("Concept and Sessions"),
    mentor:         idx("Mentor Connect"),
    market:         idx("Market Access"),
    icp:            idx("Ideal Customer"),
    marketTimeline: idx("Timeline for Market"),
    observations:   idx("Observations by TS"),
    recForVc:       idx("Worthy for VC"),
    prevFund:       idx("Previous Fundraise (in INR)"),
    prevFundOrg:    idx("Previous Fundraise Organ"),
    burn:           idx("Current Burn"),
    fundAsk:        idx("Fund Ask"),
    commitments:    idx("commitments or ongoing"),
    fundNotes:      idx("Fundraising related Notes"),
    fathom:         idx("Fathom"),
    intervention:   idx("T- Sprint Intervention"),
    tasks:          idx("Tasks"),
    problem:        idx("Current Problem"),
    nextStep:       idx("Suggested Next Step"),
    nextFive:       idx("next 5 Sprints"),
    csWorthy:       idx("Case study worthy"),
    csTheme:        idx("Case study theme"),
    tWorthy:        idx("Training worthy"),
    tTheme:         idx("Training Theme"),
    level:          idx("Level"),
  };

  let imported = 0, skipped = 0;
  for (let r = 1; r < rows.length; r++) {
    const row = rows[r];
    if (!row) { skipped++; continue; }
    const startup = s(row[C.startup] as any);
    if (!startup) { skipped++; continue; }
    const sno = s(row[0] as any);
    if (sno && sno.toUpperCase() === "TEMPLATE") { skipped++; continue; }
    if (startup.toUpperCase() === "TEMPLATE") { skipped++; continue; }
    const consultant = s(row[C.consultant] as any);
    const stage = s(row[C.stage] as any);
    if (!consultant && !stage) { skipped++; continue; }
    if (consultant === "Consultant Name") { skipped++; continue; }

    const founderEmail = `${startup.toLowerCase().replace(/[^a-z0-9]/g, "")}@${programName.toLowerCase()}.imported`;
    await upsertFounder({
      incubatorId,
      name: consultant ?? "Unknown Founder",
      companyName: startup,
      email: founderEmail,
      stage,
      acceleratorProgram: programName,
      source: programName === "ISB" ? "isb-summary" : "ju-summary",
      goalSetting:             s(row[C.goal] as any),
      revenueLast12Months:     parseRev(row[C.rev12] as any),
      revenueLastMonthMrr:     parseRev(row[C.revMrr] as any),
      teamSize:                ni(row[C.teamSize] as any),
      keyStrength:             s(row[C.strength] as any),
      gap:                     s(row[C.gap] as any),
      conceptAndSessions:      C.concept >= 0      ? s(row[C.concept] as any) : null,
      mentorRecommendation:    s(row[C.mentor] as any),
      marketAccess:            s(row[C.market] as any),
      idealCustomerList:       C.icp >= 0          ? s(row[C.icp] as any) : null,
      timelineForMarketAccess: s(row[C.marketTimeline] as any),
      observationsTs:          s(row[C.observations] as any),
      recommendationForVc:     C.recForVc >= 0     ? s(row[C.recForVc] as any) : null,
      previousFundraiseInr:    n(row[C.prevFund] as any) as any,
      previousFundraiseOrgs:   s(row[C.prevFundOrg] as any),
      currentBurn:             s(row[C.burn] as any),
      fundAskCr:               n(row[C.fundAsk] as any) as any,
      fundraiseCommitments:    s(row[C.commitments] as any),
      fundraiseNotes:          s(row[C.fundNotes] as any),
      fathomLink:              s(row[C.fathom] as any),
      tSprintIntervention:     C.intervention >= 0 ? s(row[C.intervention] as any) : null,
      tasks:                   C.tasks >= 0        ? s(row[C.tasks] as any) : null,
      currentProblem:          s(row[C.problem] as any),
      suggestedNextStep:       s(row[C.nextStep] as any),
      nextFiveSprints:         s(row[C.nextFive] as any),
      caseStudyWorthy:         asBool(row[C.csWorthy] as any),
      caseStudyTheme:          s(row[C.csTheme] as any),
      trainingWorthy:          asBool(row[C.tWorthy] as any),
      trainingTheme:           s(row[C.tTheme] as any),
      level:                   s(row[C.level] as any),
    });
    imported++;
  }
  return { imported, skipped };
}

// ─── Sheet Tracking importer ──────────────────────────────────────────────
export async function importSprintTracking(
  rows: Row[],
): Promise<{ imported: number; skipped: number; existing: number }> {
  if (rows.length === 0) return { imported: 0, skipped: 0, existing: 0 };
  const headers = (rows[0] ?? []).map(h => String(h ?? "").replace(/\s+/g, " ").trim());
  const idx = (label: string) => headers.findIndex(h => h.toLowerCase() === label.toLowerCase());
  const I = {
    name:          idx("Name"),
    firstName:     idx("First Name"),
    industry:      idx("Industry"),
    stage:         idx("Stage of business"),
    program:       idx("Program Name"),
    partner:       idx("Partner Name"),
    host:          idx("Sprint Host"),
    coHost:        idx("Co-Host"),
    sessionNumber: idx("Sprint Session Number"),
    sprintCount:   idx("Sprint count"),
    sessionType:   idx("Session Type"),
    paymentStatus: idx("Payment Status"),
    billedTo:      idx("Billed to"),
    sprintDate:    idx("Sprint Date"),
    startTime:     idx("Start Time"),
    endTime:       idx("End Time"),
    duration:      idx("Total Duration"),
    week:          idx("Week"),
    month:         idx("Month"),
    cyYear:        idx("CY Year"),
    quarter:       idx("Quarters"),
    price:         idx("Price"),
    billNumber:    idx("Bill number"),
    founder:       idx("Founder"),
    email:         idx("Email"),
    contact:       idx("Contact"),
    founder2:      idx("Founder 2"),
    email2:        idx("Email 2"),
    contact2:      idx("Contact 2"),
  };

  let imported = 0, skipped = 0, existing = 0;

  const formatTime = (v: any): string | null => {
    if (v instanceof Date) {
      return `${String(v.getUTCHours()).padStart(2, "0")}:${String(v.getUTCMinutes()).padStart(2, "0")}`;
    }
    return s(v);
  };

  for (let r = 1; r < rows.length; r++) {
    const row = rows[r];
    if (!row) { skipped++; continue; }
    const companyName = s(row[I.name] as any);
    if (!companyName) { skipped++; continue; }
    const programName = s(row[I.program] as any) ?? "Direct Channel";
    const host = s(row[I.host] as any);
    const coHost = s(row[I.coHost] as any);

    const founderEmail = s(row[I.email] as any)
      ?? `${companyName.toLowerCase().replace(/[^a-z0-9]/g, "")}@tracking.imported`;
    const founderName = s(row[I.founder] as any) ?? s(row[I.firstName] as any) ?? "Unknown";

    let incubatorId: number | null = null;
    const pLow = programName.toLowerCase();
    if (pLow.includes("isb")) {
      const [i] = await db.select().from(incubatorsTable).where(eq(incubatorsTable.type, "isb")).limit(1);
      incubatorId = i?.id ?? null;
    } else if (pLow.includes("ju") || pLow.includes("jadavpur")) {
      const [i] = await db.select().from(incubatorsTable).where(eq(incubatorsTable.type, "ju")).limit(1);
      incubatorId = i?.id ?? null;
    }

    const [foundOrNew] = await db.select().from(foundersTable)
      .where(eq(foundersTable.companyName, companyName)).limit(1);
    const founderId = foundOrNew?.id ?? (await db.insert(foundersTable).values({
      incubatorId,
      name: founderName,
      email: founderEmail,
      contact: s(row[I.contact] as any),
      founder2Name: s(row[I.founder2] as any),
      founder2Email: s(row[I.email2] as any),
      founder2Contact: s(row[I.contact2] as any),
      companyName,
      industry: s(row[I.industry] as any),
      stage: s(row[I.stage] as any),
      acceleratorProgram: programName,
      partnerName: s(row[I.partner] as any),
      source: "sheet-tracking",
    }).returning())[0].id;

    const rawDate = row[I.sprintDate] as any;
    const scheduledDate = rawDate instanceof Date
      ? rawDate.toISOString().slice(0, 10)
      : s(rawDate);
    if (!scheduledDate) { skipped++; continue; }

    // The Sheet Tracking xlsx occasionally has fractional session numbers
    // (e.g. 0.5 for a half-session). DB column is integer — `ni` truncates.
    const sprintNumber = ni(row[I.sessionNumber] as any);

    // Append-only dedup: skip if a sprint already exists for this combo.
    // Key handling for sprint_number: if the row has no number, match on
    // founder + date alone among the NULL-numbered rows. The previous
    // implementation passed sprint_number = -1 which never matched the NULL
    // rows already in DB, causing duplicates on every re-import.
    const dupQuery = sprintNumber == null
      ? db.select().from(sprintsTable).where(and(
          eq(sprintsTable.founderId, founderId),
          eq(sprintsTable.scheduledDate, scheduledDate),
          isNull(sprintsTable.sprintNumber),
        ))
      : db.select().from(sprintsTable).where(and(
          eq(sprintsTable.founderId, founderId),
          eq(sprintsTable.scheduledDate, scheduledDate),
          eq(sprintsTable.sprintNumber, sprintNumber),
        ));
    const [existingSprint] = await dupQuery.limit(1);
    if (existingSprint) { existing++; continue; }

    await db.insert(sprintsTable).values({
      founderId,
      scheduledDate,
      scheduledTime: formatTime(row[I.startTime] as any),
      endTime: formatTime(row[I.endTime] as any),
      totalDuration: s(row[I.duration] as any),
      consultantName: host ?? "Unknown",
      sprintHost: host,
      coHost,
      status: "completed" as const,
      sprintNumber: sprintNumber ?? null,
      sessionType: s(row[I.sessionType] as any),
      paymentStatus: s(row[I.paymentStatus] as any),
      billedTo: s(row[I.billedTo] as any),
      billNumber: s(row[I.billNumber] as any),
      price: n(row[I.price] as any) as any,
      week: ni(row[I.week] as any),
      month: ni(row[I.month] as any),
      cyYear: ni(row[I.cyYear] as any),
      quarter: s(row[I.quarter] as any),
    });
    imported++;
  }
  return { imported, skipped, existing };
}

// ─── Ensure the three canonical incubators exist ──────────────────────────
/** Idempotently create (or fetch) the three canonical incubators — ISB, JU,
 *  and Demo — so imports and seeding always have a valid cohort to attach
 *  founders to. Returns the three incubator records. */
export async function ensureCoreIncubators() {
  const isb = await getOrCreateIncubator("ISB IVI 4.0", "isb",
    "Indian School of Business — Venture Incubation, cohort 4.0");
  const ju = await getOrCreateIncubator("JU Cohort", "ju",
    "Jadavpur University startup cohort");
  const demo = await getOrCreateIncubator("Demo Program", "demo",
    "Reference / demo data — use to showcase the platform to prospective partners.");
  return { isb, ju, demo };
}

// ─── Auto-detect sheet type from header ───────────────────────────────────
export type SheetKind = "isb-summary" | "ju-summary" | "sheet-tracking" | "unknown";

/** Classify a sheet from its header row so the upload route can pick the right
 *  importer. Matches on signature columns (e.g. "Sprint Date"+"Sprint Host" →
 *  tracking; "Startup"+"Goal Setting", with "Ideal Customer" distinguishing JU
 *  from ISB). Returns `"unknown"` when nothing matches. */
export function detectSheetKind(rows: Row[]): SheetKind {
  const firstHeader = (rows[0] ?? []).map(h => String(h ?? "").toLowerCase()).join("|");
  if (firstHeader.includes("sprint date") && firstHeader.includes("sprint host")) return "sheet-tracking";
  if (firstHeader.includes("startup") && firstHeader.includes("goal setting")) {
    if (firstHeader.includes("ideal customer")) return "ju-summary";
    return "isb-summary";
  }
  return "unknown";
}
