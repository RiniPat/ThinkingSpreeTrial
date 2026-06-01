/**
 * Assemble the Journey Report as a .docx that matches the Bull AgriTech
 * reference exactly: 5 sections + Annexure, with RAG-colored cells in
 * Sections 3 and Annexure.
 *
 * RAG hex colors (no #, per docx-js shading API):
 *   GREEN = 92d050, AMBER = ffc000, RED = ff0000.
 */

import {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
  HeadingLevel, AlignmentType, BorderStyle, WidthType, ShadingType,
} from "docx";
import type { JourneyReport, RAG, StreamRow, AnnexureRow, Sprint } from "./growthReportAi";

const RAG_HEX: Record<string, string> = {
  GREEN: "92d050",
  AMBER: "ffc000",
  RED: "ff0000",
  "": "ffffff",   // ungraded → white
};

const BORDER = { style: BorderStyle.SINGLE, size: 4, color: "888888" } as const;
const BORDERS = { top: BORDER, bottom: BORDER, left: BORDER, right: BORDER };

/** Default cell shading (white). Caller can override for RAG colors. */
function cell(text: string | Paragraph[], opts: { width: number; shadeHex?: string; bold?: boolean } = { width: 2000 }): TableCell {
  const paragraphs = Array.isArray(text)
    ? text
    : [new Paragraph({ children: [new TextRun({ text, bold: opts.bold ?? false })] })];
  return new TableCell({
    borders: BORDERS,
    width: { size: opts.width, type: WidthType.DXA },
    shading: opts.shadeHex
      ? { fill: opts.shadeHex, type: ShadingType.CLEAR, color: "auto" }
      : undefined,
    margins: { top: 80, bottom: 80, left: 120, right: 120 },
    children: paragraphs,
  });
}

/** A cell that displays the RAG color as background with the text label. */
function ragCell(rag: RAG, width: number): TableCell {
  const hex = RAG_HEX[rag] ?? "ffffff";
  // White text on red/amber for legibility; black otherwise.
  const fg = rag === "RED" ? "ffffff" : "000000";
  return new TableCell({
    borders: BORDERS,
    width: { size: width, type: WidthType.DXA },
    shading: { fill: hex, type: ShadingType.CLEAR, color: "auto" },
    margins: { top: 80, bottom: 80, left: 120, right: 120 },
    children: [
      new Paragraph({
        alignment: AlignmentType.CENTER,
        children: [new TextRun({ text: rag || "—", bold: true, color: fg })],
      }),
    ],
  });
}

function headerCell(text: string, width: number): TableCell {
  return new TableCell({
    borders: BORDERS,
    width: { size: width, type: WidthType.DXA },
    shading: { fill: "f2f2f2", type: ShadingType.CLEAR, color: "auto" },
    margins: { top: 80, bottom: 80, left: 120, right: 120 },
    children: [new Paragraph({ children: [new TextRun({ text, bold: true })] })],
  });
}

function h1(text: string): Paragraph {
  return new Paragraph({
    heading: HeadingLevel.HEADING_1,
    spacing: { before: 360, after: 180 },
    children: [new TextRun({ text, bold: true, size: 28 })],
  });
}

function para(text: string): Paragraph {
  return new Paragraph({
    spacing: { after: 160 },
    children: [new TextRun(text)],
  });
}

function bullet(text: string): Paragraph {
  return new Paragraph({
    spacing: { after: 80 },
    bullet: { level: 0 },
    children: [new TextRun(text)],
  });
}

/**
 * Build and pack the full report as a Buffer. Caller is responsible for
 * persisting (we base64-encode + store in the DB).
 */
