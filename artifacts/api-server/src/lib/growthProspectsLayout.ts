/**
 * Shared layout spec for the one-page, client-facing "Growth Prospects"
 * document (§11). Both renderers — renderGrowthProspectsDocx and
 * renderGrowthProspectsPdf — read this file so the DOCX and the (best-effort)
 * PDF stay visually consistent and lay out the SAME content from the SAME JSON.
 *
 * The LLM returns the `GrowthProspectsBrief` (strict schema, §11.2); the code
 * draws the visuals. Field caps in the schema + the truncation helpers here are
 * what keep the output to a single page: a fixed grid, capped arrays, and
 * per-box ellipsis rather than spilling to page 2.
 */

// ──────────────────────── Brief-model (LLM output contract, §11.2) ─────────

export type GrowthStatTile = {
  label: string;              // <= 4 words, e.g. "Monthly revenue"
  value: string;              // number from T-sheet (e.g. "₹5.8L", "3x", "12 → 30") OR qualitative descriptor
  kind: "number" | "qualitative";
  sub?: string;               // <= 6 words context, optional
};

export type GrowthBeforeAfter = {
  dimension: string;          // e.g. "Sales motion"
  before: string;             // <= 8 words
  after: string;              // <= 8 words
};

export type GrowthPhase = {
  phase: string;              // e.g. "Weeks 1–4"
  focus: string;              // <= 10 words
  expectedOutcome: string;    // <= 12 words, concrete
  metric?: string;            // target if grounded, e.g. "CAC ↓ 20%"
};

export type GrowthProjectedImpact = {
  metric: string;             // e.g. "Qualified leads / month"
  from: string;               // current, from inputs
  to: string;                 // realistic target
  timeframe: string;          // e.g. "by month 6"
};

export type GrowthProspectsBrief = {
  companyName: string;
  founderName: string;
  oneLiner: string;
  headline: string;
  sessionRecap: string[];
  statTiles: GrowthStatTile[];
  beforeAfter?: GrowthBeforeAfter[];
  keyStrength: string;
  keyGap: string;
  plan: GrowthPhase[];
  projectedImpact?: GrowthProjectedImpact[];
  howWeHelp: string[];            // 3-4 concrete, benefit-led ways TS helps THIS founder
  whyThinkingSpree: string;
  cta: string;
  needsValidation: string[];
};

// ──────────────────────── Brand + palette ──────────────────────────────────
// Two-colour palette + neutrals, one clean font. Hex WITHOUT the leading '#'
// (docx shading wants it that way; the PDF renderer prepends '#').

export const GP = {
  ink: "1F2937",       // near-black body
  navy: "17335C",      // primary — headers, plan bars
  gold: "B78A2E",      // accent — stat numbers, CTA
  mist: "EEF2F7",      // tile / panel background
  line: "D8DEE7",      // hairline borders
  subtle: "6B7683",    // muted labels
  white: "FFFFFF",
  numberTile: "17335C",   // numeric tiles: navy background, white text
  qualTile: "EEF2F7",     // qualitative tiles: mist background, ink text
  font: "Arial",
} as const;

/** Truncate to `max` chars with an ellipsis so a box never overflows the grid. */
export function truncate(s: string | null | undefined, max: number): string {
  const t = (s ?? "").trim();
  if (t.length <= max) return t;
  return t.slice(0, Math.max(0, max - 1)).trimEnd() + "…";
}

/** Sanitise a company/display name into a safe file basename. */
export function safeFileBase(name: string): string {
  const clean = (name ?? "").trim().replace(/[\/\\:*?"<>|]+/g, " ").replace(/\s+/g, " ").trim();
  return clean || "Company";
}

/** The document title / filename stem: "<Company Name>_Growth Prospects". */
export function growthProspectsFileStem(companyName: string): string {
  return `${safeFileBase(companyName)}_Growth Prospects`;
}

/**
 * The fixed, ordered one-page layout both renderers walk. Keeping the section
 * order + which fields belong where in one place is what makes the DOCX and PDF
 * render the same content. Renderers apply their own primitives (docx cells vs
 * pdf rects) but consume this same normalised, capped view.
 */
export function growthProspectsLayout(brief: GrowthProspectsBrief) {
  return {
    header: {
      company: truncate(brief.companyName, 60),
      founder: truncate(brief.founderName, 60),
      oneLiner: truncate(brief.oneLiner, 110),
      headline: truncate(brief.headline, 80),
    },
    sessionRecap: (brief.sessionRecap ?? []).slice(0, 3).map((s) => truncate(s, 90)),
    statTiles: (brief.statTiles ?? []).slice(0, 4).map((t) => ({
      label: truncate(t.label, 28),
      value: truncate(t.value, 24),
      kind: t.kind === "number" ? ("number" as const) : ("qualitative" as const),
      sub: t.sub ? truncate(t.sub, 40) : "",
    })),
    beforeAfter: (brief.beforeAfter ?? []).slice(0, 3).map((b) => ({
      dimension: truncate(b.dimension, 32),
      before: truncate(b.before, 60),
      after: truncate(b.after, 60),
    })),
    keyStrength: truncate(brief.keyStrength, 130),
    keyGap: truncate(brief.keyGap, 130),
    plan: (brief.plan ?? []).slice(0, 4).map((p) => ({
      phase: truncate(p.phase, 22),
      focus: truncate(p.focus, 80),
      expectedOutcome: truncate(p.expectedOutcome, 100),
      metric: p.metric ? truncate(p.metric, 40) : "",
    })),
    projectedImpact: (brief.projectedImpact ?? []).slice(0, 2).map((p) => ({
      metric: truncate(p.metric, 40),
      from: truncate(p.from, 30),
      to: truncate(p.to, 30),
      timeframe: truncate(p.timeframe, 28),
    })),
    howWeHelp: (brief.howWeHelp ?? []).slice(0, 4).map((s) => truncate(s, 110)),
    whyThinkingSpree: truncate(brief.whyThinkingSpree, 140),
    cta: truncate(brief.cta, 130),
  };
}

export type GrowthProspectsLayout = ReturnType<typeof growthProspectsLayout>;
