/**
 * Growth Prospects — DOCX renderer (the GUARANTEED deliverable, §11.1).
 *
 * Draws the one-page layout from `growthProspectsLayout` using the `docx`
 * dependency (tables, shaded cells, coloured chips — the same primitives the
 * internal Journey Report uses). This must always succeed; the PDF is a
 * best-effort companion rendered separately.
 */

import {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
  AlignmentType, BorderStyle, WidthType, ShadingType,
} from "docx";
import {
  GP, growthProspectsLayout, type GrowthProspectsBrief, type GrowthProspectsLayout,
} from "./growthProspectsLayout";

const CONTENT_W = 9360; // US-Letter, 1" margins

const NO_BORDER = { style: BorderStyle.NONE, size: 0, color: "auto" } as const;
const NO_BORDERS = { top: NO_BORDER, bottom: NO_BORDER, left: NO_BORDER, right: NO_BORDER,
  insideHorizontal: NO_BORDER, insideVertical: NO_BORDER } as const;
const HAIR = { style: BorderStyle.SINGLE, size: 2, color: GP.line } as const;
const HAIR_BORDERS = { top: HAIR, bottom: HAIR, left: HAIR, right: HAIR } as const;

function run(text: string, opts: { bold?: boolean; color?: string; size?: number; italics?: boolean } = {}): TextRun {
  return new TextRun({ text, bold: opts.bold, color: opts.color, size: opts.size, italics: opts.italics });
}

function sectionLabel(text: string): Paragraph {
  return new Paragraph({
    spacing: { before: 200, after: 80 },
    children: [run(text.toUpperCase(), { bold: true, color: GP.subtle, size: 16 })],
  });
}

/** A single stat tile as a shaded cell. */
function statTileCell(t: GrowthProspectsLayout["statTiles"][number], width: number): TableCell {
  const numeric = t.kind === "number";
  const bg = numeric ? GP.numberTile : GP.qualTile;
  const valColor = numeric ? GP.white : GP.navy;
  const labelColor = numeric ? "C9D4E4" : GP.subtle;
  const children: Paragraph[] = [
    new Paragraph({ spacing: { after: 20 }, children: [run(t.label, { bold: true, color: labelColor, size: 15 })] }),
    new Paragraph({ children: [run(t.value, { bold: true, color: valColor, size: numeric ? 32 : 22 })] }),
  ];
  if (t.sub) children.push(new Paragraph({ spacing: { before: 20 }, children: [run(t.sub, { color: numeric ? "C9D4E4" : GP.subtle, size: 14 })] }));
  return new TableCell({
    width: { size: width, type: WidthType.DXA },
    borders: HAIR_BORDERS,
    shading: { fill: bg, type: ShadingType.CLEAR, color: "auto" },
    margins: { top: 120, bottom: 120, left: 140, right: 140 },
    children,
  });
}

function planTable(L: GrowthProspectsLayout): Table {
  const W = [1500, 3200, 3200, 1460];
  const header = new TableRow({
    tableHeader: true,
    children: ["Phase", "Focus", "Expected outcome", "Target"].map((h, i) => new TableCell({
      width: { size: W[i], type: WidthType.DXA },
      borders: HAIR_BORDERS,
      shading: { fill: GP.navy, type: ShadingType.CLEAR, color: "auto" },
      margins: { top: 80, bottom: 80, left: 120, right: 120 },
      children: [new Paragraph({ children: [run(h, { bold: true, color: GP.white, size: 16 })] })],
    })),
  });
  const rows = L.plan.map((p, idx) => new TableRow({
    children: [
      new TableCell({
        width: { size: W[0], type: WidthType.DXA }, borders: HAIR_BORDERS,
        shading: { fill: idx % 2 ? GP.white : GP.mist, type: ShadingType.CLEAR, color: "auto" },
        margins: { top: 80, bottom: 80, left: 120, right: 120 },
        children: [new Paragraph({ children: [run(p.phase, { bold: true, color: GP.navy, size: 16 })] })],
      }),
      cellText(p.focus, W[1], idx),
      cellText(p.expectedOutcome, W[2], idx),
      cellText(p.metric || "—", W[3], idx),
    ],
  }));
  return new Table({ width: { size: CONTENT_W, type: WidthType.DXA }, columnWidths: W, rows: [header, ...rows] });
}

