/**
 * Growth Prospects — PDF renderer (BEST-EFFORT, §11.1).
 *
 * Draws the SAME one-page layout as the DOCX using `pdfkit` primitives (rects,
 * text — no headless browser, which Render can't run). PDF is a best-effort
 * companion: if `pdfkit` isn't installed or rendering fails for any reason,
 * this throws and the caller logs it, skips the PDF, and ships DOCX only. A
 * PDF failure must NEVER block the DOCX or the email.
 *
 * `pdfkit` is imported through an indirect specifier so the api-server type
 * checks and builds cleanly whether or not the optional dependency is present;
 * when it is absent the dynamic import rejects at runtime and is caught above.
 */

import { GP, growthProspectsLayout, type GrowthProspectsBrief } from "./growthProspectsLayout";

const hex = (h: string) => `#${h}`;

/** Load pdfkit without a static module reference (keeps it a true optional dep). */
async function loadPdfKit(): Promise<any> {
  const spec = ["pdf", "kit"].join(""); // avoid static resolution of "pdfkit"
  const mod: any = await import(spec);
  const PDFDocument = mod?.default ?? mod;
  if (typeof PDFDocument !== "function") throw new Error("pdfkit is not available");
  return PDFDocument;
}

export async function isGrowthPdfAvailable(): Promise<boolean> {
  try { await loadPdfKit(); return true; } catch { return false; }
}

/**
 * Render the one-page PDF. Rejects if pdfkit is unavailable or drawing fails —
 * the caller treats a rejection as "no PDF this time" (best-effort).
 */
