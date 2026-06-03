# Thinking Spree — Consultant Dashboard

A full-stack internal platform for Thinking Spree startup consulting firm. Consultants can manage founders/startups, run T-Sprint sessions, generate pre/post sprint emails with human-review before sending, and view a summary sheet of all sessions.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 8080)
- `pnpm --filter @workspace/thinking-spree run dev` — run the frontend (port auto-assigned)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required env: `DATABASE_URL` — Postgres connection string, `SESSION_SECRET` — express-session secret

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5 + express-session (session-based auth)
- DB: PostgreSQL + Drizzle ORM
- Frontend: React + Vite + Wouter + TanStack Query
- Auth: Email/password with bcryptjs; restricted to @thinkingspree.com domain
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (CJS bundle)

## Where things live

- `lib/db/src/schema/` — DB schema (users, incubators, founders, sprints, emailLogs)
- `lib/api-spec/openapi.yaml` — source of truth for API contract
- `lib/api-client-react/src/generated/` — auto-generated hooks + Zod schemas
- `artifacts/api-server/src/routes/` — Express route handlers (incubators, founders, sprints, etc.)
- `artifacts/thinking-spree/src/pages/` — React page components
- `artifacts/thinking-spree/src/components/` — Layout, shared UI

## Routes

- `/dashboard` — Dashboard
- `/ventures` — Ventures (replaces /founders)
- `/sprints` + `/sprints/:id` — T-Sprints
- `/summary` — Incubator dashboard (redesigned)
- `/sprint-tracking` — Sprint Tracking kanban view
- `/settings` — Settings

## Architecture decisions

- Contract-first: OpenAPI spec drives code generation for both client hooks and Zod validation schemas
- Session-based auth (not JWT) — simpler for internal tool; cookies handled automatically by browser
- Email sending is logged to DB (`emailLogs` table); Gmail connector is available but not yet wired for real delivery
- Calendar "today's events" are derived from sprint records (no Google Calendar integration yet)
- All pages are auth-guarded client-side; server enforces auth on every API route via `requireAuth` middleware

## Product

- Work-email-gated login (restricted to @thinkingspree.com)
- Personal dashboard: today's sprint schedule + stats overview + recent activity
- Ventures (renamed from Founders): add, search, filter by incubator, delete ventures with sector/stage/description/incubator metadata
- T-Sprint session management: create, filter, update status, delete sprints
- Sprint detail: inline analysis editing (strengths, gaps, SWOT, goals, actions, recommendations)
- Automated email generation: pre-sprint invitation + post-sprint summary, with review modal before sending
- Summary Sheet (redesigned): incubator/program dashboard cards → click to open incubator detail with venture cards → click venture card for timeline sprint detail modal
- Sprint Tracking: stats strip, kanban-style sprint cards grouped by status/date/incubator, filter by status/incubator/consultant
- Incubator management: ISB Summary Sheet, JU Summary Sheet, Demo seeded; can add/delete incubators; ventures assignable to programs

## User preferences

- Consultant names: Pritesh Yeole (Senior Consultant), Rishu Pathak (Business Research Analyst)
- Default demo credentials: pritesh@thinkingspree.com / password (or thinking2024 after hash update)
- Company branding: logo at `attached_assets/thinkingspree_logo_1778683092464.jpg`

## Gotchas

- After changing API routes, always restart the API server workflow (it runs build + start)
- After changing `lib/api-spec/openapi.yaml`, run codegen before using new hooks in the frontend
- `customFetch` must be explicitly exported from `lib/api-client-react/src/index.ts`
- Session cookies require `credentials: "include"` on all fetch calls
- Do NOT add Vite proxy configs — the shared reverse proxy handles `/api` → api-server routing

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
