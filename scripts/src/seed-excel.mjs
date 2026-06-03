/**
 * One-shot seed script: imports JU/ISB ventures + Sheet Tracking sprints
 * Run with: node scripts/src/seed-excel.mjs
 */
import { createRequire } from "module";
import { fileURLToPath } from "url";
import path from "path";

const require = createRequire(import.meta.url);
const XLSX = require("/home/runner/workspace/node_modules/.pnpm/xlsx@0.18.5/node_modules/xlsx/xlsx.js");
const pg = require("/home/runner/workspace/lib/db/node_modules/pg");

const { Client } = pg;
const client = new Client({ connectionString: process.env.DATABASE_URL });
await client.connect();

// ── helpers ────────────────────────────────────────────────────────────────

function slug(name) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
}

function fakeEmail(company) {
  return `founder@${slug(company).slice(0, 20)}.com`;
}

function normConsultant(name) {
  const n = (name || "").trim().toLowerCase();
  if (n.startsWith("pritesh")) return "Pritesh Yeole";
  if (n.startsWith("vani")) return "Vani Agarwal";
  if (n.startsWith("rishu")) return "Rishu Pathak";
  if (n.startsWith("jyoti")) return "Jyoti";
  if (n.startsWith("saumitra")) return "Saumitra";
  if (n.startsWith("nitya")) return "Nitya";
  if (n.startsWith("sakshi")) return "Sakshi";
  if (n.startsWith("sovit")) return "Sovit";
  if (n.startsWith("tanya")) return "Tanya";
  if (n.startsWith("anukrati")) return "Anukrati";
  if (n.startsWith("bhumika")) return "Bhumika";
  return name || "Consultant";
}

function excelDateToStr(serial) {
  if (!serial || typeof serial !== "number") return null;
  const d = new Date((serial - 25569) * 86400 * 1000);
  return d.toISOString().split("T")[0];
}

