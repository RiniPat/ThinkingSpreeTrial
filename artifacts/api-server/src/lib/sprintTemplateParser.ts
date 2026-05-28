/**
 * Parses a Sprint Template .xlsx uploaded by a consultant.
 *
 * The template has 7 sheets but only a few rows in each contain real data —
 * the rest are pre-formatted empty cells. We walk each sheet looking for the
 * label cell (e.g. "Company Name") and then read the next cell to the right
 * or below for the value. This is deliberately defensive: consultants will
 * inevitably re-order rows or rename labels, so we match on labels rather
 * than fixed cell addresses.
 *
 * Returns a structured object that mirrors the founders table + a generic
 * `excelData` JSON blob for anything we don't have a column for.
 */
import XLSX from "xlsx";

// ────────────────────────── Types ─────────────────────────────────────────
export type ParsedTemplate = {
  /** Required — Company Name from Overview sheet. */
  companyName: string;
  /** Required — Founder's Name from Overview sheet. */
  founderName: string;
  /** Optional — Founder's Email from Overview sheet (recommended in template v2+). */
  founderEmail: string | null;
  /** Optional — Cohort label (e.g. "ISB i-Venture"). */
  cohort: string | null;
  /** Optional — link to deck mentioned in Overview. */
  deckUrl: string | null;
  /** Optional — primary consultant from "T-Sprint Consultants Assigned". */
  sprintHost: string | null;
  /** Optional — secondary consultant from "TSprint organised by". */
  coHost: string | null;
  /** Optional — Vision (AI-summarised, populated lazily). null on initial parse. */
  vision: string | null;
  /** Optional — Raw "About Startup" paragraph; AI summarises this into `vision` on demand. */
  visionRaw: string | null;
  /** Optional — first SWOT strengths block, as text. */
  keyStrengths: string | null;
  /** Optional — first SWOT gaps block, as text. */
  gaps: string | null;
  /** Optional — first SWOT opportunities block, as text. */
  opportunities: string | null;
  /** Optional — Mentor Connect block, as text. */
  mentorRecommendation: string | null;
  /** Optional — Market Access block, as text. */
  marketAccess: string | null;
  /** Optional — Next direction / goal (from Milestones first row). */
  direction: string | null;
  /** Optional — Actionable tasks (from SMART Goals sheet). */
  actionableSteps: string | null;
  /** Optional — SMART Goal for the next 3 months (from SMART Goals sheet). */
  smartGoal3Months: string | null;
  /** Optional — Current funding status. */
  fundingStatus: string | null;
  /** Optional — Fund ask in crores. */
  fundAskCr: number | null;
  /** Optional — Previous fundraise amount in crores (raw string e.g. "₹2 Cr"). */
  previousFundraiseCr: string | null;
  /** Optional — Comma-separated list of past investors. */
  previousFundraiseOrgs: string | null;
  /** Optional — Current monthly burn (raw string). */
  currentBurn: string | null;
  /** Optional — Runway in months / weeks (raw string). */
  runway: string | null;
  /** Optional — Revenue (last 12 months) as raw text. */
  revenueLast12Months: string | null;
  /** Optional — MRR / last month revenue as raw text. */
  revenueLastMonthMrr: string | null;
  /** Optional — Team size if present. */
  teamSize: number | null;
  /** Optional — Metrics tab: Quantifiable goal for the next stage. */
  nextStageGoal: string | null;
  /** Optional — Metrics tab: Runway for the next stage (post funding). */
  nextStageRunway: string | null;
  /** Optional — Metrics tab: Funds for (broader what needs to be built). */
  fundsFor: string | null;
  /**
   * Detected workflow stage based on which sheets had content.
   *   'pre_sprint' — only Overview filled
   *   'sprint_done' — Milestones/SWOT/Funding/SMART have content
   *
   * This drives the UI's "Generate Pre-Sprint Email" vs
   * "Generate Post-Sprint Email" CTA.
   */
  detectedStage: "pre_sprint" | "sprint_done";
  /** Raw normalized payload — kept on the founder row as excel_data JSONB. */
  raw: Record<string, unknown>;
  /** Soft warnings to surface to the consultant (not blocking). */
  warnings: string[];
};

// ────────────────────────── Helpers ───────────────────────────────────────

/** Convert a sheet to a row-major 2D array of strings (empty cells → ""). */
function sheetTo2D(ws: XLSX.WorkSheet): string[][] {
  // header:1 returns array-of-arrays, defval:"" coerces blanks to empty string.
  const rows = XLSX.utils.sheet_to_json<string[]>(ws, {
    header: 1,
    defval: "",
    blankrows: false,
    raw: false,  // get formatted strings, not raw numbers — easier matching
  });
  return rows.map((r) => (Array.isArray(r) ? r.map((c) => String(c ?? "").trim()) : []));
}