export async function renderGrowthProspectsPdf(brief: GrowthProspectsBrief): Promise<Buffer> {
  const PDFDocument = await loadPdfKit();
  const L = growthProspectsLayout(brief);

  return await new Promise<Buffer>((resolve, reject) => {
    try {
      const M = 48;                        // margin
      const PAGE_W = 612, PAGE_H = 792;    // US Letter (points)
      const W = PAGE_W - M * 2;            // content width
      const doc = new PDFDocument({ size: "LETTER", margins: { top: M, bottom: M, left: M, right: M } });
      const chunks: Buffer[] = [];
      doc.on("data", (c: Buffer) => chunks.push(c));
      doc.on("end", () => resolve(Buffer.concat(chunks)));
      doc.on("error", reject);

      let y = M;

      // Header
      doc.fillColor(hex(GP.gold)).font("Helvetica-Bold").fontSize(9).text("THINKING SPREE  ·  GROWTH PROSPECTS", M, y);
      y += 16;
      doc.fillColor(hex(GP.navy)).font("Helvetica-Bold").fontSize(24).text(L.header.company, M, y, { width: W });
      y = doc.y + 2;
      if (L.header.headline) { doc.fillColor(hex(GP.ink)).font("Helvetica-Bold").fontSize(13).text(L.header.headline, M, y, { width: W }); y = doc.y + 2; }
      const sub = [L.header.oneLiner, L.header.founder ? `Founder: ${L.header.founder}` : ""].filter(Boolean).join("   ·   ");
      if (sub) { doc.fillColor(hex(GP.subtle)).font("Helvetica").fontSize(9).text(sub, M, y, { width: W }); y = doc.y; }
      y += 10;

      const label = (text: string) => {
        doc.fillColor(hex(GP.subtle)).font("Helvetica-Bold").fontSize(8).text(text.toUpperCase(), M, y, { characterSpacing: 0.5 });
        y = doc.y + 4;
      };

      // Session recap
      if (L.sessionRecap.length) {
        label("What we worked on");
        for (const s of L.sessionRecap) {
          doc.fillColor(hex(GP.navy)).font("Helvetica-Bold").fontSize(9).text("•", M, y, { continued: true });
          doc.fillColor(hex(GP.ink)).font("Helvetica").fontSize(9).text("  " + s, { width: W - 8 });
          y = doc.y + 2;
        }
        y += 6;
      }

      // Stat tiles
      if (L.statTiles.length) {
        label("Momentum");
        const n = L.statTiles.length, gap = 10;
        const tw = (W - gap * (n - 1)) / n, th = 58;
        L.statTiles.forEach((t, i) => {
          const x = M + i * (tw + gap);
          const numeric = t.kind === "number";
          doc.roundedRect(x, y, tw, th, 5).fill(hex(numeric ? GP.numberTile : GP.qualTile));
          doc.fillColor(hex(numeric ? "C9D4E4" : GP.subtle)).font("Helvetica-Bold").fontSize(7).text(t.label.toUpperCase(), x + 8, y + 8, { width: tw - 16 });
          doc.fillColor(hex(numeric ? GP.white : GP.navy)).font("Helvetica-Bold").fontSize(numeric ? 16 : 12).text(t.value, x + 8, y + 22, { width: tw - 16 });
          if (t.sub) doc.fillColor(hex(numeric ? "C9D4E4" : GP.subtle)).font("Helvetica").fontSize(6.5).text(t.sub, x + 8, y + th - 14, { width: tw - 16 });
        });
        y += th + 12;
      }

      // Before / after
      if (L.beforeAfter.length) {
        label("Distance travelled");
        const col = [W * 0.28, W * 0.36, W * 0.36];
        L.beforeAfter.forEach((b) => {
          const rowY = y;
          doc.fillColor(hex(GP.navy)).font("Helvetica-Bold").fontSize(9).text(b.dimension, M, rowY, { width: col[0] - 6 });
          doc.fillColor(hex(GP.subtle)).font("Helvetica").fontSize(9).text(b.before, M + col[0], rowY, { width: col[1] - 6 });
          doc.fillColor(hex(GP.ink)).font("Helvetica").fontSize(9).text("→ " + b.after, M + col[0] + col[1], rowY, { width: col[2] - 6 });
          y = Math.max(doc.y, rowY + 12) + 3;
        });
        y += 6;
      }

      // Strength / gap
      if (L.keyStrength || L.keyGap) {
        label("Where you stand");
        const gap = 10, cw = (W - gap) / 2, ch = 56;
        const panel = (x: number, title: string, body: string, accent: string) => {
          doc.roundedRect(x, y, cw, ch, 5).fill(hex(GP.mist));
          doc.fillColor(hex(accent)).font("Helvetica-Bold").fontSize(7).text(title.toUpperCase(), x + 8, y + 8, { width: cw - 16 });
          doc.fillColor(hex(GP.ink)).font("Helvetica").fontSize(9).text(body, x + 8, y + 20, { width: cw - 16, height: ch - 26, ellipsis: true });
        };
        panel(M, "Key strength", L.keyStrength || "—", GP.navy);
        panel(M + cw + gap, "The constraint we'd tackle", L.keyGap || "—", GP.gold);
        y += ch + 12;
      }

      // Plan
      if (L.plan.length) {
        label("The next 3–6 months");
        const cols = [W * 0.16, W * 0.34, W * 0.34, W * 0.16];
        // header row
        doc.rect(M, y, W, 16).fill(hex(GP.navy));
        const heads = ["Phase", "Focus", "Expected outcome", "Target"];
        let hx = M;
        heads.forEach((h, i) => { doc.fillColor(hex(GP.white)).font("Helvetica-Bold").fontSize(7.5).text(h.toUpperCase(), hx + 5, y + 4.5, { width: cols[i] - 8 }); hx += cols[i]; });
        y += 16;
        L.plan.forEach((p, idx) => {
          const cells = [p.phase, p.focus, p.expectedOutcome, p.metric || "—"];
          const rowY = y;
          // measure tallest
          let maxH = 12;
          const startX: number[] = [];
          let cx = M;
          cells.forEach((c, i) => { startX[i] = cx; const h = doc.font(i === 0 ? "Helvetica-Bold" : "Helvetica").fontSize(8).heightOfString(c, { width: cols[i] - 8 }); maxH = Math.max(maxH, h); cx += cols[i]; });
          doc.rect(M, rowY, W, maxH + 8).fill(hex(idx % 2 ? GP.white : GP.mist));
          cells.forEach((c, i) => {
            doc.font(i === 0 ? "Helvetica-Bold" : "Helvetica").fontSize(8).fillColor(hex(i === 0 ? GP.navy : GP.ink)).text(c, startX[i] + 5, rowY + 4, { width: cols[i] - 8 });
          });
          y = rowY + maxH + 8;
        });
        y += 10;
      }

      // Projected impact
      if (L.projectedImpact.length) {
        label("Targets (projections, not promises)");
        L.projectedImpact.forEach((p) => {
          doc.font("Helvetica-Bold").fontSize(9).fillColor(hex(GP.navy)).text(`${p.metric}: `, M, y, { continued: true });
          doc.font("Helvetica").fillColor(hex(GP.ink)).text(`${p.from} → ${p.to} `, { continued: true });
          doc.fillColor(hex(GP.subtle)).fontSize(8).text(p.timeframe);
          y = doc.y + 3;
        });
        y += 6;
      }

      // Why + CTA
      if (L.whyThinkingSpree) { doc.font("Helvetica-Oblique").fontSize(9.5).fillColor(hex(GP.ink)).text(L.whyThinkingSpree, M, y, { width: W }); y = doc.y + 8; }
      if (L.cta) {
        const ch = Math.max(24, doc.font("Helvetica-Bold").fontSize(11).heightOfString(L.cta, { width: W - 24 }) + 14);
        doc.roundedRect(M, y, W, ch, 5).fill(hex(GP.mist));
        doc.rect(M, y, 4, ch).fill(hex(GP.gold));
        doc.fillColor(hex(GP.navy)).font("Helvetica-Bold").fontSize(11).text(L.cta, M + 14, y + 7, { width: W - 24 });
      }

      doc.end();
    } catch (err) {
      reject(err);
    }
  });
}
