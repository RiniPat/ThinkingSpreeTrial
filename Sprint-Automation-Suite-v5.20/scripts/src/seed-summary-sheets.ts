/**
 * Deploy-time + manual seed runner.
 *
 * Reads the three xlsx files from scripts/seed-data/ and imports them.
 * Idempotent — re-running adds new rows without modifying existing ones.
 *
 * Usage:
 *   pnpm tsx scripts/src/seed-summary-sheets.ts
 *   # or via the package script:
 *   pnpm --filter @workspace/scripts seed:summary
 *
 * Reuses the shared importer in artifacts/api-server/src/lib/importer.ts
 * so the same logic powers both deploy-time seeding and the in-app
 * /admin/import upload route.
 */
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

import {
  ensureCoreIncubators,
  importSummarySheet,
  importSprintTracking,
  readFile,
} from "@workspace/importer";

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);
const DATA_DIR = path.resolve(__dirname, "../seed-data");

async function main() {
  console.log("🌱 Seeding from", DATA_DIR);

  const { isb, ju, demo } = await ensureCoreIncubators();
  console.log(`✓ Incubators: ISB=${isb.id}  JU=${ju.id}  Demo=${demo.id}`);

  const isbFile      = path.join(DATA_DIR, "ISB_Summary_Sheet.xlsx");
  const juFile       = path.join(DATA_DIR, "JU_Summary_Sheet.xlsx");
  const trackingFile = path.join(DATA_DIR, "Sheet_Tracking.xlsx");

  if (fs.existsSync(isbFile)) {
    const sheets = readFile(isbFile);
    const firstName = Object.keys(sheets)[0];
    const r = await importSummarySheet(sheets[firstName], "ISB", isb.id);
    console.log(`📊 ISB summary: ${r.imported} imported, ${r.skipped} skipped`);
  } else {
    console.log("⏭  ISB summary file not present, skipping");
  }
  if (fs.existsSync(juFile)) {
    const sheets = readFile(juFile);
    const firstName = Object.keys(sheets)[0];
    const r = await importSummarySheet(sheets[firstName], "JU", ju.id);
    console.log(`📊 JU summary: ${r.imported} imported, ${r.skipped} skipped`);
  } else {
    console.log("⏭  JU summary file not present, skipping");
  }
  if (fs.existsSync(trackingFile)) {
    const sheets = readFile(trackingFile);
    const firstName = Object.keys(sheets)[0];
    const r = await importSprintTracking(sheets[firstName]);
    console.log(`📅 Sheet tracking: ${r.imported} imported, ${r.skipped} skipped, ${r.existing} already-existed`);
  } else {
    console.log("⏭  Sheet Tracking file not present, skipping");
  }
  console.log("✅ Seed complete");
}

main().then(() => process.exit(0)).catch(err => {
  console.error("Seed failed:", err);
  process.exit(1);
});