function excelTimeToStr(frac) {
  if (!frac || typeof frac !== "number") return null;
  const totalMins = Math.round(frac * 24 * 60);
  const h = Math.floor(totalMins / 60);
  const m = totalMins % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

function truncate(str, len = 1000) {
  if (!str || typeof str !== "string") return null;
  return str.trim().slice(0, len) || null;
}

// ── 1. Ensure base incubators exist, get/create extras ───────────────────

const PROGRAM_TO_INCUBATOR = {}; // program name → incubator id

async function upsertIncubator(name, type = "incubator", description = null) {
  const existing = await client.query("SELECT id FROM incubators WHERE name = $1 LIMIT 1", [name]);
  if (existing.rows.length) return existing.rows[0].id;
  const r = await client.query(
    `INSERT INTO incubators (name, type, description) VALUES ($1, $2, $3) RETURNING id`,
    [name, type, description]
  );
  return r.rows[0].id;
}

// Map existing IDs (seeded previously)
const { rows: existingIncs } = await client.query("SELECT id, name FROM incubators");
const incByName = Object.fromEntries(existingIncs.map((r) => [r.name, r.id]));

PROGRAM_TO_INCUBATOR["JU"] = incByName["JU Summary Sheet"] || (await upsertIncubator("JU Summary Sheet", "incubator", "Jadavpur University startup incubator program"));
PROGRAM_TO_INCUBATOR["JU@KAN"] = PROGRAM_TO_INCUBATOR["JU"];
PROGRAM_TO_INCUBATOR["JU @KAN 2"] = PROGRAM_TO_INCUBATOR["JU"];

const isbId = incByName["ISB Summary Sheet"] || (await upsertIncubator("ISB Summary Sheet", "incubator", "Indian School of Business startup incubator cohort"));
for (const prog of ["ISB Mohali","ISB IVenture","ISB&Agritech","iHeal@ISB","Buildforbillion@ISB ","ISB VoltUP","GameX@ISB","ISB Social Accelerator","ISB SaaS","ISB IRA","I-Accelerate@ISB","Circular@ISB","I-Heal3.0@ISB","Agri@ISB","Industry4.0@ISB","IVI@ISB","ISB I- Propel July '25","ISB@CultureCatalystAug'25","GameX 2.0 @ISB","ISB NIdhi 2.0","ISB iWIN 4.0","ISB IVI Oct- Nov'25","ISB D2C Oct- Nov'25","ISB I- Heal 2025","ISB IVI 4.0","Wadhwani x ISB Propel 2.0"]) {
  PROGRAM_TO_INCUBATOR[prog] = isbId;
}

const demoId = incByName["Demo"] || (await upsertIncubator("Demo", "demo", "Demo ventures"));
PROGRAM_TO_INCUBATOR["Direct Chanel"] = demoId;
PROGRAM_TO_INCUBATOR["Bolstart"] = demoId;
PROGRAM_TO_INCUBATOR["RBIH"] = demoId;
PROGRAM_TO_INCUBATOR["RX100"] = demoId;
PROGRAM_TO_INCUBATOR["SPJain"] = demoId;
PROGRAM_TO_INCUBATOR["IIT Dharwad"] = demoId;
PROGRAM_TO_INCUBATOR["TISS"] = demoId;

const ashokaId = await upsertIncubator("Ashoka University", "incubator", "Ashoka University startup programs");
for (const prog of ["Ashoka 1","Ashoka 2","AshokaWinter23","Ashoka SIP24","Ashoka Dec'25","Ashoka June'25","Tech Accelerator Program @Ashoka"]) {
  PROGRAM_TO_INCUBATOR[prog] = ashokaId;
}

const wadhwaniId = await upsertIncubator("Wadhwani Foundation", "accelerator", "Wadhwani Foundation entrepreneurship programs");
for (const prog of ["Wadhwani Dec23","Wadhwani LO prop 2","Wadhwani LO prop 3","Post Program Wadhwani Dec23","Wadhwani 4.1","Wadhwani 4.2","IWIN@AIC 3.1","Wadhwani 5.1","Post Program Wadhwani 4.1","Post Program Wadhwani LO prop 3","Wadhwani 5.2","Post Program Wadhwani LO prop 2","Post Program Wadhwani 4.2","Wadhwani 6.1","Wadhwani 7.1","Wadhwani 7.2","Wadhwani 8.1","Post Program Wadhwani 5.2","Post Program Wadhwani 5.1","Post Program Wadhwani 6.1","Post Program Wadhwani 7.1","Post Program Wadhwani x ISB Propel 2.0","Wadhwani 8.2","Wadhwani 8.3","Wadhwani 9.1","Wadhwani 9.2","Wadhwani 10.1","Post Program Wadhwani 7.2","Post Program Wadhwani 8.1","Post Program Wadhwani 8.2","Wadhwani 10.2","Wadhwani 11.1","Wadhwani 11.2","Wadhwani 12.1","Post Program Wadhwani 8.3","Post Program Wadhwani 9.1","Post Program Wadhwani 9.2","Wadhwani 12.2","Post Program Wadhwani 10.1","Wadhwani LO'25 2.1","Wadhwani LO'4.1@Apr","Wadhwani May '25","Wadhwani Accelarate","Post Program Wadhwani Accelerate","Wadhwani Liftoff"]) {
  PROGRAM_TO_INCUBATOR[prog] = wadhwaniId;
}

const jssId = await upsertIncubator("JSS", "incubator", "JSS startup program");
PROGRAM_TO_INCUBATOR["JSS"] = jssId;

const aicId = await upsertIncubator("AIC Raise", "accelerator", "AIC Raise acceleration program");
PROGRAM_TO_INCUBATOR["AIC Raise"] = aicId;
PROGRAM_TO_INCUBATOR["IWIN@AIC 3.1"] = aicId;

const deshpandeId = await upsertIncubator("Deshpande Startups", "incubator", "Deshpande Startups acceleration program");
PROGRAM_TO_INCUBATOR["Deshpande Startups"] = deshpandeId;

const bitsomId = await upsertIncubator("BitSoM", "incubator", "BitSoM startup program");
PROGRAM_TO_INCUBATOR["BitSoM"] = bitsomId;

console.log("✓ Incubators ready");

// ── 2. Import JU ventures ────────────────────────────────────────────────

const juWb = XLSX.readFile("attached_assets/JU_Summary_Sheet_1778742372687.xlsx");
const juData = XLSX.utils.sheet_to_json(juWb.Sheets["For JU"], { header: 1, defval: "" });
const juRows = juData.filter((r, i) => i >= 2 && typeof r[0] === "number" && r[1]);
let juImported = 0;

for (const r of juRows) {
  const companyName = String(r[1]).trim();
  const consultant = normConsultant(r[2]);
  const stage = truncate(r[3], 100);
  const description = truncate(r[14] || r[8], 600);
  const fathomUrl = r[23] && String(r[23]).startsWith("http") ? String(r[23]).trim() : null;
  const goals = truncate(r[4], 500);
  const strengths = truncate(r[8], 500);
  const gaps = truncate(r[9], 500);
  const intervention = truncate(r[21], 300);
  const email = fakeEmail(companyName);

  // Upsert founder
  const existing = await client.query("SELECT id FROM founders WHERE company_name = $1 AND incubator_id = $2", [companyName, PROGRAM_TO_INCUBATOR["JU"]]);
  let founderId;
  if (existing.rows.length) {
    founderId = existing.rows[0].id;
    await client.query(`UPDATE founders SET stage=$1, description=$2, incubator_id=$3 WHERE id=$4`, [stage, description, PROGRAM_TO_INCUBATOR["JU"], founderId]);
  } else {
    const ins = await client.query(
      `INSERT INTO founders (name, email, company_name, stage, description, incubator_id, accelerator_program) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
      ["Team " + companyName, email, companyName, stage, description, PROGRAM_TO_INCUBATOR["JU"], "JU"]
    );
    founderId = ins.rows[0].id;
    juImported++;
  }

  // Create a sprint record with the analysis data if we have it
  if (strengths || gaps || goals || intervention) {
    const sprintExists = await client.query("SELECT id FROM sprints WHERE founder_id=$1 AND fathom_url=$2", [founderId, fathomUrl || "NO_FATHOM_JU"]);
    if (!sprintExists.rows.length) {
      await client.query(
        `INSERT INTO sprints (founder_id, scheduled_date, consultant_name, status, strengths, gaps, next_goal, actionable_steps, fathom_url, sprint_number, session_type)
         VALUES ($1,$2,$3,'completed',$4,$5,$6,$7,$8,1,$9)`,
        [founderId, "2025-01-01", consultant, strengths, gaps, goals, intervention, fathomUrl, "T-Sprint"]
      );
    }
  }
}
console.log(`✓ JU: imported ${juImported} new ventures`);

// ── 3. Import ISB ventures ───────────────────────────────────────────────

const isbWb = XLSX.readFile("attached_assets/ISB_Summary_Sheet_1778742372695.xlsx");
const isbData = XLSX.utils.sheet_to_json(isbWb.Sheets["For ISB"], { header: 1, defval: "" });
const isbRows = isbData.filter((r, i) => i >= 3 && typeof r[0] === "number" && r[1]);
let isbImported = 0;

for (const r of isbRows) {
  const companyName = String(r[1]).trim();
  const consultant = normConsultant(r[2]);
  const stage = truncate(r[3], 100);
  const description = truncate(r[14] || r[8], 600);
  const fathomUrl = r[23] && String(r[23]).startsWith("http") ? String(r[23]).trim() : null;
  const goals = truncate(r[4], 500);
  const strengths = truncate(r[8], 500);
  const gaps = truncate(r[9], 500);
  const intervention = truncate(r[21], 300);
  const email = fakeEmail(companyName);

  const existing = await client.query("SELECT id FROM founders WHERE company_name = $1 AND incubator_id = $2", [companyName, isbId]);
  let founderId;
  if (existing.rows.length) {
    founderId = existing.rows[0].id;
    await client.query(`UPDATE founders SET stage=$1, description=$2 WHERE id=$3`, [stage, description, founderId]);
  } else {
    const ins = await client.query(
      `INSERT INTO founders (name, email, company_name, stage, description, incubator_id, accelerator_program) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
      ["Team " + companyName, email, companyName, stage, description, isbId, "ISB"]
    );
    founderId = ins.rows[0].id;
    isbImported++;
  }

  if (strengths || gaps || goals || intervention) {
    const sprintExists = await client.query("SELECT id FROM sprints WHERE founder_id=$1 AND fathom_url=$2", [founderId, fathomUrl || "NO_FATHOM_ISB"]);
    if (!sprintExists.rows.length) {
      await client.query(
        `INSERT INTO sprints (founder_id, scheduled_date, consultant_name, status, strengths, gaps, next_goal, actionable_steps, fathom_url, sprint_number, session_type)
         VALUES ($1,$2,$3,'completed',$4,$5,$6,$7,$8,1,$9)`,
        [founderId, "2025-01-01", consultant, strengths, gaps, goals, intervention, fathomUrl, "T-Sprint"]
      );
    }
  }
}
console.log(`✓ ISB: imported ${isbImported} new ventures`);

// ── 4. Import Sheet Tracking sprints ────────────────────────────────────

const stWb = XLSX.readFile("attached_assets/Sheet_Tracking_1778742372696.xlsx");
const stData = XLSX.utils.sheet_to_json(stWb.Sheets["Sheet Tracking"], { header: 1, defval: "" });
const stRows = stData.slice(1).filter((r) => r[0] && r[13] && typeof r[13] === "number");

// Cache for founder lookups
const founderCache = {};
let stImported = 0;

async function getOrCreateFounder(companyName, founderName, email, industry, stage, incubatorId, program) {
  const key = `${companyName}__${incubatorId}`;
  if (founderCache[key]) return founderCache[key];

  const existing = await client.query(
    "SELECT id FROM founders WHERE company_name = $1 AND (incubator_id = $2 OR ($2 IS NULL AND incubator_id IS NULL)) LIMIT 1",
    [companyName, incubatorId]
  );
  if (existing.rows.length) {
    founderCache[key] = existing.rows[0].id;
    return existing.rows[0].id;
  }

  const safeEmail = email && email.includes("@") ? email : fakeEmail(companyName);
  const safeName = founderName && founderName.trim() ? founderName.trim() : "Team " + companyName;
  const ins = await client.query(
    `INSERT INTO founders (name, email, company_name, sector, stage, incubator_id, accelerator_program)
     VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
    [safeName, safeEmail, companyName, truncate(industry, 100), truncate(stage, 100), incubatorId, program || null]
  );
  founderCache[key] = ins.rows[0].id;
  return ins.rows[0].id;
}

for (const r of stRows) {
  const companyName = String(r[0]).trim();
  if (!companyName) continue;

  const founderName = String(r[24] || r[1] || "").trim();
  const email = String(r[25] || "").trim();
  const industry = String(r[2] || "").trim();
  const stage = String(r[3] || "").trim();
  const program = String(r[4] || "").trim();
  const sprintHost = normConsultant(r[6]);
  const sprintNumRaw = r[8];
  const sprintNum = typeof sprintNumRaw === "number" && Number.isFinite(sprintNumRaw) && sprintNumRaw >= 0 ? Math.round(sprintNumRaw) : null;
  const sessionType = String(r[10] || "").trim() || null;
  const scheduledDate = excelDateToStr(r[13]);
  const startTime = excelTimeToStr(r[14]);

  if (!scheduledDate) continue;

  const incubatorId = PROGRAM_TO_INCUBATOR[program] || demoId;
  const status = sessionType && sessionType.toLowerCase() !== "free" ? "completed" : "completed";

  const founderId = await getOrCreateFounder(companyName, founderName, email, industry, stage, incubatorId, program);

  // Check if sprint already exists for this founder on this date with this session number
  const sprintExists = await client.query(
    "SELECT id FROM sprints WHERE founder_id=$1 AND scheduled_date=$2 AND sprint_number=$3",
    [founderId, scheduledDate, sprintNum]
  );
  if (!sprintExists.rows.length) {
    await client.query(
      `INSERT INTO sprints (founder_id, scheduled_date, scheduled_time, consultant_name, status, sprint_number, session_type)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [founderId, scheduledDate, startTime, sprintHost, status, sprintNum, sessionType]
    );
    stImported++;
  }
}

console.log(`✓ Sheet Tracking: imported ${stImported} sprint sessions`);

// ── Done ─────────────────────────────────────────────────────────────────
await client.end();
console.log("🎉 Seed complete!");
