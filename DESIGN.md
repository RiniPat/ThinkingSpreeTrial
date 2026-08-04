# Thinking Spree — Consultant Suite · Design System

> **Purpose of this file.** This is the canonical design reference for the Thinking Spree
> Consultant Suite frontend. Hand this whole file to Claude as context when you want to
> **design a new tab / page** so the result is visually and structurally consistent with the
> rest of the app. A copy-paste prompt template lives at the bottom
> ([§12 "Prompt to design a new tab"](#12-prompt-to-design-a-new-tab)).

**Stack it targets:** React 19 · Vite · Wouter (routing) · TanStack Query (data) · Tailwind CSS v4 · shadcn/ui · lucide-react (icons) · date-fns.
Frontend lives in `artifacts/thinking-spree/src/`.

---

## 1. Brand & personality

Thinking Spree is a **boutique startup-consulting firm**. The suite is an *internal* tool for
consultants, so the design reads as a **premium editorial workspace**, not a flashy SaaS marketing site.

| Trait | How it shows up |
|---|---|
| **Editorial / considered** | Serif display headings (`Instrument Serif`), generous whitespace, restrained color. |
| **Consulting-professional** | Deep navy ink, brass-gold accent, ivory canvas. Feels like premium stationery. |
| **Calm & legible** | Muted grays for secondary text, thin borders, soft shadows — never loud. |
| **Data-honest** | `tabular-nums` on every metric; monospace for times/dates/IDs. |

**Voice in UI copy:** concise, warm, first-person-to-the-consultant ("Here's what's on your plate today").
Section eyebrows use ALL-CAPS with wide letter-spacing. Avoid exclamation marks and hype.

---

## 2. Color tokens

Colors are CSS variables in **HSL channel form** (`H S% L%`) declared in `src/index.css`, exposed to
Tailwind via `@theme inline` as `--color-*`. **Always use the semantic token, never a raw hex.**
In Tailwind that means classes like `bg-card`, `text-muted-foreground`, `border-border`, `text-primary`.

### Light mode (default) — "Ivory canvas · deep navy ink · brass gold"

| Token | HSL | Role |
|---|---|---|
| `--background` | `42 30% 98%` | Warm ivory app canvas |
| `--foreground` | `222 35% 16%` | Near-black navy ink (body text) |
| `--card` | `0 0% 100%` | White surface for cards/panels |
| `--card-foreground` | `222 35% 16%` | Text on cards |
| `--card-border` / `--border` | `220 16% 86–87%` | Hairline borders |
| `--primary` | `222 52% 24%` | Deep navy — primary actions, active nav, links |
| `--primary-foreground` | `40 28% 97%` | Text on navy |
| `--secondary` | `220 18% 94%` | Subtle gray fill |
| `--muted` | `220 18% 95%` | Muted backgrounds (table header rows, zebra) |
| `--muted-foreground` | `222 12% 42%` | Secondary/caption text |
| `--accent` | `220 18% 92%` | Hover fills |
| `--destructive` | `0 65% 50%` | Delete / danger |
| `--input` | `220 14% 88%` | Input borders |
| `--ring` | `222 55% 22%` | Focus ring (navy) |
| **`--sidebar`** | `221 39% 13%` | Deep navy sidebar (always dark, both themes) |
| `--sidebar-foreground` | `220 18% 92%` | Sidebar text |
| **Extras (raw hsl(), not tokens):** | | |
| `--gold` | `hsl(36 65% 56%)` | **Brass-gold accent** — badges, active dots, the "middle" pipeline bar, avatar chips |
| `--success` | `hsl(150 50% 35%)` | Success dot / positive |
| `--warning` | `hsl(38 80% 55%)` | Warning |

### Dark mode (`.dark` class on root)

Canvas flips to deep navy (`222 30% 8%`), cards to `222 28% 11%`. **Note the accent inversion:**
in dark mode `--primary` becomes the **gold** (`36 65% 58%`) rather than navy. Sidebar stays dark.
Always verify both themes; use semantic tokens and dark mode "just works."

### Status / semantic colors (hardcoded Tailwind, used for chips)

Sprint status chips use fixed palettes (see `StatusChip` in `dashboard.tsx`):

- **Completed** → emerald: `bg-emerald-50 text-emerald-700 border-emerald-200` (+ `dark:` variants)
- **Scheduled** → blue: `bg-blue-50 text-primary border-blue-200` (+ `dark:` variants)
- **Cancelled / neutral** → `bg-muted text-muted-foreground border-border`
- **"Manual" / meta tag** → violet: `bg-violet-100 text-violet-700`

---

## 3. Typography

Three families, loaded as CSS vars → Tailwind `font-sans` / `font-serif` / `font-mono`:

| Family | Var / class | Used for |
|---|---|---|
| **Instrument Serif** | `--app-font-serif` / `font-serif` | **All display: `h1`,`h2`,`h3`**, big metric numbers, brand wordmark. Applied automatically to `h1/h2/h3`. |
| **Inter** | `--app-font-sans` / `font-sans` | Body, labels, buttons. Enables `ss01`,`cv11` OpenType features. |
| **JetBrains Mono** | `--app-font-mono` / `font-mono` | Times, dates, IDs, counts, code — anything tabular/technical. |

**Type scale in practice:**

- Page title (`h1`): `font-serif text-4xl leading-tight text-foreground` (dashboard greeting adds an italic gold/navy first name: `<span className="italic text-primary">`).
- Section / card title (`h2`): `font-serif text-xl text-foreground`.
- Card sub-title (`h3`) / big stat: `font-serif text-3xl–4xl`, always with `tabular-nums` when numeric.
- **Eyebrow / overline:** `text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground` (e.g. "Sprint lifecycle · Step 2").
- Body: `text-sm text-foreground`; secondary: `text-sm text-muted-foreground`; captions: `text-xs`.
- Table headers: `text-[11px] font-semibold uppercase tracking-wider text-muted-foreground`.

---

## 4. Shape, elevation, motion

- **Radius:** base `--radius: .5rem`. Note `rounded-xl`/`rounded-2xl` are overridden to `.5rem` in CSS, so the app is consistently *softly* rounded, never pill-round (except true pills: `rounded-full` chips, dots, avatars, progress bars).
- **Borders:** always hairline — `border border-border` or `border-card-border`. Never heavy.
- **Shadows:** soft and low. Cards get `0 1px 2px / 0 12px 30px` navy-tinted shadows via the `.app-card` / `.bg-card.border` rules. Hover lifts add `-translate-y-0.5` + a slightly larger shadow.
- **Motion:** subtle, 140–180ms ease. Common: `transition-all hover:-translate-y-0.5 hover:shadow-md`, icon nudge `group-hover:translate-x-0.5`, spinners `animate-spin`. Progress ring animates with `cubic-bezier(0.22,1,0.36,1)` over 900ms.
- **Utility classes** (defined in `index.css @layer components`): `.app-surface` (page gradient bg), `.app-topbar`, `.app-sidebar` (navy gradient), `.app-card`, `.app-card-hover`, `.app-button-primary`, `.app-input`, `.app-auth-visual`.

---

## 5. Layout shell (every authenticated page)

Wrap page content in `<Layout>` (`src/components/Layout.tsx`). It provides:

- **Fixed left sidebar**, `w-[264px]`, navy gradient (`.app-sidebar`), hidden on mobile behind a hamburger drawer. Contains: brand lockup (white logo tile + serif wordmark + "CONSULTANT SUITE" overline), a "SPRINT LIFECYCLE" nav section, and a user chip (avatar/initials + role + sign-out) pinned to the bottom.
- **Sticky top bar** (`.app-topbar`, `backdrop-blur`): global search on the left, Help + Notifications icon-buttons on the right.
- **Main column** offset by `md:ml-[264px]`.

**Page content convention** (inside `<Layout>`): a padded container, usually
`className="p-6 lg:p-8"` or the dashboard's `px-6 py-8 lg:px-10 max-w-[1400px] mx-auto space-y-8`.

### Navigation model — IMPORTANT for new tabs

The sidebar is intentionally a **flat, ~5–8 item list keyed to the sprint lifecycle**, not a deep tree.
Current items (`navItems` in `Layout.tsx`): Dashboard · Pre-Sprint · Emails · Research · Competitive
Mapping · Post-Sprint · Sales · Admin. Some are permission-gated (`adminOnly`, `needsSales`, `needsInboxCrm`).

**Sub-sections live as in-page tabs, not new sidebar entries.** Post-Sprint, Sales and Admin each own
their children via tabs/cards on the page. So a "new tab" is usually one of:

1. **A new in-page tab** inside an existing section (most common — see §7).
2. **A new sidebar destination** — only if it's a genuinely top-level lifecycle stage. If so: add to
   `navItems` with a `lucide-react` icon, add the `<Route>` in `App.tsx` wrapped in `<AuthGuard>`, and
   respect the `match` array for keeping the item highlighted on child routes.

---

## 6. Page anatomy (the standard template)

Every content page follows this vertical rhythm:

```tsx
<Layout>
  <div className="p-6 lg:p-8">
    {/* 1 — Page header */}
    <div className="mb-6">
      <div className="mb-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
        Sprint lifecycle · Step N            {/* eyebrow / breadcrumb */}
      </div>
      <h1 className="font-serif text-4xl leading-tight text-foreground">Page Title</h1>
      <p className="mt-1 max-w-xl text-sm text-muted-foreground">One-line description.</p>
    </div>

    {/* 2 — optional stat strip (grid of StatCards) */}
    {/* 3 — main content: section cards, tables, tabs */}
  </div>
</Layout>
```

Header actions (buttons, "View all →" links) sit to the right of the title, typically via a
`flex flex-wrap items-end justify-between gap-4` wrapper.

---

## 7. Component patterns (copy these)

These are the recurring building blocks. Reuse them verbatim so a new tab is indistinguishable from the rest.

### 7.1 Section card

The workhorse container.

```tsx
<section className="rounded-xl border border-card-border bg-card">
  <header className="flex items-center justify-between border-b border-border px-6 py-4">
    <div>
      <h2 className="font-serif text-xl text-foreground">Section Title</h2>
      <p className="text-xs text-muted-foreground">Supporting caption</p>
    </div>
    {/* right-side action: icon button or text link */}
    <Link href="/somewhere" className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline">
      View all <ChevronRight className="h-3 w-3" />
    </Link>
  </header>
  <div className="p-6">{/* body */}</div>
</section>
```

### 7.2 Stat card (metric tile)

Serif number, tone accent strip, hover lift, corner glow. (Full impl: `StatCard` in `dashboard.tsx`.)

```tsx
<div className="group relative overflow-hidden rounded-xl border border-card-border bg-card p-5 transition-all hover:shadow-md hover:-translate-y-0.5">
  <div className="absolute inset-x-0 top-0 h-0.5 bg-gradient-to-r from-primary/60 to-primary/0" />
  <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Label</div>
  <div className="mt-3 flex items-baseline gap-2">
    <div className="font-serif text-4xl text-foreground tabular-nums">42</div>
    <div className="text-xs font-medium text-emerald-700 dark:text-emerald-400">+12%</div>
  </div>
  <div className="mt-1 text-xs text-muted-foreground">trend caption</div>
</div>
```

Lay them out in `grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4`.

### 7.3 Navigation / feature card (card-grid landing, like Post-Sprint)

```tsx
<Link href={href}>
  <a className="group flex flex-col rounded-xl border border-border bg-card p-5 transition-all hover:border-foreground/20 hover:shadow-sm">
    <div className="flex items-center justify-between">
      <div className="flex h-11 w-11 items-center justify-center rounded-xl" style={{ background: "hsl(36 65% 94%)" }}>
        <Icon size={20} style={{ color: "hsl(30 55% 40%)" }} />   {/* gold-tinted icon tile */}
      </div>
      <ArrowRight size={16} className="text-muted-foreground transition-transform group-hover:translate-x-0.5" />
    </div>
    <div className="mt-3 font-serif text-xl text-foreground">{label}</div>
    <p className="mt-1 text-sm text-muted-foreground">{desc}</p>
  </a>
</Link>
```

### 7.4 In-page tabs (underline style) — the primary sub-navigation pattern

This is how the app does "tabs." Underline the active tab with `--primary`; the strip sits on a bottom border.

```tsx
const [tab, setTab] = useState<"overview" | "fundraising" | "sprints">("overview");

<div className="flex gap-1 border-b border-border -mb-px">
  {([["overview","Overview"],["fundraising","Fundraising"],["sprints","Sprint History"]] as const)
    .map(([k, label]) => (
      <button key={k} onClick={() => setTab(k)}
        className={`px-3 py-2 text-xs font-medium border-b-2 transition-colors ${
          tab === k ? "border-primary text-primary"
                    : "border-transparent text-muted-foreground hover:text-foreground"
        }`}>
        {label}
      </button>
    ))}
</div>

<div className="p-6">{tab === "overview" && <Overview/>}{/* … */}</div>
```

> For larger tabbed surfaces there's also the shadcn `Tabs` primitive in `components/ui/tabs.tsx`,
> but the hand-rolled underline pattern above is what most pages use — prefer it for visual consistency.

### 7.5 Data table

```tsx
<div className="overflow-x-auto">
  <table className="w-full text-sm">
    <thead>
      <tr className="border-b border-border bg-muted/40 text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
        <th className="px-6 py-3">Column</th>
        <th className="px-4 py-3">Date</th>
      </tr>
    </thead>
    <tbody>
      <tr className="border-b border-border last:border-0 transition-colors hover:bg-muted/30">
        <td className="px-6 py-4 font-medium text-foreground">Value</td>
        <td className="px-4 py-4 font-mono text-xs text-muted-foreground">4 Aug 2026</td>
      </tr>
    </tbody>
  </table>
</div>
```

Dates/times/IDs → `font-mono text-xs text-muted-foreground`. Header row → muted fill. Row hover → `hover:bg-muted/30`.

### 7.6 Status chip / pill

Bordered pill with a leading icon. Pattern from `StatusChip`:

```tsx
<span className="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium capitalize
                 bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-900/30 dark:text-emerald-400 dark:border-emerald-900/50">
  <CheckCircle2 className="h-3 w-3" /> completed
</span>
```

Small meta tags (non-status) use rectangular badges: `rounded bg-violet-100 text-violet-700 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide`.

### 7.7 Buttons

- **Primary:** navy gradient. Either the `.app-button-primary` utility or shadcn `<Button>` (default variant = `bg-primary`). Text `text-primary-foreground`.
- **Secondary / outline:** `inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-3 py-1.5 text-xs font-medium text-foreground hover:bg-muted`.
- **Ghost accent (e.g. "+ Mark"):** `rounded-md border border-primary/30 bg-primary/5 px-2.5 py-1 text-primary hover:bg-primary/10`.
- **Icon button (topbar):** `inline-flex h-9 w-9 items-center justify-center rounded-md border border-border bg-card text-muted-foreground hover:text-foreground`.

### 7.8 Empty state

Centered, muted, with a large faint icon:

```tsx
<div className="text-center py-12 px-6">
  <Calendar size={32} className="mx-auto text-muted-foreground/40 mb-2" />
  <p className="text-sm text-muted-foreground">No sessions this week</p>
  <p className="text-xs text-muted-foreground/60 mt-1">Hint about how to populate it</p>
</div>
```

### 7.9 Loading state

Use shadcn `<Skeleton>` blocks sized to the real content: `<Skeleton className="h-28 rounded-xl" />`,
usually `Array.from({ length: N }).map(...)`. Never a bare spinner for full-page loads.

### 7.10 Progress: bars & rings

- **Bars:** `h-1.5 overflow-hidden rounded-full bg-muted` track + a gradient/gold fill (`linear-gradient(90deg, hsl(var(--primary)), hsl(222 45% 35%))`; the middle/emphasis bar uses `var(--gold)`).
- **Ring:** animated SVG donut with a `hsl(var(--primary))` gradient stroke and a serif % in the center (see `CompletionRing` in `dashboard.tsx`).

---

## 8. Icons

`lucide-react`, sized **14–20px** (`size={15}` in nav, `size={16}` topbar, `size={20}` feature tiles).
Stroke inherits `currentColor`. Pick one clear metaphor per destination — e.g. `LayoutDashboard`,
`Rocket` (Pre-Sprint), `Mail`, `Compass` (Research), `Radar` (Competitive), `Flag` (Post-Sprint),
`Users` (Sales), `Shield` (Admin). For a new tab, choose an unused, semantically-obvious icon.

---

## 9. Data & state conventions (so a new tab wires up like the others)

- **Fetching:** TanStack Query. Either generated hooks from `@workspace/api-client-react` (Orval, from the OpenAPI spec) or raw `useQuery` + `customFetch(`${BASE}/api/...`, { credentials: "include" })`. **Always** `credentials: "include"` (session cookies). `BASE = import.meta.env.BASE_URL.replace(/\/$/, "")`.
- **Mutations:** `useMutation` + `queryClient.invalidateQueries({ queryKey: [...] })` on success.
- **Query keys:** path-style arrays, e.g. `["/api/stats/dashboard"]`, `["/api/calendar/events", { days: 7 }]`.
- **Staleness:** set `staleTime` (30–60s typical); global config disables `refetchOnWindowFocus` and `retry` — don't re-enable them casually.
- **Auth:** pages are wrapped in `<AuthGuard>` at the route level in `App.tsx`. Permission flags come from `/api/me/permissions`.
- **Routing:** Wouter. `<Link href="/x">`, `useLocation()`. New routes go in `App.tsx`'s `<Switch>`.
- **Dates:** `date-fns` (`format`, `parseISO`, `isToday`). Display dates/times in `font-mono`.
- **Class merging:** `cn()` from `@/lib/utils` (clsx + tailwind-merge).
- **Test hooks:** add `data-testid="card-…"` on interactive/list items, matching the existing kebab-case convention.

---

## 10. Accessibility & responsiveness

- Everything is **theme-aware** — use tokens, add `dark:` variants only for the hardcoded status palettes.
- Focus is visible globally (`:focus-visible` → navy ring). Don't remove outlines.
- Icon-only controls need `aria-label` + `title` (see topbar buttons, sidebar sign-out).
- Mobile-first grids: `grid-cols-1 sm:grid-cols-2 xl:grid-cols-4`; sidebar collapses to a drawer under `md`. Wide tables live inside `overflow-x-auto`.
- Minimum body width 320px.

---

## 11. Do / Don't

**Do**
- Lead pages with a serif `h1` + uppercase eyebrow.
- Use `tabular-nums` on every number; `font-mono` for dates/times/IDs.
- Reach for the section-card + underline-tab patterns before inventing layout.
- Keep the sidebar flat; add sub-sections as in-page tabs.
- Keep accents rare — navy does the work, gold is a *spark*, not a fill.

**Don't**
- Introduce new hex colors or fonts. Use tokens + the three families.
- Use heavy borders, hard shadows, or fully-rounded cards.
- Add a new sidebar item for something that's really a sub-view.
- Forget `credentials: "include"` or the dark-mode check.
- Make numbers non-tabular or dates in a proportional font.

---

## 12. Prompt to design a new tab

Paste the block below into Claude (along with this whole `DESIGN.md`) and fill in the brackets:

```
You are extending the Thinking Spree Consultant Suite. Read the attached DESIGN.md — it is the
authoritative design system. Build a new [tab / page] called "[NAME]".

Purpose: [what the consultant does here].
It belongs under: [existing sidebar section as an in-page tab  |  a new top-level sidebar destination].
Data it shows: [list metrics / lists / entities and the API endpoints if known].
Key actions: [buttons / mutations the user can take].

Requirements:
- Follow DESIGN.md exactly: <Layout> shell, the standard page header (uppercase eyebrow +
  serif text-4xl h1 + muted description), section-card and underline-tab patterns, StatCard for
  metrics, the standard table/chip/empty/skeleton patterns, semantic color tokens only, and the
  three type families (serif display, Inter body, mono for numbers/dates).
- Wire data with TanStack Query + customFetch(..., { credentials: "include" }); mutations invalidate
  their query keys. Route it in App.tsx behind <AuthGuard>. If it's a sidebar item, add it to
  navItems in Layout.tsx with a lucide icon and a <Route>.
- Verify light AND dark mode. Add data-testid on list/interactive items.

Deliver the new page component under src/pages/ plus any wiring diffs (App.tsx / Layout.tsx).
Match the existing code's import style and file conventions.
```

---

*Reference implementations to mirror:* `src/pages/dashboard.tsx` (stat cards, tables, rings, schedule),
`src/pages/post-sprint.tsx` (feature-card grid + header), `src/pages/summary.tsx` (underline tabs),
`src/components/Layout.tsx` (shell & nav). Tokens & utilities: `src/index.css`.