/** Lower-cased + collapsed-whitespace label match. */
function labelEq(cell: string, ...wants: string[]): boolean {
  const norm = cell.toLowerCase().replace(/\s+/g, " ").trim();
  return wants.some((w) => norm === w.toLowerCase().replace(/\s+/g, " ").trim());
}

/** Looser match — "contains" semantics for fuzzy labels. */
function labelHas(cell: string, ...wants: string[]): boolean {
  const norm = cell.toLowerCase().replace(/\s+/g, " ").trim();
  return wants.some((w) => norm.includes(w.toLowerCase()));
}

/**
 * For an Overview-style sheet (label, value) — given a label, find the value.
 * Looks one cell to the right first, then one row below. Returns null if both empty.
 */
function findValueByLabel(rows: string[][], ...labels: string[]): string | null {
  for (let r = 0; r < rows.length; r++) {
    const row = rows[r];
    for (let c = 0; c < row.length; c++) {
      const cell = row[c];
      if (!cell) continue;
      if (labels.some((l) => labelEq(cell, l) || labelHas(cell, l))) {
        // Try right first
        const right = row[c + 1];
        if (right && right.trim()) return right.trim();
        // Try below — but reject the value if the cell below is itself a
        // known label. Without this guard, an empty value cell would cause
        // us to "fall through" and return the next row's LABEL as if it
        // were our value. This was a real bug — e.g. asking for "Current
        // Burn" with an empty value cell would return the string "Runway"
        // because Runway is the label on the next row.
        const below = rows[r + 1]?.[c];
        if (below && below.trim() && !looksLikeLabel(below)) {
          return below.trim();
        }
      }
    }
  }
  return null;
}

/**
 * Known labels that appear on the Sprint Template across all sheets. We
 * use this list to avoid the classic "below cell is empty so I'll return
 * the cell below THAT" trap — which previously caused e.g. "Current Burn"
 * to return "Runway" (the label of the row below it) when the burn cell
 * itself was blank.
 *
 * Comparison is normalized — lowercase, single-spaced, trimmed.
 */
const KNOWN_LABELS: string[] = [
  "Company Name", "Company",
  "Founder's Name", "Founder Name", "Founders Name",
  "Founder's Email", "Founder Email", "Founders Email", "Email",
  "Attachment of their Deck/ Information about them", "Attachment of their Deck", "Deck",
  "Cohort", "Incubator", "Program",
  "T-Sprint Consultants Assigned", "T-Sprint Consultant Assigned", "Consultant Assigned", "Consultants Assigned",
  "TSprint organised by", "T-Sprint organised by", "Sprint organised by", "Organised by", "Co-Host", "Co Host",
  "Direction",
  "Key Strengths", "Gaps", "Opportunities", "Threats",
  "Mentor Connect", "Expert 1:1", "Office hour Support",
  "Market Access", "Market Connect",
  "Current funding status",
  "Fund Ask  (in crores)", "Fund Ask (in crores)", "Fund Ask in crores",
  "Previous Fundraise (in CR) if applicable", "Previous Fundraise (in CR)", "Previous Fundraise",
  "Previous Fundraise Organisations", "Previous Fundraise Organizations",
  "Current Burn if applicable", "Current Burn", "Burn Rate", "Burn",
  "Runway",
  "Actionable Task", "Actionable Tasks", "Actionable Steps",
  "SMART Goal (3 months)", "SMART Goal 3 months", "SMART Goal - 3 months", "3 month SMART Goal",
  "Last 12 Months Revenue", "Last Month Revenue (MRR)", "Last Month Revenue", "MRR",
  "Team Size",
  // Metrics tab (v5.1)
  "Quantifiable goal for the next stage of the startup",
  "Quantifiable goal for the next stage",
  "Quantifiable goal",
  "Runway for the next stage (post funding)",
  "Runway for the next stage",
  "Runway post funding",
  "Funds for (broader what needs to be built)",
  "Funds for",
  "Use of Funds",
];
function normalizeLabel(s: string): string {
  return s.toLowerCase().replace(/\s+/g, " ").trim();
}
const KNOWN_LABEL_SET = new Set(KNOWN_LABELS.map(normalizeLabel));

/** Returns true if the cell's value matches a known label string. We use
 *  this to reject "label-as-value" pollution from below-cell scanning. */
function looksLikeLabel(cell: string | null | undefined): boolean {
  if (!cell) return false;
  return KNOWN_LABEL_SET.has(normalizeLabel(cell));
}