export async function buildJourneyReportDocx(opts: {
  startupName: string;
  report: JourneyReport;
}): Promise<Buffer> {
  const r = opts.report;

  // Page is US Letter, 1" margins. Content width = 9360 DXA.
  const CONTENT_W = 9360;
  const STREAM_COL_WIDTHS = [1700, 800, 2400, 2230, 2230];        // section 3
  const ANNEX_COL_WIDTHS = [1500, 2000, 1500, 800, 3560];          // annexure
  const SPRINT_COL_WIDTHS = [700, 2200, 4200, 2260];               // section 4

  // ─── Section 1 — Venture Snapshot ──────────────────────────────────
  const section1Table = new Table({
    width: { size: CONTENT_W, type: WidthType.DXA },
    columnWidths: [3120, 3120, 3120],
    rows: [
      new TableRow({
        children: [
          headerCell("Core Products / Services", 3120),
          headerCell("Largest Market Segments", 3120),
          headerCell("Core Geographies", 3120),
        ],
      }),
      new TableRow({
        children: [
          cell(r.section1.table.coreProducts, { width: 3120 }),
          cell(r.section1.table.largestSegments, { width: 3120 }),
          cell(r.section1.table.coreGeographies, { width: 3120 }),
        ],
      }),
    ],
  });

  // ─── Section 2 — Growth Vision ─────────────────────────────────────
  const section2Table = new Table({
    width: { size: CONTENT_W, type: WidthType.DXA },
    columnWidths: [2000, 1500, 5860],
    rows: [
      new TableRow({
        children: [
          headerCell("Growth Lever", 2000),
          headerCell("New", 1500),
          headerCell("Description", 5860),
        ],
      }),
      new TableRow({
        children: [
          cell("Product/Service", { width: 2000, bold: true }),
          cell(r.section2.table.product.isNew, { width: 1500 }),
          cell(r.section2.table.product.description, { width: 5860 }),
        ],
      }),
      new TableRow({
        children: [
          cell("Market Segment", { width: 2000, bold: true }),
          cell(r.section2.table.market.isNew, { width: 1500 }),
          cell(r.section2.table.market.description, { width: 5860 }),
        ],
      }),
      new TableRow({
        children: [
          cell("Geography", { width: 2000, bold: true }),
          cell(r.section2.table.geography.isNew, { width: 1500 }),
          cell(r.section2.table.geography.description, { width: 5860 }),
        ],
      }),
    ],
  });

  // ─── Section 3 — Streams ───────────────────────────────────────────
  const section3Table = new Table({
    width: { size: CONTENT_W, type: WidthType.DXA },
    columnWidths: STREAM_COL_WIDTHS,
    rows: [
      new TableRow({
        children: [
          headerCell("Stream", STREAM_COL_WIDTHS[0]),
          headerCell("RAG", STREAM_COL_WIDTHS[1]),
          headerCell("Support Required", STREAM_COL_WIDTHS[2]),
          headerCell("12-Month Goal", STREAM_COL_WIDTHS[3]),
          headerCell("36-Month Goal", STREAM_COL_WIDTHS[4]),
        ],
      }),
      ...r.section3.streams.map((s: StreamRow) => new TableRow({
        children: [
          cell(s.stream, { width: STREAM_COL_WIDTHS[0], bold: true }),
          ragCell(s.rag, STREAM_COL_WIDTHS[1]),
          cell(s.supportRequired, { width: STREAM_COL_WIDTHS[2] }),
          cell(s.twelveMonthGoal, { width: STREAM_COL_WIDTHS[3] }),
          cell(s.thirtySixMonthGoal, { width: STREAM_COL_WIDTHS[4] }),
        ],
      })),
    ],
  });

  // ─── Section 4 — Sprints ──────────────────────────────────────────
  const section4Table = new Table({
    width: { size: CONTENT_W, type: WidthType.DXA },
    columnWidths: SPRINT_COL_WIDTHS,
    rows: [
      new TableRow({
        children: [
          headerCell("Sprint", SPRINT_COL_WIDTHS[0]),
          headerCell("Sprint Definition", SPRINT_COL_WIDTHS[1]),
          headerCell("Min. 3 Outcomes Expected", SPRINT_COL_WIDTHS[2]),
          headerCell("Expert Profile", SPRINT_COL_WIDTHS[3]),
        ],
      }),
      ...r.section4.sprints.map((s: Sprint) => new TableRow({
        children: [
          cell(String(s.number), { width: SPRINT_COL_WIDTHS[0], bold: true }),
          cell(s.definition, { width: SPRINT_COL_WIDTHS[1] }),
          cell(
            // Render outcomes as numbered list inside the cell
            s.outcomes.map((o, i) => new Paragraph({
              spacing: { after: 60 },
              children: [new TextRun(`${i + 1}. ${o}`)],
            })),
            { width: SPRINT_COL_WIDTHS[2] },
          ),
          cell(s.expertProfile, { width: SPRINT_COL_WIDTHS[3] }),
        ],
      })),
    ],
  });

  // ─── Annexure ─────────────────────────────────────────────────────
  const annexureTable = new Table({
    width: { size: CONTENT_W, type: WidthType.DXA },
    columnWidths: ANNEX_COL_WIDTHS,
    rows: [
      new TableRow({
        children: [
          headerCell("Stream", ANNEX_COL_WIDTHS[0]),
          headerCell("36-Month Goal", ANNEX_COL_WIDTHS[1]),
          headerCell("Sub-Stream", ANNEX_COL_WIDTHS[2]),
          headerCell("RAG", ANNEX_COL_WIDTHS[3]),
          headerCell("Indicative Execution Focus", ANNEX_COL_WIDTHS[4]),
        ],
      }),
      ...r.annexure.map((row: AnnexureRow) => new TableRow({
        children: [
          cell(row.stream, { width: ANNEX_COL_WIDTHS[0], bold: true }),
          cell(row.thirtySixMonthGoal, { width: ANNEX_COL_WIDTHS[1] }),
          cell(row.subStream, { width: ANNEX_COL_WIDTHS[2] }),
          ragCell(row.rag, ANNEX_COL_WIDTHS[3]),
          cell(row.indicativeExecutionFocus, { width: ANNEX_COL_WIDTHS[4] }),
        ],
      })),
    ],
  });

  const doc = new Document({
    styles: {
      default: { document: { run: { font: "Arial", size: 22 } } },
      paragraphStyles: [
        {
          id: "Heading1", name: "Heading 1", basedOn: "Normal", next: "Normal", quickFormat: true,
          run: { size: 28, bold: true, font: "Arial" },
          paragraph: { spacing: { before: 360, after: 180 }, outlineLevel: 0 },
        },
      ],
    },
    sections: [{
      properties: {
        page: {
          size: { width: 12240, height: 15840 },
          margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 },
        },
      },
      children: [
        // Title
        new Paragraph({
          alignment: AlignmentType.CENTER,
          spacing: { after: 360 },
          children: [
            new TextRun({ text: `${opts.startupName} — Growth Journey Report`, bold: true, size: 36 }),
          ],
        }),

        // Section 1
        h1("SECTION 1 — VENTURE SNAPSHOT"),
        para(r.section1.pitch),
        section1Table,

        // Section 2
        h1("SECTION 2 — GROWTH VISION"),
        para(r.section2.pitch),
        section2Table,

        // Section 3
        h1("SECTION 3 — STREAMS, SUPPORT REQUIRED and GOALS"),
        section3Table,

        // Section 4
        h1("SECTION 4 — SUGGESTED SPRINT PLAN"),
        section4Table,

        // Section 5
        h1("SECTION 5 — STRATEGIC SUMMARY"),
        para(r.section5.summary),

        new Paragraph({ spacing: { before: 200, after: 120 }, children: [new TextRun({ text: "Risk", bold: true })] }),
        ...r.section5.risks.map(bullet),

        new Paragraph({ spacing: { before: 200, after: 120 }, children: [new TextRun({ text: "Bottleneck", bold: true })] }),
        ...r.section5.bottlenecks.map(bullet),

        new Paragraph({ spacing: { before: 200, after: 120 }, children: [new TextRun({ text: "Scalability", bold: true })] }),
        ...r.section5.scalability.map(bullet),

        // Annexure
        h1("ANNEXURE — INDICATIVE GROWTH UNLOCKS"),
        new Paragraph({
          spacing: { after: 240 },
          children: [new TextRun({
            text: '"These growth unlocks are indicative, based on discussions held so far. As the company progresses, the streams of support, deliverables under each stream, and their outcomes will change and evolve more clearly with deeper engagement."',
            italics: true,
          })],
        }),
        annexureTable,
      ],
    }],
  });

  return await Packer.toBuffer(doc) as unknown as Buffer;
}
