# v5.0 — Research & Sales Workspace

A new module for your research and sales teams, sharing the same auth +
infrastructure as the consultant suite. Role-aware sidebar shows each
team only the tabs they need.

## What's new

### Roles
- Four roles: **consultant** (default, sees everything), **sales**, **research**, **admin**.
- Existing users migrated from `user` → `consultant` automatically.
- Admin sets roles from `/admin/roles` (sidebar → Admin → User Roles).
- Sidebar visibility is server-derived (`/api/me/permissions`) so changes
  take effect on next reload.

### Research workspace (`/research`)
Five AI generators in one page, each as a tab:

| Tool | What it produces |
|---|---|
| Customer Segmentation | 3-5 segments with demographics, pain points, willingness to pay, size |
| ICP Mapping | Ideal Customer Profile + secondary ICPs + buying triggers + channels |
| TAM / SAM / SOM | Market size estimates with reasoning + assumptions + sources |
| Industry Landscape | Overview, key players, trends, challenges, opportunities, regulatory |
| Business Model Canvas | All 9 BMC blocks filled (Customer Segments, Value Props, etc.) |

Each generator:
- Takes specific inputs (company name, industry, product description, etc.)
- Calls Gemini with a tool-specific prompt
- Returns structured JSON that renders as readable cards
- Saves to the Library for later viewing / re-generation
- Can be filtered by tool

Each output can be tied to an existing Company OR run standalone for prospects.

### Sales workspace
Three tools:

**Sales Leads** (`/sales/leads`) — CRM-lite tracker:
- Company + Contact + LinkedIn + Email + Stage + Source + Notes
- 6 stages: Cold → Contacted → Meeting Booked → Proposal Sent → Won / Lost
- Stage filter chips with counts
- Inline stage editing from the table

**LinkedIn Outreach** (`/sales/linkedin`) — AI message drafter:
- Inputs: prospect name, role, company, reason for reach out, mutual connection (optional)
- Tone selector: warm / formal / playful
- Outputs: connection request (≤300 chars), first message, email subject
- Copy-to-clipboard for each draft

**Proposal Builder** (`/sales/proposals`) — hybrid AI + manual:
- You give it section headings (defaults: Executive Summary, Approach, Investment, etc.)
- "Fill with AI" button per section — AI writes that section's body using the brief
- Edit any section by hand; re-fill any time
- "Copy as text" exports the whole proposal to clipboard
- Status: draft / final

## Database changes
Migration `006_research_sales.sql`:
- `users.role` updated (`user` → `consultant`)
- `research_outputs` table — generic AI output store for all 5 research tools
- `sales_leads` table — CRM-lite leads
- `proposals` table — hybrid proposal builder

## New API endpoints
- `GET /me/permissions` — role-aware capabilities for the UI
- `GET/POST /research/outputs`, `POST /research/generate`, etc.
- `GET/POST/PATCH/DELETE /sales/leads`
- `POST /sales/linkedin-outreach` (stateless)
- `GET/POST /sales/proposals`, `PATCH /sales/proposals/:id`, `POST .../fill-section`
- `GET /admin/users`, `PATCH /admin/users/:id/role`

## Cost impact
At your scale (7 consultants + a few sales/research):
- Database storage: negligible (~5k research outputs over 2 years)
- Gemini quota: ~50-100 additional API calls/day. Still well under paid-tier limits.
- Render: no infrastructure changes needed.

## Deploy
`git push` → Render auto-deploys. Migration 006 runs on boot. No new env vars.

## After deploying
1. Sign in as the admin (you)
2. Go to `/admin/roles` — promote each team member to their role
   (sales / research / consultant). You stay admin.
3. Each team member sees only their tabs on next reload.
4. Test the Research → Customer Segmentation flow end-to-end with a known
   company to validate Gemini integration.

## Backtests run
- 27 parser tests (carried over from v4.9, still passing)
- 9 hyperlink extraction tests (carried over, passing)
- 8 sheet URL extraction tests (carried over, passing)
- 12 workflow stage validator tests (carried over, passing)
- **18 new tests** for roles + research tools + sales lead stages — all passing

All 74 tests green before shipping.