/**
 * STRICT below-only lookup. Finds a cell matching one of the labels, then
 * returns the value in the row immediately below in the SAME column. Used
 * for Funding fields where the answer is always on the next row (not to
 * the right).
 *
 * Still guarded by `looksLikeLabel` so we never return a label as a value.
 */
function findValueBelow(rows: string[][], ...labels: string[]): string | null {
  for (let r = 0; r < rows.length; r++) {
    const row = rows[r];
    for (let c = 0; c < row.length; c++) {
      const cell = row[c];
      if (!cell) continue;
      if (labels.some((l) => labelEq(cell, l) || labelHas(cell, l))) {
        const below = rows[r + 1]?.[c];
        if (below && below.trim() && !looksLikeLabel(below)) {
          return below.trim();
        }
        return null;
      }
    }
  }
  return null;
}

/**
 * STRICT right-only lookup. Finds a cell matching one of the labels, then
 * returns the value in the cell to its right on the SAME row. Used for
 * Metrics fields where the answer is always to the right.
 */
function findValueRight(rows: string[][], ...labels: string[]): string | null {
  for (let r = 0; r < rows.length; r++) {
    const row = rows[r];
    for (let c = 0; c < row.length; c++) {
      const cell = row[c];
      if (!cell) continue;
      if (labels.some((l) => labelEq(cell, l) || labelHas(cell, l))) {
        const right = row[c + 1];
        if (right && right.trim() && !looksLikeLabel(right)) {
          return right.trim();
        }
        return null;
      }
    }
  }
  return null;
}

