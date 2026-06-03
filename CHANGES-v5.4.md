# v5.4 Phase A — Growth Report Builder

A new **Builder** page in the sidebar (under Workspace, requires research
access). Two modes via segmented toggle: **Growth Report** (built in this
release) and **Summary** (Phase B, placeholder for now).

## Growth Report Builder

Three-step workflow per spec:

### Step 1 — Upload
Form with required fields (Startup Name, T-Sheet link, Strategic Canvas PDF)
and optional fields:
- Cohort (used to group reports in the library)
- Number of Sprints (1 or 2) — controls how many Fathom slots appear
- Fathom Transcript 1 (.vtt / .srt / .txt / .docx)
- Fathom Transcript 2 (only shown if numSprints = 2)
- Check-In Call transcript

**File policy:** raw uploads are extracted to text on the server, then
discarded. Only the extracted text + final report are stored. Keeps
storage predictable.

PDF text extraction uses pdf-parse v2; .docx via mammoth; .vtt/.srt/.txt
via a simple cleaner that strips timestamps and cue numbers.

### Step 2 — Extract Anchors
Click "Extract Anchors with AI" → Gemini 2.5 Flash runs **Prompt 1**
(temperature 0.2 for faithful extraction). Returns the Venture Baseline
Anchors A through S: current state, growth state, six streams with RAG +
support need, primary sprint stream, and strategic summary inputs.

### Step 3 — Review & Edit → Generate
The anchor editor renders four logical sections:
- Current State (anchors A-E)
- Growth State (anchors F-H + Existing/New flags I)
- Streams (six streams with RAG selector + support textarea, plus
  primary sprint stream dropdown)
- Strategic Summary Inputs (Q risk, R bottleneck, S scalability)

Consultant edits anything, clicks **Generate Report**. Runs **Prompt 2**
(temperature 0.35) which uses the edited anchors as fixed input and
generates the full Journey Report (5 sections + 30-row annexure). Then
assembles the DOCX server-side.

Banned words enforced in the prompt: "it is important to", "moving
forward", "leverage", "synergies", "holistic".

### Step 4 — Download
DOCX download button appears in a green banner once status = report_ready.
Filename: `{StartupName}_Growth_Journey_Report.docx`.

DOCX format matches the Bull AgriTech reference exactly:
- US Letter, 1" margins, Arial
- 5 sections + Annexure
- Section 3 + Annexure tables have RAG-colored cells using exact hex:
  GREEN `#92d050`, AMBER `#ffc000`, RED `#ff0000`
- Sprint outcomes rendered as numbered lines inside each cell
- Disclaimer banner above the annexure verbatim

### Library
Reports are grouped by cohort. Each row shows startup name, sprint count,
last-updated date, and status badge (Drafting / Anchors Ready / Report
Ready / Failed). Click a row to resume — the workflow detects the current
status and shows the right step.

Resume-after-failure works: if Gemini errors, status flips to "Failed"
with the error message visible. Consultant can retry from the same row.

## Database
Migration `009_growth_reports.sql`:
- `growth_reports` table with all workflow state (status, extracted text,
  anchors JSONB, report JSONB, DOCX as base64 TEXT)
- Indexes on user_id, cohort, status

## API endpoints (all gated to research/consultant/admin roles)
- `POST   /api/builder/growth-reports` — multipart upload (Step 1)
- `POST   /api/builder/growth-reports/:id/extract-anchors` (Step 2)
- `PATCH  /api/builder/growth-reports/:id/anchors` (Step 3 save)
- `POST   /api/builder/growth-reports/:id/generate-report` (Step 4)
- `GET    /api/builder/growth-reports` — library list
- `GET    /api/builder/growth-reports/:id` — full record (no DOCX)
- `GET    /api/builder/growth-reports/:id/docx` — binary download
- `DELETE /api/builder/growth-reports/:id`
- `GET    /api/builder/empty-anchors` — empty anchor template

## What's deferred to Phase B (next session)
**Summary Builder mode** — pulls T-Sheet data, AI-extracts Fathom fields
(Current Revenue ARR, Industry Detail, Critical Venture, TS Connects, TS
Support apart from connects), dropdowns (Industry — 10 from your
screenshot + extendable, TG, Funding), and Sprint Tracking VP-call date
lookups. Writes to the existing Summary Sheet tab.

Currently the Summary tab in the Builder shows a placeholder explaining
what's coming.

## New dependencies
- `pdf-parse` (PDF text extraction)
- `mammoth` (.docx text extraction)
- `docx` (DOCX generation)

## Backtests
- 4 DOCX smoke tests (buffer returned, non-trivial size, ZIP magic header,
  file write integrity)
- 12 DOCX content tests via mammoth re-extraction (title, all 5 sections,
  annexure, disclaimer, numbered sprint outcomes, Risk/Bottleneck/
  Scalability headers, pitch text)
- All 158 prior tests still passing

**174 tests passing total before shipping.**

## Deploy
`git push` → Render auto-deploys. Migration 009 runs on boot.

## After deploying
1. Open the new **Builder** item in the sidebar (under Workspace)
2. Click "New Report"
3. Fill in Startup Name + T-Sheet link, upload a Strategic Canvas PDF
4. Upload → AI extracts anchors → edit → Generate → download .docx
5. The report stays in the library under its cohort heading