function cellText(text: string, width: number, idx: number): TableCell {
  return new TableCell({
    width: { size: width, type: WidthType.DXA }, borders: HAIR_BORDERS,
    shading: { fill: idx % 2 ? GP.white : GP.mist, type: ShadingType.CLEAR, color: "auto" },
    margins: { top: 80, bottom: 80, left: 120, right: 120 },
    children: [new Paragraph({ children: [run(text, { size: 16, color: GP.ink })] })],
  });
}

/** Render the DOCX. Always succeeds for a well-formed brief. */
export async function renderGrowthProspectsDocx(brief: GrowthProspectsBrief): Promise<Buffer> {
  const L = growthProspectsLayout(brief);

  const children: (Paragraph | Table)[] = [];

  // ── Header ────────────────────────────────────────────────────────────────
  children.push(new Paragraph({
    spacing: { after: 20 },
    children: [run("THINKING SPREE", { bold: true, color: GP.gold, size: 16 }), run("   ·   Growth Prospects", { color: GP.subtle, size: 16 })],
  }));
  children.push(new Paragraph({
    spacing: { after: 40 },
    children: [run(L.header.company, { bold: true, color: GP.navy, size: 40 })],
  }));
  if (L.header.headline) children.push(new Paragraph({ spacing: { after: 20 }, children: [run(L.header.headline, { bold: true, color: GP.ink, size: 24 })] }));
  const subBits = [L.header.oneLiner, L.header.founder ? `Founder: ${L.header.founder}` : ""].filter(Boolean);
  if (subBits.length) children.push(new Paragraph({ spacing: { after: 60 }, children: [run(subBits.join("  ·  "), { color: GP.subtle, size: 16 })] }));

  // ── Session recap ──────────────────────────────────────────────────────────
  if (L.sessionRecap.length) {
    children.push(sectionLabel("What we worked on"));
    for (const s of L.sessionRecap) children.push(new Paragraph({ bullet: { level: 0 }, spacing: { after: 40 }, children: [run(s, { size: 17, color: GP.ink })] }));
  }

  // ── Stat tiles row ───────────────────────────────────────────────────────
  if (L.statTiles.length) {
    children.push(sectionLabel("Momentum"));
    const n = L.statTiles.length;
    const w = Math.floor(CONTENT_W / n);
    children.push(new Table({
      width: { size: CONTENT_W, type: WidthType.DXA },
      columnWidths: L.statTiles.map(() => w),
      borders: NO_BORDERS,
      rows: [new TableRow({ children: L.statTiles.map((t) => statTileCell(t, w)) })],
    }));
  }

  // ── Before / after ─────────────────────────────────────────────────────────
  if (L.beforeAfter.length) {
    children.push(sectionLabel("Distance travelled"));
    const W = [2600, 3380, 3380];
    const rows: TableRow[] = [new TableRow({
      tableHeader: true,
      children: ["", "Before", "Now"].map((h, i) => new TableCell({
        width: { size: W[i], type: WidthType.DXA }, borders: HAIR_BORDERS,
        shading: { fill: GP.mist, type: ShadingType.CLEAR, color: "auto" },
        margins: { top: 60, bottom: 60, left: 120, right: 120 },
        children: [new Paragraph({ children: [run(h, { bold: true, color: GP.subtle, size: 15 })] })],
      })),
    })];
    for (const b of L.beforeAfter) {
      rows.push(new TableRow({ children: [
        new TableCell({ width: { size: W[0], type: WidthType.DXA }, borders: HAIR_BORDERS, margins: { top: 60, bottom: 60, left: 120, right: 120 }, children: [new Paragraph({ children: [run(b.dimension, { bold: true, color: GP.navy, size: 16 })] })] }),
        new TableCell({ width: { size: W[1], type: WidthType.DXA }, borders: HAIR_BORDERS, margins: { top: 60, bottom: 60, left: 120, right: 120 }, children: [new Paragraph({ children: [run(b.before, { color: GP.subtle, size: 16 })] })] }),
        new TableCell({ width: { size: W[2], type: WidthType.DXA }, borders: HAIR_BORDERS, margins: { top: 60, bottom: 60, left: 120, right: 120 }, children: [new Paragraph({ children: [run(b.after, { color: GP.ink, size: 16 })] })] }),
      ]}));
    }
    children.push(new Table({ width: { size: CONTENT_W, type: WidthType.DXA }, columnWidths: W, rows }));
  }

  // ── Strength / gap ─────────────────────────────────────────────────────────
  if (L.keyStrength || L.keyGap) {
    const W = [4680, 4680];
    children.push(sectionLabel("Where you stand"));
    children.push(new Table({
      width: { size: CONTENT_W, type: WidthType.DXA }, columnWidths: W,
      rows: [new TableRow({ children: [
        panelCell("Key strength", L.keyStrength || "—", W[0], GP.navy),
        panelCell("The constraint we'd tackle", L.keyGap || "—", W[1], GP.gold),
      ]})],
    }));
  }

  // ── Plan ──────────────────────────────────────────────────────────────────
  if (L.plan.length) {
    children.push(sectionLabel("The next 3–6 months"));
    children.push(planTable(L));
  }

  // ── Projected impact ───────────────────────────────────────────────────────
  if (L.projectedImpact.length) {
    children.push(sectionLabel("Targets (projections, not promises)"));
    for (const p of L.projectedImpact) {
      children.push(new Paragraph({ spacing: { after: 40 }, children: [
        run(`${p.metric}: `, { bold: true, color: GP.navy, size: 16 }),
        run(`${p.from} → ${p.to} `, { color: GP.ink, size: 16 }),
        run(p.timeframe, { color: GP.subtle, size: 15 }),
      ]}));
    }
  }

  // ── Why + CTA footer ───────────────────────────────────────────────────────
  if (L.whyThinkingSpree) children.push(new Paragraph({ spacing: { before: 160, after: 40 }, children: [run(L.whyThinkingSpree, { italics: true, color: GP.ink, size: 17 })] }));
  if (L.cta) children.push(new Paragraph({
    spacing: { before: 40 },
    shading: { fill: GP.mist, type: ShadingType.CLEAR, color: "auto" },
    border: { top: { style: BorderStyle.SINGLE, size: 6, color: GP.gold, space: 6 } },
    children: [run(L.cta, { bold: true, color: GP.navy, size: 18 })],
  }));

  const doc = new Document({
    styles: { default: { document: { run: { font: GP.font, size: 18, color: GP.ink } } } },
    sections: [{
      properties: { page: { size: { width: 12240, height: 15840 }, margin: { top: 1080, right: 1440, bottom: 1080, left: 1440 } } },
      children,
    }],
  });
  return await Packer.toBuffer(doc) as unknown as Buffer;
}

function panelCell(label: string, body: string, width: number, accent: string): TableCell {
  return new TableCell({
    width: { size: width, type: WidthType.DXA },
    borders: HAIR_BORDERS,
    shading: { fill: GP.mist, type: ShadingType.CLEAR, color: "auto" },
    margins: { top: 120, bottom: 120, left: 140, right: 140 },
    children: [
      new Paragraph({ spacing: { after: 30 }, children: [run(label.toUpperCase(), { bold: true, color: accent, size: 14 })] }),
      new Paragraph({ children: [run(body, { color: GP.ink, size: 17 })] }),
    ],
  });
}
