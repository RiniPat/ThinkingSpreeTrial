#!/usr/bin/env node
/**
 * Runs pending SQL migrations + optionally seeds the database on a fresh deploy.
 *
 * Behavior:
 *   1. Skip everything if DATABASE_URL is not set.
 *   2. Apply all .sql files in lib/db/migrations alphabetically.
 *      Each statement is idempotent (CREATE TABLE IF NOT EXISTS, etc.)
 *   3. If `founders` table is empty AND scripts/seed-data/ has xlsx files,
 *      run the seed via pnpm. Otherwise leave data alone.
 *
 * First deploy auto-seeds. Subsequent deploys skip seeding.
 * To re-seed, drop data via Neon SQL Editor, or upload fresh sheets via
 * /admin/import (append-only) in the app.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import pg from "pg";

const { Client } = pg;
const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "..");
const MIGRATIONS_DIR = path.join(ROOT, "lib/db/migrations");
const SEED_DATA_DIR  = path.join(ROOT, "scripts/seed-data");

if (!process.env.DATABASE_URL) {
  console.log("⏭  No DATABASE_URL set — skipping migrations & seed");
  process.exit(0);
}

const ssl = process.env.DATABASE_URL.includes("sslmode=require")
  ? { rejectUnauthorized: false }
  : undefined;

async function runMigrations(client) {
  const files = fs.readdirSync(MIGRATIONS_DIR).filter(f => f.endsWith(".sql")).sort();
  console.log(`🗄  Applying ${files.length} migration(s)…`);
  for (const f of files) {
    const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, f), "utf-8");
    console.log(`   → ${f}`);
    await client.query(sql);
  }
  console.log("✅ Migrations applied");
}

async function shouldSeed(client) {
  // We now check BOTH founders and sprints. If either table is empty we re-run
  // the seed, because we kept hitting a state where founders had been created
  // (manual upload, partial seed) but sprint tracking never made it in, so the
  // Sprint Tracking page rendered empty until the next manual import.
  // The importer itself is fully idempotent (append-only), so re-running is safe.
  try {
    const { rows: fRows } = await client.query("SELECT COUNT(*)::int AS c FROM founders");
    const { rows: sRows } = await client.query("SELECT COUNT(*)::int AS c FROM sprints");
    const founderCount = fRows[0]?.c ?? 0;
    const sprintCount  = sRows[0]?.c ?? 0;
    if (founderCount > 0 && sprintCount > 0) {
      console.log(`⏭  DB already populated (${founderCount} founders, ${sprintCount} sprints) — skipping seed`);
      return false;
    }
    console.log(`📦 DB needs seeding (founders=${founderCount}, sprints=${sprintCount})`);
  } catch (err) {
    console.log("⏭  Cannot read tables — skipping seed:", err.message);
    return false;
  }
  if (!fs.existsSync(SEED_DATA_DIR)) {
    console.log("⏭  No scripts/seed-data/ directory — skipping seed");
    return false;
  }
  const xlsxFiles = fs.readdirSync(SEED_DATA_DIR).filter(f => f.endsWith(".xlsx"));
  if (xlsxFiles.length === 0) {
    console.log("⏭  No xlsx files in scripts/seed-data/ — skipping seed");
    return false;
  }
  console.log(`📦 Found ${xlsxFiles.length} seed file(s); will seed.`);
  return true;
}

function runSeed() {
  console.log("🌱 Running first-time seed…");
  // Use pnpm to invoke tsx — pnpm resolves it via the workspace catalog.
  const result = spawnSync(
    "pnpm",
    ["--filter", "@workspace/scripts", "run", "seed:summary"],
    { cwd: ROOT, stdio: "inherit", env: process.env, shell: true },
  );
  if (result.status !== 0) {
    console.error(`❌ Seed exited with code ${result.status}`);
    console.error("   You can re-run later via: pnpm --filter @workspace/scripts run seed:summary");
    console.error("   Or upload sheets manually via /admin/import in the app.");
    return false;
  }
  console.log("✅ Seed complete");
  return true;
}

const client = new Client({ connectionString: process.env.DATABASE_URL, ssl });
try {
  await client.connect();
  await runMigrations(client);
  const ok = await shouldSeed(client);
  await client.end();
  if (ok) runSeed();
} catch (err) {
  console.error("❌ Migration error:", err.message);
  if (err.stack) console.error("   Stack:", err.stack);
  try { await client.end(); } catch {}
  // Exit 0 so the deploy doesn't break; admin can fix and redeploy / manual-seed.
  process.exit(0);
}