/** Try to coerce a string to a number; return null if NaN. */
function num(s: string | null): number | null {
  if (!s) return null;
  // strip commas, spaces, currency symbols
  const cleaned = s.replace(/[,\s₹$]/g, "");
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

// ────────────────────────── Main parser ───────────────────────────────────

export function parseSprintTemplate(buffer: Buffer): ParsedTemplate {
  const wb = XLSX.read(buffer, { type: "buffer", cellDates: true, cellNF: false, cellText: true });
  return parseSprintTemplateWorkbook(wb);
}

/**
 * Same parser, but takes an already-built workbook. Used by the Google Sheets
 * fetcher path so we don't have to serialize through .xlsx → bytes → re-parse.
 */
export function parseSprintTemplateWorkbook(wb: XLSX.WorkBook): ParsedTemplate {
  const warnings: string[] = [];

  // Find sheets by approximate name — consultants sometimes rename slightly.
  const findSheet = (...names: string[]) => {
    for (const n of names) {
      const exact = wb.Sheets[n];
      if (exact) return exact;
    }
    for (const sn of wb.SheetNames) {
      const norm = sn.toLowerCase().trim();
      if (names.some((n) => norm.includes(n.toLowerCase()))) return wb.Sheets[sn];
    }
    return null;
  };

  // ─── Overview sheet (required) ─────────────────────────────────────────
  const overviewWs = findSheet("Overview");
  if (!overviewWs) {
    throw new Error('The uploaded file is missing the "Overview" sheet.');
  }
  const overview = sheetTo2D(overviewWs);

  const companyName = findValueByLabel(overview, "Company Name", "Company");
  const founderName = findValueByLabel(overview, "Founder's Name", "Founder Name", "Founders Name");
  const founderEmail = findValueByLabel(
    overview,
    "Founder's Email", "Founder Email", "Founders Email", "Email"
  );
  const deckUrl = findValueByLabel(
    overview,
    "Attachment of their Deck/ Information about them",
    "Attachment of their Deck",
    "Deck"
  );
  const cohort = findValueByLabel(overview, "Cohort", "Incubator", "Program");

  // Sprint Host + Co-Host are on the same Overview row: column B is the
  // label "T-Sprint Consultants Assigned", column C is the host name,
  // column D is the co-host name. We find the host the usual way, then
  // walk one extra cell to the right on the same row for the co-host.
  let sprintHost: string | null = null;
  let coHost: string | null = null;
  for (let r = 0; r < overview.length; r++) {
    const row = overview[r];
    for (let c = 0; c < row.length; c++) {
      const cell = row[c];
      if (!cell) continue;
      if (labelEq(cell, "T-Sprint Consultants Assigned")
          || labelEq(cell, "T-Sprint Consultant Assigned")
          || labelEq(cell, "Consultant Assigned")
          || labelEq(cell, "Consultants Assigned")
          || labelHas(cell, "T-Sprint Consultants Assigned")
          || labelHas(cell, "Consultant Assigned")) {
        const next1 = row[c + 1];
        const next2 = row[c + 2];
        if (next1 && next1.trim()) sprintHost = next1.trim();
        if (next2 && next2.trim()) coHost = next2.trim();
        break;
      }
    }
    if (sprintHost) break;
  }
  // Fall back to the old "organised by" row if the side-by-side parse didn't
  // find a co-host — keeps older sheets working.
  if (!coHost) {
    coHost = findValueByLabel(
      overview,
      "TSprint organised by",
      "T-Sprint organised by",
      "Sprint organised by",
      "Organised by",
      "Co-Host",
      "Co Host"
    );
  }

  if (!companyName) throw new Error('"Company Name" is missing from the Overview sheet.');
  if (!founderName) throw new Error('"Founder\'s Name" is missing from the Overview sheet.');
  if (!cohort) warnings.push("Cohort not set in Overview — uploaded without a cohort.");

  // ─── About Startup sheet — keep the RAW paragraph here.
  // The Sprint Data tab will lazily summarise it via Gemini into 2-3 lines
  // and cache the result. We keep the raw text so the consultant can always
  // refresh / re-summarise without re-syncing the sheet.
  let visionRaw: string | null = null;
  const aboutWs = findSheet("About Startup", "About the Startup");
  if (aboutWs) {
    const aboutRows = sheetTo2D(aboutWs);
    const flat = aboutRows.flat().filter((c) => c && c.length > 5);
    if (flat.length > 0) visionRaw = flat.join(" ").trim();
  }

  // ─── Milestones sheet → grab first non-empty Direction & T-Sprint Focus ─
  let direction: string | null = null;
  const milestonesWs = findSheet("Milestones");
  if (milestonesWs) {
    const rows = sheetTo2D(milestonesWs);
    // Find the header row that contains "Direction"
    const headerIdx = rows.findIndex((r) => r.some((c) => labelEq(c, "Direction")));
    if (headerIdx >= 0) {
      const headerRow = rows[headerIdx];
      const dirCol = headerRow.findIndex((c) => labelEq(c, "Direction"));
      // First data row below that has any text in the direction column
      for (let r = headerIdx + 1; r < rows.length; r++) {
        const v = rows[r]?.[dirCol];
        if (v && v.trim()) { direction = v.trim(); break; }
      }
    }
  }

  // ─── SWOT sheet → strengths / gaps / opps / mentor / market ───────────
  let keyStrengths: string | null = null;
  let gaps: string | null = null;
  let opportunities: string | null = null;
  let mentorRecommendation: string | null = null;
  let marketAccess: string | null = null;
  const swotWs = findSheet("SWOT Analysis", "SWOT");
  if (swotWs) {
    const rows = sheetTo2D(swotWs);
    // Each labeled block sits one row below its header.
    for (let r = 0; r < rows.length; r++) {
      const row = rows[r];
      for (let c = 0; c < row.length; c++) {
        const cell = row[c];
        if (!cell) continue;
        const value = rows[r + 1]?.[c] ?? null;
        if (labelHas(cell, "Key Strengths") && !keyStrengths) keyStrengths = value?.trim() || null;
        else if (labelHas(cell, "Gaps") && !gaps) gaps = value?.trim() || null;
        else if (labelHas(cell, "Opportunities") && !opportunities) opportunities = value?.trim() || null;
        else if (labelHas(cell, "Mentor Connect", "Expert 1:1", "Office hour Support") && !mentorRecommendation) {
          mentorRecommendation = value?.trim() || null;
        }
        else if (labelHas(cell, "Market Access", "Market Connect") && !marketAccess) {
          marketAccess = value?.trim() || null;
        }
      }
    }
  }

  // ─── Funding sheet ────────────────────────────────────────────────────
  // All Funding values sit in the cell DIRECTLY BELOW their label
  // (column B label → column B next-row value). Confirmed by Rishu in v5.1.
  let fundingStatus: string | null = null;
  let fundAskCr: number | null = null;
  let previousFundraiseCr: string | null = null;
  let previousFundraiseOrgs: string | null = null;
  let currentBurn: string | null = null;
  let runway: string | null = null;
  const fundingWs = findSheet("Funding");
  if (fundingWs) {
    const rows = sheetTo2D(fundingWs);
    fundingStatus = findValueBelow(rows, "Current funding status");
    fundAskCr = num(findValueBelow(rows,
      "Fund Ask  (in crores)", "Fund Ask (in crores)", "Fund Ask in crores"));
    previousFundraiseCr = findValueBelow(rows,
      "Previous Fundraise (in CR) if applicable",
      "Previous Fundraise (in CR)",
      "Previous Fundraise");
    previousFundraiseOrgs = findValueBelow(rows,
      "Previous Fundraise Organisations",
      "Previous Fundraise Organizations");
    currentBurn = findValueBelow(rows,
      "Current Burn if applicable",
      "Current Burn",
      "Burn Rate",
      "Burn");
    runway = findValueBelow(rows, "Runway");
  }

  // ─── Metrics sheet (v5.1) ─────────────────────────────────────────────
  // Three fields, ALL beside the label (column B label → column C value).
  let nextStageGoal: string | null = null;
  let nextStageRunway: string | null = null;
  let fundsFor: string | null = null;
  const metricsWs = findSheet("Metrics", "Sprint Metrics");
  if (metricsWs) {
    const rows = sheetTo2D(metricsWs);
    nextStageGoal = findValueRight(rows,
      "Quantifiable goal for the next stage of the startup",
      "Quantifiable goal for the next stage",
      "Quantifiable goal");
    nextStageRunway = findValueRight(rows,
      "Runway for the next stage (post funding)",
      "Runway for the next stage",
      "Runway post funding");
    fundsFor = findValueRight(rows,
      "Funds for (broader what needs to be built)",
      "Funds for",
      "Use of Funds");
  }

  // ─── SMART Goals sheet → actionable steps + 3-month goal + revenue ────
  let actionableSteps: string | null = null;
  let smartGoal3Months: string | null = null;
  let revenueLast12Months: string | null = null;
  let revenueLastMonthMrr: string | null = null;
  let teamSize: number | null = null;
  const smartWs = findSheet("SMART Goals and Financial", "SMART Goals", "SMART");
  if (smartWs) {
    const rows = sheetTo2D(smartWs);
    actionableSteps = findValueByLabel(rows, "Actionable Task", "Actionable Tasks", "Actionable Steps");
    smartGoal3Months = findValueByLabel(rows,
      "SMART Goal (3 months)",
      "SMART Goal 3 months",
      "SMART Goal - 3 months",
      "3 month SMART Goal");
    revenueLast12Months = findValueByLabel(rows, "Last 12 Months Revenue");
    revenueLastMonthMrr = findValueByLabel(rows, "Last Month Revenue (MRR)", "Last Month Revenue", "MRR");
    teamSize = num(findValueByLabel(rows, "Team Size"));
  }

  // ─── Detect stage ─────────────────────────────────────────────────────
  // If any of the post-session fields are filled, we treat the upload as a
  // post-sprint payload. Otherwise it's pre-sprint.
  // Stage detection: only SWOT-and-recommendation fields signal the sprint
  // actually happened. Direction (from Milestones) and `actionableSteps`
  // can sometimes be filled by the consultant BEFORE the sprint as part of
  // initial sheet setup, so they're not reliable indicators on their own.
  // The SWOT block is only ever filled during/after the session.
  const postSessionSignals = [keyStrengths, gaps, mentorRecommendation, marketAccess];
  const detectedStage: ParsedTemplate["detectedStage"] = postSessionSignals.some((v) => v && v.trim().length > 0)
    ? "sprint_done"
    : "pre_sprint";

  const raw: Record<string, unknown> = {
    overview: { companyName, founderName, founderEmail, cohort, deckUrl, sprintHost, coHost },
    about: { visionRaw },
    milestones: { direction },
    swot: { keyStrengths, gaps, opportunities, mentorRecommendation, marketAccess },
    funding: { fundingStatus, fundAskCr, previousFundraiseCr, previousFundraiseOrgs, currentBurn, runway },
    smart: { actionableSteps, smartGoal3Months, revenueLast12Months, revenueLastMonthMrr, teamSize },
    metrics: { nextStageGoal, nextStageRunway, fundsFor },
  };

  return {
    companyName: companyName!,
    founderName: founderName!,
    founderEmail,
    cohort,
    deckUrl,
    sprintHost,
    coHost,
    // vision used to be the long raw paragraph; now it's null on parse and
    // gets populated lazily by the Sprint Data tab's "summarise" endpoint.
    vision: null,
    visionRaw,
    keyStrengths,
    gaps,
    opportunities,
    mentorRecommendation,
    marketAccess,
    direction,
    actionableSteps,
    smartGoal3Months,
    fundingStatus,
    fundAskCr,
    previousFundraiseCr,
    previousFundraiseOrgs,
    currentBurn,
    runway,
    revenueLast12Months,
    revenueLastMonthMrr,
    teamSize,
    nextStageGoal,
    nextStageRunway,
    fundsFor,
    detectedStage,
    raw,
    warnings,
  };
}
