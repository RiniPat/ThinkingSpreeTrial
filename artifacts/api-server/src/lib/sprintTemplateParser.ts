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
  /** Optional — Vision pulled from "About Startup" sheet. */
  vision: string | null;
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
  /** Optional — Current funding status. */
  fundingStatus: string | null;
  /** Optional — Fund ask in crores. */
  fundAskCr: number | null;
  /** Optional — Revenue (last 12 months) as raw text. */
  revenueLast12Months: string | null;
  /** Optional — MRR / last month revenue as raw text. */
  revenueLastMonthMrr: string | null;
  /** Optional — Team size if present. */
  teamSize: number | null;
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
        // Try right
        const right = row[c + 1];
        if (right && right.trim()) return right.trim();
        // Try below
        const below = rows[r + 1]?.[c];
        if (below && below.trim()) return below.trim();
      }
    }
  }
  return null;
}

/** Join non-empty cells of a multi-cell answer into one paragraph. */
function joinNonEmpty(parts: (string | null | undefined)[], sep = " "): string | null {
  const cleaned = parts.map((p) => (p ?? "").trim()).filter(Boolean);
  if (cleaned.length === 0) return null;
  return cleaned.join(sep);
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
  const sprintHost = findValueByLabel(
    overview,
    "T-Sprint Consultants Assigned",
    "T-Sprint Consultant Assigned",
    "Consultant Assigned",
    "Consultants Assigned"
  );
  const coHost = findValueByLabel(
    overview,
    "TSprint organised by",
    "T-Sprint organised by",
    "Sprint organised by",
    "Organised by",
    "Co-Host",
    "Co Host"
  );

  if (!companyName) throw new Error('"Company Name" is missing from the Overview sheet.');
  if (!founderName) throw new Error('"Founder\'s Name" is missing from the Overview sheet.');
  if (!cohort) warnings.push("Cohort not set in Overview — uploaded without a cohort.");

  // ─── About Startup sheet (vision-ish text) ─────────────────────────────
  let vision: string | null = null;
  const aboutWs = findSheet("About Startup", "About the Startup");
  if (aboutWs) {
    const aboutRows = sheetTo2D(aboutWs);
    // Treat the entire first non-empty paragraph as vision.
    const flat = aboutRows.flat().filter((c) => c && c.length > 5);
    if (flat.length > 0) vision = flat.join(" ").trim();
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
  let fundingStatus: string | null = null;
  let fundAskCr: number | null = null;
  const fundingWs = findSheet("Funding");
  if (fundingWs) {
    const rows = sheetTo2D(fundingWs);
    fundingStatus = findValueByLabel(rows, "Current funding status");
    fundAskCr = num(findValueByLabel(rows, "Fund Ask  (in crores)", "Fund Ask (in crores)", "Fund Ask in crores"));
  }

  // ─── SMART Goals sheet → actionable steps + revenue ────────────────────
  let actionableSteps: string | null = null;
  let revenueLast12Months: string | null = null;
  let revenueLastMonthMrr: string | null = null;
  let teamSize: number | null = null;
  const smartWs = findSheet("SMART Goals and Financial", "SMART Goals", "SMART");
  if (smartWs) {
    const rows = sheetTo2D(smartWs);
    actionableSteps = findValueByLabel(rows, "Actionable Task", "Actionable Tasks", "Actionable Steps");
    revenueLast12Months = findValueByLabel(rows, "Last 12 Months Revenue");
    revenueLastMonthMrr = findValueByLabel(rows, "Last Month Revenue (MRR)", "Last Month Revenue", "MRR");
    teamSize = num(findValueByLabel(rows, "Team Size"));
  }

  // ─── Detect stage ─────────────────────────────────────────────────────
  // If any of the post-session fields are filled, we treat the upload as a
  // post-sprint payload. Otherwise it's pre-sprint.
  const postSessionSignals = [keyStrengths, gaps, opportunities, mentorRecommendation, marketAccess, direction, actionableSteps];
  const detectedStage: ParsedTemplate["detectedStage"] = postSessionSignals.some((v) => v && v.trim().length > 0)
    ? "sprint_done"
    : "pre_sprint";

  const raw: Record<string, unknown> = {
    overview: { companyName, founderName, founderEmail, cohort, deckUrl, sprintHost, coHost },
    about: { vision },
    milestones: { direction },
    swot: { keyStrengths, gaps, opportunities, mentorRecommendation, marketAccess },
    funding: { fundingStatus, fundAskCr },
    smart: { actionableSteps, revenueLast12Months, revenueLastMonthMrr, teamSize },
  };

  return {
    companyName: companyName!,
    founderName: founderName!,
    founderEmail,
    cohort,
    deckUrl,
    sprintHost,
    coHost,
    vision,
    keyStrengths,
    gaps,
    opportunities,
    mentorRecommendation,
    marketAccess,
    direction,
    actionableSteps,
    fundingStatus,
    fundAskCr,
    revenueLast12Months,
    revenueLastMonthMrr,
    teamSize,
    detectedStage,
    raw,
    warnings,
  };
}
