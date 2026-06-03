/**
 * Dry-run validator: parses the three Excel files using the SAME header-resolution
 * logic as seed-summary-sheets.ts and prints what it would import — no DB calls.
 * Catches header-name mismatches before the real seed runs.
 */
import XLSX from "xlsx";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);
const DATA_DIR = path.resolve(__dirname, "../seed-data");
const files = ["ISB_Summary_Sheet.xlsx", "JU_Summary_Sheet.xlsx", "Sheet_Tracking.xlsx"];

type Row = (string | number | null)[];

function readSheet(file: string): Row[] {
  if (!fs.existsSync(file)) { console.warn(`MISSING: ${file}`); return []; }
  const wb = XLSX.readFile(file, { cellDates: true });
  return XLSX.utils.sheet_to_json<Row>(wb.Sheets[wb.SheetNames[0]], { header: 1, blankrows: false, defval: null }) as Row[];
}
function s(v: unknown): string | null {
  if (v == null) return null;
  const t = String(v).trim();
  return t.length ? t : null;
}

console.log("\n=== DRY-RUN: would-import counts ===\n");

// ─── ISB / JU summary sheets ──────────────────────────────────────────────
for (const [file, label] of [
  [path.join(DATA_DIR, "ISB_Summary_Sheet.xlsx"), "ISB"],
  [path.join(DATA_DIR, "JU_Summary_Sheet.xlsx"), "JU"],
]) {
  const rows = readSheet(file);
  if (rows.length === 0) continue;
  const headers = (rows[0] ?? []).map(h => String(h ?? "").replace(/\s+/g, " ").trim());
  const idx = (lab: string) => headers.findIndex(h => h.toLowerCase().includes(lab.toLowerCase()));

  const KEY_FIELDS = [
    "Startup", "Consultant", "Stage of the business", "Goal Setting",
    "Last 12 months", "Last month MRR", "no of team members", "Key Strength",
    "Gap", "Concept and Sessions", "Mentor Connect", "Market Access",
    "Ideal Customer", "Timeline for Market", "Observations by TS",
    "Worthy for VC", "Previous Fundraise (in INR)", "Previous Fundraise Organ",
    "Current Burn", "Fund Ask", "commitments or ongoing", "Fundraising related Notes",
    "Fathom", "T- Sprint Intervention", "Tasks", "Current Problem",
    "Suggested Next Step", "next 5 Sprints", "Case study worthy", "Case study theme",
    "Training worthy", "Training Theme", "Level",
  ];
  const resolved = KEY_FIELDS.map(f => [f, idx(f)] as const);
  const unresolved = resolved.filter(([_, i]) => i < 0);

  // Count actual data rows
  let imported = 0, skipped = 0;
  const startupCol = idx("Startup");
  const consultantCol = idx("Consultant");
  const stageCol = idx("Stage of the business");
  for (let r = 1; r < rows.length; r++) {
    const row = rows[r];
    const startup = s(row?.[startupCol] as any);
    if (!startup) { skipped++; continue; }
    const sno = s(row?.[0] as any);
    if (sno && sno.toUpperCase() === "TEMPLATE") { skipped++; continue; }
    if (startup.toUpperCase() === "TEMPLATE") { skipped++; continue; }
    const consultant = s(row?.[consultantCol] as any);
    const stage = s(row?.[stageCol] as any);
    if (!consultant && !stage) { skipped++; continue; }
    if (consultant === "Consultant Name") { skipped++; continue; }
    imported++;
  }
  console.log(`📊 ${label}: ${imported} ventures would import, ${skipped} rows skipped`);
  if (unresolved.length > 0) {
    console.log(`   ⚠ Unresolved headers in ${label}:`);
    unresolved.forEach(([h]) => console.log(`     - "${h}"`));
  } else {
    console.log(`   ✓ All ${KEY_FIELDS.length} key fields mapped`);
  }
}

// ─── Sheet Tracking ───────────────────────────────────────────────────────
const trackRows = readSheet(path.join(DATA_DIR, "Sheet_Tracking.xlsx"));
if (trackRows.length > 0) {
  const headers = (trackRows[0] ?? []).map(h => String(h ?? "").replace(/\s+/g, " ").trim());
  const idx = (lab: string) => headers.findIndex(h => h.toLowerCase() === lab.toLowerCase());
  const I = {
    name: idx("Name"), program: idx("Program Name"), host: idx("Sprint Host"),
    coHost: idx("Co-Host"), sprintDate: idx("Sprint Date"), sessionNumber: idx("Sprint Session Number"),
  };
  let imported = 0, skipped = 0;
  const programs: Record<string, number> = {};
  const hosts: Record<string, number> = {};
  for (let r = 1; r < trackRows.length; r++) {
    const row = trackRows[r];
    const name = s(row?.[I.name] as any);
    const date = row?.[I.sprintDate];
    if (!name || !date) { skipped++; continue; }
    imported++;
    const p = s(row?.[I.program] as any) ?? "(none)";
    const h = s(row?.[I.host] as any) ?? "(none)";
    programs[p] = (programs[p] ?? 0) + 1;
    hosts[h] = (hosts[h] ?? 0) + 1;
  }
  console.log(`\n📅 Sheet Tracking: ${imported} sprints would import, ${skipped} rows skipped`);
  console.log(`   Programs (top 6):`, Object.entries(programs).sort((a, b) => b[1] - a[1]).slice(0, 6));
  console.log(`   Hosts (top 6):`,    Object.entries(hosts).sort((a, b) => b[1] - a[1]).slice(0, 6));
}
console.log("\n✓ Dry-run complete. If counts look right, run `pnpm seed:summary` for real.\n");
