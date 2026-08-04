import { useEffect, useMemo, useRef, useState, forwardRef, useImperativeHandle } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { customFetch, useGetMe } from "@workspace/api-client-react";
import { Layout } from "@/components/Layout";
import { useToast } from "@/hooks/use-toast";
import {
  Mail, RefreshCw, Loader2, Search, Plus, X, Send, Save, Check,
  Bold, Italic, Underline, Highlighter, List, ListOrdered,
  AlertTriangle, CheckCircle2, Clock, ThumbsUp, ThumbsDown, MinusCircle,
} from "lucide-react";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");
const api = (p: string) => `${BASE}/api${p}`;
const GOLD = "var(--gold)";

// ─── Types (mirror the server payload) ──────────────────────────────────────
type Followup = {
  key: string;
  startup: string;
  contact: string | null;
  email: string | null;
  program: string | null;
  stage: string | null;
  host: string | null;
  cohost: string | null;
  sessions: number | null;
  sprintCompleted: boolean | null;
  lastSprintDate: string | null;
  daysSinceSprint: number | null;
  status: string;
  replyState: string | null;
  sentAt: string | null;
  lastContactAt: string | null;
  draftSubject: string | null;
  draftBodyHtml: string | null;
  templateKey: string | null;
};
type Stats = {
  due: number; completedSprints: number; sentThisMonth: number;
  replyRate: number; awaitingReply: number; needsNudge: number;
};
type ListPayload = { items: Followup[]; stats: Stats; hasCompletedColumn: boolean; syncedAt?: string };
type DbTemplate = { id: number; name: string; subject: string | null; body: string; sortOrder: number };

// ─── Chip metadata ──────────────────────────────────────────────────────────
const STATUS_META: Record<string, { label: string; bg: string; fg: string }> = {
  not_due:            { label: "Not due yet",         bg: "#EEF1F5", fg: "#5A6472" },
  due:                { label: "Due",                 bg: "hsl(36 70% 92%)", fg: "#8A5A00" },
  draft:              { label: "Draft saved",         bg: "#EFEAFB", fg: "#5B3FA8" },
  sent:               { label: "Sent",                bg: "#E6F1FB", fg: "#0C447C" },
  no_reply:           { label: "No reply · nudge",    bg: "#FBEEE1", fg: "#A85A1F" },
  replied:            { label: "Replied · classify",  bg: "#E0F4F3", fg: "#0B6B6B" },
  replied_not_now:    { label: "Replied — not now",   bg: "#EEF1F5", fg: "#4A5566" },
  replied_interested: { label: "Replied — interested",bg: "#E1F5EE", fg: "#0F6E56" },
  bounced:            { label: "Bounced",             bg: "#FBE9EF", fg: "#A32B58" },
};
function statusMeta(s: string) { return STATUS_META[s] ?? STATUS_META.not_due; }

const STAGE_META: Record<string, { bg: string; fg: string }> = {
  growth:          { bg: "#E1F5EE", fg: "#0F6E56" },
  idea:            { bg: "#E6F1FB", fg: "#0C447C" },
  "early traction":{ bg: "hsl(36 70% 92%)", fg: "#8A5A00" },
  mvp:             { bg: "#FBE9EF", fg: "#A32B58" },
};
const PROGRAM_META: { test: RegExp; bg: string; fg: string }[] = [
  { test: /wadhwani/i,       bg: "#E1F5EE", fg: "#0F6E56" },
  { test: /ju.*kan|@kan/i,   bg: "#EFEAFB", fg: "#5B3FA8" },
  { test: /isb|cleantech/i,  bg: "#FBE9EF", fg: "#A32B58" },
];
function programMeta(p: string | null) {
  const hit = p ? PROGRAM_META.find((m) => m.test.test(p)) : null;
  return hit ?? { bg: "#F1EFE8", fg: "#5F5E5A" };
}

// ─── Templates (client-side; can migrate to email_templates table) ──────────
// Copy is verbatim from the Thinking Spree follow-up playbook. Tokens in
// [Square Brackets] are placeholders: a few we auto-fill from the sheet +
// signed-in user ([First Name], [Company], [Name]); the rest are judgement
// calls the consultant fills before sending. Unfilled tokens are highlighted
// in the editor and block an accidental send (see the send guard).
type Tmpl = { key: string; name: string; blurb: string; subject: string; body: string };
const SIGNOFF =
  "<p>Warm regards,<br>[Name]<br>[Title], Thinking Spree<br>[Phone] | [Calendar link]</p>";
const TEMPLATES: Tmpl[] = [
  {
    key: "checkin", name: "Catch-up", blurb: "Warm re-open + 20-min call ask.",
    subject: "Catching up on [Company]",
    body:
      "<p>Hi [First Name],</p>" +
      "<p>I hope you’ve been well. I was recently revisiting our work with [Company] and the priorities we had identified around [previous growth priority].</p>" +
      "<p>At the time, the next milestone was to [specific target or objective]. I’d love to hear what has changed since then—what has progressed, what remains difficult, and which growth question is most important for you now.</p>" +
      "<p>Based on our previous work together, I believe we may be able to help with [one or two relevant areas], without needing to restart the discovery process from scratch.</p>" +
      "<p>Would you be open to a 20-minute catch-up next week? We can review where things stand and determine whether a focused intervention would be useful. If there is a fit, we can then suggest a clearly scoped option with timelines, outcomes and pricing.</p>" +
      "<p>I’m available on [Option 1] or [Option 2], but happy to work around your schedule.</p>" +
      SIGNOFF,
  },
  {
    key: "next_sprint", name: "Two-sprint intervention", blurb: "Scoped next step with pricing.",
    subject: "A focused next step for [Company]",
    body:
      "<p>Hi [First Name],</p>" +
      "<p>It was great working with you on [previous engagement or programme]. During our earlier sessions, we identified [specific challenge] as an important lever for [Company]’s growth.</p>" +
      "<p>Given the progress you had already made in [relevant strength or achievement], I believe the next practical step could be a focused two-sprint intervention covering:</p>" +
      "<ul><li>[Deliverable or activity 1]</li><li>[Deliverable or activity 2]</li><li>[Deliverable or activity 3]</li></ul>" +
      "<p>The goal would be to help your team reach a clear decision or produce a usable outcome—such as [specific result]—within [time period].</p>" +
      "<p>We can offer this focused intervention at <strong>₹[amount] plus GST</strong>. This would be a contained engagement rather than a long-term commitment and would include [number] working sessions, supporting analysis and a clear action plan for your team.</p>" +
      "<p>At the end of the two sprints, we can jointly review the outcome and decide whether any further support would be valuable.</p>" +
      "<p>Would you be open to a short call to review the idea and update us on what has changed since our last conversation? I can do [Option 1] or [Option 2].</p>" +
      SIGNOFF,
  },
  {
    key: "proposal", name: "Phased engagement", blurb: "Full proposal, two scope options.",
    subject: "Next phase options for [Company]",
    body:
      "<p>Hi [First Name],</p>" +
      "<p>It was a pleasure supporting [Company] during [previous programme or engagement]. Our earlier work highlighted three important opportunities:</p>" +
      "<ol><li>[Priority or opportunity 1]</li><li>[Priority or opportunity 2]</li><li>[Priority or opportunity 3]</li></ol>" +
      "<p>Based on where the business was heading, we see a possible next phase focused on achieving [measurable commercial or strategic outcome].</p>" +
      "<p>A potential engagement could include:</p>" +
      "<p><strong>Phase 1: Reassessment and prioritisation</strong><br>Review progress since our last session, update the diagnosis and identify the highest-impact constraint.</p>" +
      "<p><strong>Phase 2: Strategy development</strong><br>Build the required [growth plan, positioning, channel strategy, sales process or customer-insight system].</p>" +
      "<p><strong>Phase 3: Activation and iteration</strong><br>Support your team in testing the approach, reviewing results and improving execution.</p>" +
      "<p>We can structure the engagement in one of two ways:</p>" +
      "<p><strong>Focused intervention</strong><br>[Two/four] T-Sprints over [time period] at <strong>₹[amount] plus GST</strong>. This would focus on [specific challenge] and deliver [specific output or decision].</p>" +
      "<p><strong>Implementation partnership</strong><br>[Six/twelve] T-Sprints over [time period] starting at <strong>₹[amount] plus GST</strong>. This would include strategy development, activation support, performance reviews and iteration with your team.</p>" +
      "<p>The final scope can be adjusted based on what has changed since our previous engagement and the level of hands-on support your team currently needs.</p>" +
      "<p>Could we schedule 20–30 minutes to understand where things stand and explore which option, if either, would be most relevant? I’m available on [Option 1] or [Option 2].</p>" +
      SIGNOFF,
  },
];

type Profile = { name: string | null; title: string | null; phone: string | null; calendarLink: string | null };

/** Auto-fill the tokens we actually know. Everything else stays a [placeholder]. */
function resolveMerge(text: string, f: Followup, p?: Profile): string {
  return text
    .replace(/\[First Name\]/g, f.contact || "there")
    .replace(/\[Company\]/g, f.startup || "your team")
    .replace(/\[Name\]/g, p?.name || f.host || "The Thinking Spree team")
    .replace(/\[Title\]/g, p?.title || "[Title]")
    .replace(/\[Phone\]/g, p?.phone || "[Phone]")
    .replace(/\[Calendar link\]/g, p?.calendarLink || "[Calendar link]");
}

const PLACEHOLDER_HL = "#FFE9A8"; // colour used to mark unfilled [tokens]

/** Wrap any still-unfilled [token] in a highlight so the consultant sees it. */
function highlightPlaceholders(html: string): string {
  return html.replace(/\[[^\]\n]+\]/g, (m) => `<mark style="background-color:${PLACEHOLDER_HL}">${m}</mark>`);
}

/** Before sending, drop OUR placeholder highlight (keep the consultant's own). */
function stripPlaceholderHighlight(html: string): string {
  return html.replace(
    new RegExp(`<mark style="background-color:${PLACEHOLDER_HL}">([^<]*)</mark>`, "gi"),
    "$1",
  );
}

/** Count remaining [placeholders] (ignoring our highlight wrapper). */
function countPlaceholders(html: string): number {
  return (html.replace(/<[^>]+>/g, "").match(/\[[^\]\n]+\]/g) ?? []).length;
}

// Client-side sanitize mirroring the server allowlist (defence in depth).
const ALLOWED = new Set(["b","strong","i","em","u","mark","span","p","br","div","ul","ol","li","a"]);
function sanitize(html: string): string {
  if (!html) return "";
  let out = html.replace(/<\s*(script|style)[^>]*>[\s\S]*?<\s*\/\s*\1\s*>/gi, "");
  out = out.replace(/<\/?([a-zA-Z0-9]+)([^>]*)>/g, (whole, tagRaw, attrs) => {
    const tag = String(tagRaw).toLowerCase();
    if (!ALLOWED.has(tag)) return "";
    if (/^<\s*\//.test(whole)) return `</${tag}>`;
    if (tag === "a") {
      const href = /href\s*=\s*["']([^"']+)["']/i.exec(attrs)?.[1] ?? "";
      return /^(https?:|mailto:)/i.test(href) ? `<a href="${href}" target="_blank" rel="noopener noreferrer">` : "<span>";
    }
    if (tag === "span" || tag === "mark") {
      const style = /style\s*=\s*["']([^"']*)["']/i.exec(attrs)?.[1] ?? "";
      const kept = style.split(";").map((s) => s.trim()).filter((s) => /^(color|background-color)\s*:/i.test(s)).join("; ");
      return kept ? `<${tag} style="${kept}">` : `<${tag}>`;
    }
    return `<${tag}>`;
  });
  return out.trim();
}

function fmtDate(iso: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

// ─── Stat card ──────────────────────────────────────────────────────────────
function StatCard({ label, value, hint, accent }: { label: string; value: string | number; hint?: string; accent?: boolean }) {
  return (
    <div className="rounded-lg border border-card-border bg-card px-4 py-3.5">
      <div className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="mt-1 font-serif text-3xl leading-none" style={{ color: accent ? GOLD : undefined }}>{value}</div>
      {hint && <div className="mt-1 text-[11px] text-muted-foreground">{hint}</div>}
    </div>
  );
}

const FILTERS = [
  { key: "all", label: "All" },
  { key: "due", label: "Due" },
  { key: "sent", label: "Sent" },
  { key: "interested", label: "Interested" },
  { key: "nudge", label: "Needs nudge" },
] as const;
type FilterKey = (typeof FILTERS)[number]["key"];

// ─── Page ───────────────────────────────────────────────────────────────────
export default function SalesInboxPage() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [filter, setFilter] = useState<FilterKey>("all");
  const [q, setQ] = useState("");
  const [openKey, setOpenKey] = useState<string | null>(null);
  const [syncedAt, setSyncedAt] = useState<string | null>(null);
  const [tab, setTab] = useState<"followups" | "templates" | "clients" | "pipeline">("followups");
  const [logOpen, setLogOpen] = useState(false);

  const { data, isLoading, isError, error } = useQuery<ListPayload>({
    queryKey: ["/api/sales/followups"],
    queryFn: () => customFetch(api("/sales/followups"), { credentials: "include" }),
    staleTime: 30_000,
  });

  const templatesQuery = useQuery<{ items: DbTemplate[] }>({
    queryKey: ["/api/sales/followup-templates"],
    queryFn: () => customFetch(api("/sales/followup-templates"), { credentials: "include" }),
    staleTime: 60_000,
  });
  const templates = templatesQuery.data?.items ?? [];

  const profileQuery = useQuery<Profile>({
    queryKey: ["/api/me/followup-profile"],
    queryFn: () => customFetch(api("/me/followup-profile"), { credentials: "include" }),
    staleTime: 60_000,
  });
  const profile = profileQuery.data;

  const refresh = useMutation({
    mutationFn: () => customFetch(api("/sales/followups/refresh"), { method: "POST", credentials: "include" }),
    onSuccess: (res: ListPayload) => {
      qc.setQueryData(["/api/sales/followups"], res);
      setSyncedAt(res.syncedAt ?? new Date().toISOString());
      toast({ title: "Synced with Live Sprint Tracking", description: `${res.items.length} client(s) updated.` });
    },
    onError: (e: any) => toast({ title: "Refresh failed", description: String(e?.message ?? e), variant: "destructive" }),
  });

  const scan = useMutation({
    mutationFn: () => customFetch(api("/sales/followups/scan-replies"), { method: "POST", credentials: "include" }),
    onSuccess: (r: any) => {
      qc.invalidateQueries({ queryKey: ["/api/sales/followups"] });
      toast({ title: "Reply scan complete", description: `${r.detected} new repl${r.detected === 1 ? "y" : "ies"} found.` });
    },
    onError: (e: any) => toast({ title: "Scan failed", description: String(e?.message ?? e), variant: "destructive" }),
  });

  const items = data?.items ?? [];
  const stats = data?.stats;

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    return items.filter((f) => {
      if (term && !(`${f.startup} ${f.contact ?? ""} ${f.email ?? ""}`.toLowerCase().includes(term))) return false;
      switch (filter) {
        case "due": return f.status === "due";
        case "sent": return f.status === "sent";
        case "interested": return f.status === "replied_interested";
        case "nudge": return f.status === "no_reply";
        default: return true;
      }
    }).sort((a, b) => {
      // Due first, then most-recently-active.
      const rank = (f: Followup) => (f.status === "due" ? 0 : f.status === "no_reply" ? 1 : 2);
      if (rank(a) !== rank(b)) return rank(a) - rank(b);
      return (b.daysSinceSprint ?? 0) - (a.daysSinceSprint ?? 0);
    });
  }, [items, q, filter]);

  const openRow = items.find((f) => f.key === openKey) ?? null;

  return (
    <Layout>
      <div className="mx-auto max-w-[1200px] px-6 py-8 lg:px-10">
        {/* Header */}
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
              Sales · Client follow-ups
            </div>
            <h1 className="mt-1 font-serif text-4xl leading-tight">Follow-ups</h1>
            <p className="mt-1 max-w-xl text-sm text-muted-foreground">
              Reconnect with past clients ~30 days after their sprint. Pick a template, personalise it, send, and track replies.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <div className="mr-1 text-right text-[11px] text-muted-foreground">
              <div className="font-medium text-foreground">Live Sprint Tracking</div>
              <div>{syncedAt ? `synced ${new Date(syncedAt).toLocaleTimeString()}` : "not synced yet"}</div>
            </div>
            <button
              onClick={() => refresh.mutate()}
              disabled={refresh.isPending}
              className="inline-flex items-center gap-2 rounded-md border border-border bg-card px-3 py-2 text-sm font-medium transition-colors hover:bg-accent disabled:opacity-60"
              data-testid="button-refresh-sheet"
            >
              {refresh.isPending ? <Loader2 size={15} className="animate-spin" /> : <RefreshCw size={15} />}
              Refresh
            </button>
            <button
              onClick={() => setLogOpen(true)}
              className="inline-flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium text-white"
              style={{ background: "hsl(222 47% 20%)" }}
              data-testid="button-log-client"
            >
              <Plus size={15} /> Log client
            </button>
          </div>
        </div>

        {/* Missing-column banner */}
        {data && data.hasCompletedColumn === false && (
          <div className="mt-5 flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            <AlertTriangle size={16} className="mt-0.5 shrink-0" />
            <span>
              No <strong>“Sprint Completed”</strong> column found in the tracking sheet, so nothing is marked <em>Due</em> yet.
              Add a Yes/No “Sprint Completed” column and hit Refresh.
            </span>
          </div>
        )}

        {/* Stat strip */}
        <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          <StatCard label="Due for follow-up" value={stats?.due ?? "—"} accent />
          <StatCard label="Completed sprints" value={stats?.completedSprints ?? "—"} hint="from sheet" />
          <StatCard label="Sent this month" value={stats?.sentThisMonth ?? "—"} />
          <StatCard label="Reply rate" value={stats ? `${stats.replyRate}%` : "—"} />
          <StatCard label="Awaiting reply" value={stats?.awaitingReply ?? "—"} />
          <StatCard label="Needs nudge" value={stats?.needsNudge ?? "—"} />
        </div>

        {/* Section card */}
        <div className="mt-6 rounded-xl border border-card-border bg-card">
          {/* Underline tabs */}
          <div className="flex items-center gap-6 border-b border-border px-5">
            {([
              { label: "Pipeline", key: "pipeline" as const },
              { label: "Follow-ups", key: "followups" as const },
              { label: "Clients", key: "clients" as const },
              { label: "Templates", key: "templates" as const },
            ]).map((t) => {
              const active = t.key === tab;
              return (
                <button
                  key={t.label}
                  className="relative -mb-px py-3 text-sm font-medium"
                  style={{ color: active ? "hsl(222 47% 20%)" : "var(--muted-foreground)" }}
                  onClick={() => setTab(t.key)}
                >
                  {t.label}
                  {active && <span className="absolute inset-x-0 -bottom-px h-0.5 rounded-full" style={{ background: GOLD }} />}
                </button>
              );
            })}
          </div>

          {tab === "templates" ? (
            <TemplatesPanel profile={profile} />
          ) : tab === "clients" ? (
            <ClientsPanel items={items} loading={isLoading} />
          ) : tab === "pipeline" ? (
            <PipelinePanel items={items} onOpen={(k) => setOpenKey(k)} />
          ) : (
          <>
          {/* — Follow-ups view — */}

          {/* Filter chips + search + scan */}
          <div className="flex flex-wrap items-center gap-2 border-b border-border px-5 py-3">
            {FILTERS.map((f) => {
              const active = filter === f.key;
              return (
                <button
                  key={f.key}
                  onClick={() => setFilter(f.key)}
                  className="rounded-full border px-3 py-1 text-xs font-medium transition-colors"
                  style={active
                    ? { background: "hsl(222 47% 20%)", color: "white", borderColor: "transparent" }
                    : { borderColor: "var(--border)", color: "var(--muted-foreground)" }}
                >
                  {f.label}
                </button>
              );
            })}
            <div className="relative ml-auto">
              <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Search client, contact, email…"
                className="w-56 rounded-md border border-border bg-background py-1.5 pl-8 pr-3 text-sm outline-none focus:ring-2 focus:ring-ring/40"
              />
            </div>
            <button
              onClick={() => scan.mutate()}
              disabled={scan.isPending}
              className="inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-xs font-medium hover:bg-accent disabled:opacity-60"
              title="Check your Gmail for new replies"
            >
              {scan.isPending ? <Loader2 size={13} className="animate-spin" /> : <Mail size={13} />}
              Scan replies
            </button>
          </div>

          {/* Table */}
          {isLoading ? (
            <div className="flex items-center justify-center gap-2 py-16 text-sm text-muted-foreground">
              <Loader2 size={16} className="animate-spin" /> Loading follow-ups…
            </div>
          ) : isError ? (
            <div className="px-5 py-12 text-center text-sm text-destructive">
              {String((error as any)?.message ?? "Failed to load.")}
            </div>
          ) : filtered.length === 0 ? (
            <div className="px-5 py-14 text-center text-sm text-muted-foreground">
              No clients match. Try “Refresh” to pull the latest from the sheet.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-[11px] uppercase tracking-wider text-muted-foreground">
                    <th className="px-5 py-2.5 font-medium">Client</th>
                    <th className="px-3 py-2.5 font-medium">Program</th>
                    <th className="px-3 py-2.5 font-medium">Stage</th>
                    <th className="px-3 py-2.5 font-medium">Sprint done</th>
                    <th className="px-3 py-2.5 font-medium">Sessions</th>
                    <th className="px-3 py-2.5 font-medium">Host</th>
                    <th className="px-3 py-2.5 font-medium">Days</th>
                    <th className="px-3 py-2.5 font-medium">Status</th>
                    <th className="px-5 py-2.5" />
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((f) => {
                    const sm = statusMeta(f.status);
                    const pm = programMeta(f.program);
                    const stg = STAGE_META[(f.stage ?? "").toLowerCase()];
                    return (
                      <tr key={f.key} className="border-b border-border/60 hover:bg-accent/40" data-testid={`row-followup-${f.key}`}>
                        <td className="px-5 py-3">
                          <div className="font-medium">{f.startup}</div>
                          <div className="text-xs text-muted-foreground">{f.contact ?? "—"}{f.email ? ` · ${f.email}` : ""}</div>
                        </td>
                        <td className="px-3 py-3">
                          {f.program
                            ? <span className="rounded px-2 py-0.5 text-[11px] font-medium" style={{ background: pm.bg, color: pm.fg }}>{f.program}</span>
                            : <span className="text-muted-foreground">—</span>}
                        </td>
                        <td className="px-3 py-3">
                          {f.stage
                            ? <span className="rounded px-2 py-0.5 text-[11px] font-medium" style={stg ? { background: stg.bg, color: stg.fg } : { background: "#F1EFE8", color: "#5F5E5A" }}>{f.stage}</span>
                            : <span className="text-muted-foreground">—</span>}
                        </td>
                        <td className="px-3 py-3">
                          {f.sprintCompleted === true
                            ? <span className="inline-flex items-center gap-1 text-[12px]" style={{ color: "var(--success)" }}><CheckCircle2 size={13} /> Yes</span>
                            : f.sprintCompleted === false
                              ? <span className="text-muted-foreground text-[12px]">No</span>
                              : <span className="text-muted-foreground">—</span>}
                        </td>
                        <td className="px-3 py-3 tabular-nums">{f.sessions ?? "—"}</td>
                        <td className="px-3 py-3">
                          <div>{f.host ?? "—"}</div>
                          {f.cohost && <div className="text-xs text-muted-foreground">+ {f.cohost}</div>}
                        </td>
                        <td className="px-3 py-3 tabular-nums">
                          {f.daysSinceSprint != null ? `${f.daysSinceSprint}d` : "—"}
                        </td>
                        <td className="px-3 py-3">
                          <span className="rounded-full px-2.5 py-1 text-[11px] font-medium" style={{ background: sm.bg, color: sm.fg }}>{sm.label}</span>
                        </td>
                        <td className="px-5 py-3 text-right">
                          <button
                            onClick={() => setOpenKey(f.key)}
                            className="inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-xs font-medium hover:bg-accent"
                            data-testid={`action-open-${f.key}`}
                          >
                            <Mail size={13} /> Follow up
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          </>
          )}
        </div>
      </div>

      {openRow && <ComposeDrawer row={openRow} templates={templates} profile={profile} onClose={() => setOpenKey(null)} />}
      {logOpen && <LogClientModal onClose={() => setLogOpen(false)} />}
    </Layout>
  );
}

// ─── Compose drawer ─────────────────────────────────────────────────────────
function ComposeDrawer({ row, templates, profile, onClose }: { row: Followup; templates: DbTemplate[]; profile?: Profile; onClose: () => void }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const { data: me } = useGetMe();
  const prof: Profile = profile ?? { name: (me as any)?.name ?? null, title: null, phone: null, calendarLink: null };
  const editorRef = useRef<HTMLDivElement>(null);
  const [tmplId, setTmplId] = useState<number | null>(null);
  const [subject, setSubject] = useState<string>(row.draftSubject ?? "");
  const [to, setTo] = useState<string>(row.email ?? "");
  const [confirmSend, setConfirmSend] = useState(false);

  // Fall back to the built-in copy if the DB library is momentarily empty.
  const picks: DbTemplate[] = templates.length
    ? templates
    : TEMPLATES.map((t, i) => ({ id: -(i + 1), name: t.name, subject: t.subject, body: t.body, sortOrder: i }));

  // Seed the editor once (uncontrolled contentEditable). A saved draft is shown
  // as-is; otherwise start with a highlighted placeholder hint.
  useEffect(() => {
    if (editorRef.current) {
      editorRef.current.innerHTML = row.draftBodyHtml ?? "<p>Pick a template above to get started.</p>";
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function applyTemplate(t: DbTemplate) {
    setTmplId(t.id);
    setConfirmSend(false);
    setSubject(resolveMerge(t.subject ?? "", row, prof));
    if (editorRef.current) {
      editorRef.current.innerHTML = highlightPlaceholders(resolveMerge(t.body, row, prof));
    }
  }

  function exec(cmd: string, value?: string) {
    editorRef.current?.focus();
    // execCommand is deprecated but remains the pragmatic cross-browser way to
    // drive a small formatting toolbar without pulling in a full editor lib.
    document.execCommand(cmd, false, value);
  }

  const readBody = () => sanitize(stripPlaceholderHighlight(editorRef.current?.innerHTML ?? ""));

  // Guard: never fire a client email with raw [placeholders] in it by accident.
  function attemptSend() {
    const left = countPlaceholders(editorRef.current?.innerHTML ?? "");
    if (left > 0 && !confirmSend) {
      setConfirmSend(true);
      toast({
        title: `${left} placeholder${left === 1 ? "" : "s"} still unfilled`,
        description: "Fill the highlighted brackets, or press Send again to send anyway.",
        variant: "destructive",
      });
      return;
    }
    send.mutate();
  }

  const saveDraft = useMutation({
    mutationFn: () => customFetch(api(`/sales/followups/${encodeURIComponent(row.key)}/draft`), {
      method: "POST", credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ subject, bodyHtml: readBody(), templateKey: tmplId != null ? String(tmplId) : null }),
    }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["/api/sales/followups"] }); toast({ title: "Draft saved" }); },
    onError: (e: any) => toast({ title: "Couldn't save draft", description: String(e?.message ?? e), variant: "destructive" }),
  });

  const send = useMutation({
    mutationFn: () => customFetch(api(`/sales/followups/${encodeURIComponent(row.key)}/send`), {
      method: "POST", credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ subject, bodyHtml: readBody(), to }),
    }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["/api/sales/followups"] }); toast({ title: "Follow-up sent", description: `Emailed ${to}.` }); onClose(); },
    onError: (e: any) => toast({ title: "Send failed", description: String(e?.message ?? e), variant: "destructive" }),
  });

  const mark = useMutation({
    mutationFn: (m: string) => customFetch(api(`/sales/followups/${encodeURIComponent(row.key)}/mark`), {
      method: "POST", credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mark: m }),
    }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["/api/sales/followups"] }); toast({ title: "Reply logged" }); },
    onError: (e: any) => toast({ title: "Couldn't update", description: String(e?.message ?? e), variant: "destructive" }),
  });

  const pm = programMeta(row.program);
  const stg = STAGE_META[(row.stage ?? "").toLowerCase()];

  const ToolBtn = ({ onClick, title, children }: { onClick: () => void; title: string; children: React.ReactNode }) => (
    <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={onClick} title={title}
      className="inline-flex h-8 w-8 items-center justify-center rounded hover:bg-accent">{children}</button>
  );

  return (
    <div className="fixed inset-0 z-50 flex justify-end" role="dialog" aria-modal="true">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative flex h-full w-full max-w-xl flex-col bg-background shadow-2xl">
        {/* Header */}
        <div className="flex items-start justify-between gap-3 border-b border-border px-6 py-4">
          <div>
            <div className="font-serif text-2xl leading-tight">{row.startup}</div>
            <div className="mt-0.5 text-sm text-muted-foreground">{row.contact ?? "—"} · {row.email ?? "no email on file"}</div>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              {row.program && <span className="rounded px-2 py-0.5 text-[11px] font-medium" style={{ background: pm.bg, color: pm.fg }}>{row.program}</span>}
              {row.stage && <span className="rounded px-2 py-0.5 text-[11px] font-medium" style={stg ? { background: stg.bg, color: stg.fg } : { background: "#F1EFE8", color: "#5F5E5A" }}>{row.stage}</span>}
              <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
                <Clock size={12} /> {row.daysSinceSprint != null ? `${row.daysSinceSprint}d since sprint` : "—"} · done {fmtDate(row.lastSprintDate)}
              </span>
            </div>
          </div>
          <button onClick={onClose} className="rounded-md p-1.5 text-muted-foreground hover:bg-accent"><X size={18} /></button>
        </div>

        {/* Scroll body */}
        <div className="flex-1 space-y-5 overflow-y-auto px-6 py-5">
          {/* Template picker */}
          <div>
            <div className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Template</div>
            <div className="grid gap-2 sm:grid-cols-3">
              {picks.map((t) => {
                const active = tmplId === t.id;
                return (
                  <button key={t.id} onClick={() => applyTemplate(t)}
                    className="rounded-lg border p-3 text-left transition-colors"
                    style={active ? { borderColor: GOLD, background: "hsl(36 70% 97%)" } : { borderColor: "var(--border)" }}>
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium">{t.name}</span>
                      {active && <Check size={14} style={{ color: GOLD }} />}
                    </div>
                    <div className="mt-1 truncate text-[11px] leading-snug text-muted-foreground">{t.subject || "—"}</div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* To + Subject */}
          <div className="grid gap-3">
            <label className="text-sm">
              <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">To</span>
              <input value={to} onChange={(e) => setTo(e.target.value)} placeholder="client@email.com"
                className="w-full rounded-md border border-border bg-card px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring/40" />
            </label>
            <label className="text-sm">
              <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Subject</span>
              <input value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="Subject line"
                className="w-full rounded-md border border-border bg-card px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring/40" />
            </label>
          </div>

          {/* Rich text editor */}
          <div>
            <div className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Message</div>
            <div className="rounded-md border border-border bg-card">
              <div className="flex items-center gap-0.5 border-b border-border px-1.5 py-1">
                <ToolBtn onClick={() => exec("bold")} title="Bold"><Bold size={15} /></ToolBtn>
                <ToolBtn onClick={() => exec("italic")} title="Italic"><Italic size={15} /></ToolBtn>
                <ToolBtn onClick={() => exec("underline")} title="Underline"><Underline size={15} /></ToolBtn>
                <ToolBtn onClick={() => exec("hiliteColor", "#FFF3B0")} title="Highlight"><Highlighter size={15} /></ToolBtn>
                <span className="mx-1 h-5 w-px bg-border" />
                <ToolBtn onClick={() => exec("insertUnorderedList")} title="Bulleted list"><List size={15} /></ToolBtn>
                <ToolBtn onClick={() => exec("insertOrderedList")} title="Numbered list"><ListOrdered size={15} /></ToolBtn>
              </div>
              <div
                ref={editorRef}
                contentEditable
                suppressContentEditableWarning
                data-testid="followup-editor"
                className="prose prose-sm min-h-[220px] max-w-none px-3 py-3 text-sm outline-none [&_ul]:list-disc [&_ol]:list-decimal [&_ul]:pl-5 [&_ol]:pl-5"
              />
            </div>
            <p className="mt-1.5 text-[11px] text-muted-foreground">Make your final edits above — bold, italics, highlight, and lists all carry into the email.</p>
          </div>
        </div>

        {/* Footer */}
        <div className="border-t border-border px-6 py-4">
          <div className="mb-3 flex items-center gap-2">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Log reply</span>
            <button onClick={() => mark.mutate("interested")} className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs hover:bg-accent" style={{ color: "#0F6E56" }}><ThumbsUp size={12} /> Interested</button>
            <button onClick={() => mark.mutate("not_now")} className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs hover:bg-accent"><MinusCircle size={12} /> Not now</button>
            <button onClick={() => mark.mutate("no_reply")} className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs hover:bg-accent" style={{ color: "#A85A1F" }}><ThumbsDown size={12} /> No reply</button>
          </div>
          <div className="flex items-center justify-end gap-2">
            <button onClick={() => saveDraft.mutate()} disabled={saveDraft.isPending}
              className="inline-flex items-center gap-2 rounded-md border border-border px-3.5 py-2 text-sm font-medium hover:bg-accent disabled:opacity-60" data-testid="button-save-draft">
              {saveDraft.isPending ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />} Save draft
            </button>
            <button onClick={attemptSend} disabled={send.isPending || !to}
              className="inline-flex items-center gap-2 rounded-md px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
              style={{ background: confirmSend ? "hsl(0 65% 42%)" : "hsl(222 47% 20%)" }} data-testid="button-send-followup">
              {send.isPending ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />}
              {confirmSend ? "Send anyway" : "Send follow-up"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Reusable rich-text field (toolbar + contentEditable) ───────────────────
type RichHandle = { getHtml: () => string };
const RichTextField = forwardRef<RichHandle, { initialHtml?: string; minHeight?: number }>(
  function RichTextField({ initialHtml = "", minHeight = 200 }, ref) {
    const elRef = useRef<HTMLDivElement>(null);
    useEffect(() => { if (elRef.current) elRef.current.innerHTML = initialHtml || "<p></p>"; /* eslint-disable-next-line */ }, []);
    useImperativeHandle(ref, () => ({ getHtml: () => sanitize(elRef.current?.innerHTML ?? "") }));
    const exec = (cmd: string, value?: string) => { elRef.current?.focus(); document.execCommand(cmd, false, value); };
    const Btn = ({ cmd, val, title, children }: { cmd: string; val?: string; title: string; children: React.ReactNode }) => (
      <button type="button" title={title} onMouseDown={(e) => e.preventDefault()} onClick={() => exec(cmd, val)}
        className="inline-flex h-8 w-8 items-center justify-center rounded hover:bg-accent">{children}</button>
    );
    return (
      <div className="rounded-md border border-border bg-card">
        <div className="flex items-center gap-0.5 border-b border-border px-1.5 py-1">
          <Btn cmd="bold" title="Bold"><Bold size={15} /></Btn>
          <Btn cmd="italic" title="Italic"><Italic size={15} /></Btn>
          <Btn cmd="underline" title="Underline"><Underline size={15} /></Btn>
          <Btn cmd="hiliteColor" val="#FFF3B0" title="Highlight"><Highlighter size={15} /></Btn>
          <span className="mx-1 h-5 w-px bg-border" />
          <Btn cmd="insertUnorderedList" title="Bulleted list"><List size={15} /></Btn>
          <Btn cmd="insertOrderedList" title="Numbered list"><ListOrdered size={15} /></Btn>
        </div>
        <div ref={elRef} contentEditable suppressContentEditableWarning
          className="prose prose-sm max-w-none px-3 py-3 text-sm outline-none [&_ul]:list-disc [&_ol]:list-decimal [&_ul]:pl-5 [&_ol]:pl-5"
          style={{ minHeight }} />
      </div>
    );
  },
);

// ─── Templates manager (Templates tab) ──────────────────────────────────────
function TemplatesPanel({ profile }: { profile?: Profile }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const { data, isLoading } = useQuery<{ items: DbTemplate[] }>({
    queryKey: ["/api/sales/followup-templates"],
    queryFn: () => customFetch(api("/sales/followup-templates"), { credentials: "include" }),
  });
  const [editing, setEditing] = useState<DbTemplate | "new" | null>(null);
  const items = data?.items ?? [];

  const del = useMutation({
    mutationFn: (id: number) => customFetch(api(`/sales/followup-templates/${id}`), { method: "DELETE", credentials: "include" }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["/api/sales/followup-templates"] }); toast({ title: "Template deleted" }); },
    onError: (e: any) => toast({ title: "Couldn't delete", description: String(e?.message ?? e), variant: "destructive" }),
  });

  return (
    <div className="p-5">
      <SignoffCard profile={profile} />
      <div className="mb-3 flex items-center justify-between">
        <p className="text-sm text-muted-foreground">Shared library. Edits are live for the whole team — no deploy needed. Use <code className="rounded bg-muted px-1">[Square Bracket]</code> placeholders; the app fills [First Name], [Company], [Name], [Title], [Phone], [Calendar link] and highlights the rest.</p>
        <button onClick={() => setEditing("new")} className="inline-flex shrink-0 items-center gap-1.5 rounded-md px-3 py-2 text-sm font-medium text-white" style={{ background: "hsl(222 47% 20%)" }}>
          <Plus size={15} /> New template
        </button>
      </div>
      {isLoading ? (
        <div className="flex items-center gap-2 py-10 text-sm text-muted-foreground"><Loader2 size={16} className="animate-spin" /> Loading…</div>
      ) : items.length === 0 ? (
        <div className="py-10 text-center text-sm text-muted-foreground">No templates yet. Create your first one.</div>
      ) : (
        <div className="grid gap-2">
          {items.map((t) => (
            <div key={t.id} className="flex items-start justify-between gap-3 rounded-lg border border-border p-3">
              <div className="min-w-0">
                <div className="text-sm font-medium">{t.name}</div>
                <div className="truncate text-xs text-muted-foreground">{t.subject || "—"}</div>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <button onClick={() => setEditing(t)} className="rounded-md border border-border px-2.5 py-1.5 text-xs hover:bg-accent">Edit</button>
                <button onClick={() => { if (confirm(`Delete “${t.name}”?`)) del.mutate(t.id); }} className="rounded-md border border-border px-2.5 py-1.5 text-xs text-destructive hover:bg-accent">Delete</button>
              </div>
            </div>
          ))}
        </div>
      )}
      {editing && <TemplateEditor template={editing === "new" ? null : editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

function TemplateEditor({ template, onClose }: { template: DbTemplate | null; onClose: () => void }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const bodyRef = useRef<RichHandle>(null);
  const [name, setName] = useState(template?.name ?? "");
  const [subject, setSubject] = useState(template?.subject ?? "");

  const save = useMutation({
    mutationFn: () => {
      const payload = { name, subject, body: bodyRef.current?.getHtml() ?? "" };
      return template
        ? customFetch(api(`/sales/followup-templates/${template.id}`), { method: "PUT", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) })
        : customFetch(api("/sales/followup-templates"), { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...payload, sortOrder: 99 }) });
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["/api/sales/followup-templates"] }); toast({ title: template ? "Template updated" : "Template created" }); onClose(); },
    onError: (e: any) => toast({ title: "Couldn't save", description: String(e?.message ?? e), variant: "destructive" }),
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative flex max-h-[85vh] w-full max-w-2xl flex-col rounded-xl bg-background shadow-2xl">
        <div className="flex items-center justify-between border-b border-border px-5 py-3">
          <div className="font-serif text-xl">{template ? "Edit template" : "New template"}</div>
          <button onClick={onClose} className="rounded-md p-1.5 text-muted-foreground hover:bg-accent"><X size={18} /></button>
        </div>
        <div className="space-y-3 overflow-y-auto px-5 py-4">
          <label className="block text-sm">
            <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Name</span>
            <input value={name} onChange={(e) => setName(e.target.value)} className="w-full rounded-md border border-border bg-card px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring/40" />
          </label>
          <label className="block text-sm">
            <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Subject</span>
            <input value={subject} onChange={(e) => setSubject(e.target.value)} className="w-full rounded-md border border-border bg-card px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring/40" />
          </label>
          <div>
            <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Body</span>
            <RichTextField ref={bodyRef} initialHtml={template?.body ?? "<p>Hi [First Name],</p><p></p>"} minHeight={260} />
          </div>
        </div>
        <div className="flex items-center justify-end gap-2 border-t border-border px-5 py-3">
          <button onClick={onClose} className="rounded-md border border-border px-3.5 py-2 text-sm font-medium hover:bg-accent">Cancel</button>
          <button onClick={() => save.mutate()} disabled={save.isPending || !name} className="inline-flex items-center gap-2 rounded-md px-4 py-2 text-sm font-medium text-white disabled:opacity-60" style={{ background: "hsl(222 47% 20%)" }}>
            {save.isPending ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />} Save
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Log client modal ───────────────────────────────────────────────────────
function LogClientModal({ onClose }: { onClose: () => void }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [f, setF] = useState({
    startup: "", contact: "", email: "", program: "", stage: "", host: "", cohost: "",
    sessions: "", lastSprintDate: "", sprintCompleted: true,
  });
  const set = (k: keyof typeof f) => (e: any) => setF((s) => ({ ...s, [k]: e.target.value }));

  const create = useMutation({
    mutationFn: () => customFetch(api("/sales/followups"), {
      method: "POST", credentials: "include", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...f, sessions: f.sessions ? Number(f.sessions) : null }),
    }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["/api/sales/followups"] }); toast({ title: "Client logged" }); onClose(); },
    onError: (e: any) => toast({ title: "Couldn't log client", description: String(e?.message ?? e), variant: "destructive" }),
  });

  // Plain render fn (NOT a component) so inputs keep focus while typing.
  const field = (label: string, k: keyof typeof f, type = "text", ph?: string) => (
    <label className="block text-sm">
      <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</span>
      <input type={type} value={String(f[k])} onChange={set(k)} placeholder={ph}
        className="w-full rounded-md border border-border bg-card px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring/40" />
    </label>
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative flex max-h-[88vh] w-full max-w-lg flex-col rounded-xl bg-background shadow-2xl">
        <div className="flex items-center justify-between border-b border-border px-5 py-3">
          <div className="font-serif text-xl">Log a client</div>
          <button onClick={onClose} className="rounded-md p-1.5 text-muted-foreground hover:bg-accent"><X size={18} /></button>
        </div>
        <div className="grid grid-cols-2 gap-3 overflow-y-auto px-5 py-4">
          <div className="col-span-2">{field("Client / company *", "startup", "text", "Acme Labs")}</div>
          {field("Contact first name", "contact", "text", "Priya")}
          {field("Email", "email", "email", "priya@acme.com")}
          {field("Program", "program", "text", "ISB Cleantech")}
          {field("Stage", "stage", "text", "Early Traction")}
          {field("Host", "host", "text", "Vani")}
          {field("Co-host", "cohost", "text", "Saumitra")}
          {field("Sessions", "sessions", "number", "2")}
          {field("Last sprint date *", "lastSprintDate", "date")}
          <label className="col-span-2 flex items-center gap-2 text-sm">
            <input type="checkbox" checked={f.sprintCompleted} onChange={(e) => setF((s) => ({ ...s, sprintCompleted: e.target.checked }))} />
            Sprint completed (eligible for follow-up)
          </label>
          <p className="col-span-2 text-[11px] text-muted-foreground">* required. The last sprint date drives the 30-day timer. Re-logging the same company + program edits the existing record.</p>
        </div>
        <div className="flex items-center justify-end gap-2 border-t border-border px-5 py-3">
          <button onClick={onClose} className="rounded-md border border-border px-3.5 py-2 text-sm font-medium hover:bg-accent">Cancel</button>
          <button onClick={() => create.mutate()} disabled={create.isPending || !f.startup || !f.lastSprintDate}
            className="inline-flex items-center gap-2 rounded-md px-4 py-2 text-sm font-medium text-white disabled:opacity-60" style={{ background: "hsl(222 47% 20%)" }}>
            {create.isPending ? <Loader2 size={15} className="animate-spin" /> : <Plus size={15} />} Log client
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Consultant sign-off card (Templates tab) ───────────────────────────────
function SignoffCard({ profile }: { profile?: Profile }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState(profile?.title ?? "");
  const [phone, setPhone] = useState(profile?.phone ?? "");
  const [calendarLink, setCalendarLink] = useState(profile?.calendarLink ?? "");
  useEffect(() => {
    setTitle(profile?.title ?? ""); setPhone(profile?.phone ?? ""); setCalendarLink(profile?.calendarLink ?? "");
  }, [profile?.title, profile?.phone, profile?.calendarLink]);

  const save = useMutation({
    mutationFn: () => customFetch(api("/me/followup-profile"), {
      method: "PUT", credentials: "include", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title, phone, calendarLink }),
    }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["/api/me/followup-profile"] }); toast({ title: "Sign-off saved" }); setOpen(false); },
    onError: (e: any) => toast({ title: "Couldn't save", description: String(e?.message ?? e), variant: "destructive" }),
  });

  const filled = [profile?.title, profile?.phone, profile?.calendarLink].filter(Boolean).length;
  return (
    <div className="mb-4 rounded-lg border border-border bg-muted/40 p-4">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-sm font-medium">My follow-up sign-off</div>
          <div className="text-[12px] text-muted-foreground">Auto-fills [Title], [Phone], [Calendar link] in every template. {filled}/3 set.</div>
        </div>
        <button onClick={() => setOpen((v) => !v)} className="rounded-md border border-border px-2.5 py-1.5 text-xs hover:bg-accent">{open ? "Close" : "Edit"}</button>
      </div>
      {open && (
        <div className="mt-3 grid gap-3 sm:grid-cols-3">
          <label className="text-sm"><span className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Title</span>
            <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Growth Consultant" className="w-full rounded-md border border-border bg-card px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring/40" /></label>
          <label className="text-sm"><span className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Phone</span>
            <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+91 …" className="w-full rounded-md border border-border bg-card px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring/40" /></label>
          <label className="text-sm"><span className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Calendar link</span>
            <input value={calendarLink} onChange={(e) => setCalendarLink(e.target.value)} placeholder="https://cal.com/…" className="w-full rounded-md border border-border bg-card px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring/40" /></label>
          <div className="sm:col-span-3">
            <button onClick={() => save.mutate()} disabled={save.isPending} className="inline-flex items-center gap-2 rounded-md px-3.5 py-2 text-sm font-medium text-white disabled:opacity-60" style={{ background: "hsl(222 47% 20%)" }}>
              {save.isPending ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />} Save sign-off
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Clients directory (Clients tab) ────────────────────────────────────────
function ClientsPanel({ items, loading }: { items: Followup[]; loading: boolean }) {
  const [q, setQ] = useState("");
  const rows = useMemo(() => {
    const term = q.trim().toLowerCase();
    return items
      .filter((f) => !term || `${f.startup} ${f.contact ?? ""} ${f.email ?? ""} ${f.program ?? ""}`.toLowerCase().includes(term))
      .sort((a, b) => a.startup.localeCompare(b.startup));
  }, [items, q]);

  if (loading) return <div className="flex items-center gap-2 p-10 text-sm text-muted-foreground"><Loader2 size={16} className="animate-spin" /> Loading clients…</div>;

  return (
    <div>
      <div className="flex items-center justify-between gap-2 border-b border-border px-5 py-3">
        <div className="text-sm text-muted-foreground">{rows.length} client{rows.length === 1 ? "" : "s"} from Live Sprint Tracking</div>
        <div className="relative">
          <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search…" className="w-56 rounded-md border border-border bg-background py-1.5 pl-8 pr-3 text-sm outline-none focus:ring-2 focus:ring-ring/40" />
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-[11px] uppercase tracking-wider text-muted-foreground">
              <th className="px-5 py-2.5 font-medium">Client</th>
              <th className="px-3 py-2.5 font-medium">Email</th>
              <th className="px-3 py-2.5 font-medium">Program</th>
              <th className="px-3 py-2.5 font-medium">Stage</th>
              <th className="px-3 py-2.5 font-medium">Host</th>
              <th className="px-3 py-2.5 font-medium">Sessions</th>
              <th className="px-3 py-2.5 font-medium">Last sprint</th>
              <th className="px-3 py-2.5 font-medium">Done</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((f) => {
              const pm = programMeta(f.program);
              const stg = STAGE_META[(f.stage ?? "").toLowerCase()];
              return (
                <tr key={f.key} className="border-b border-border/60 hover:bg-accent/40">
                  <td className="px-5 py-3"><div className="font-medium">{f.startup}</div><div className="text-xs text-muted-foreground">{f.contact ?? "—"}</div></td>
                  <td className="px-3 py-3 text-muted-foreground">{f.email ?? "—"}</td>
                  <td className="px-3 py-3">{f.program ? <span className="rounded px-2 py-0.5 text-[11px] font-medium" style={{ background: pm.bg, color: pm.fg }}>{f.program}</span> : "—"}</td>
                  <td className="px-3 py-3">{f.stage ? <span className="rounded px-2 py-0.5 text-[11px] font-medium" style={stg ? { background: stg.bg, color: stg.fg } : { background: "#F1EFE8", color: "#5F5E5A" }}>{f.stage}</span> : "—"}</td>
                  <td className="px-3 py-3">{f.host ?? "—"}{f.cohost ? <span className="text-xs text-muted-foreground"> +{f.cohost}</span> : ""}</td>
                  <td className="px-3 py-3 tabular-nums">{f.sessions ?? "—"}</td>
                  <td className="px-3 py-3">{fmtDate(f.lastSprintDate)}</td>
                  <td className="px-3 py-3">{f.sprintCompleted === true ? <CheckCircle2 size={14} style={{ color: "var(--success)" }} /> : f.sprintCompleted === false ? <span className="text-muted-foreground text-[12px]">No</span> : "—"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─── Pipeline board (Pipeline tab) ──────────────────────────────────────────
// A follow-up pipeline built from status — not a separate leads CRM. Columns
// track a client from Due → Sent → Awaiting → Replied outcomes.
const PIPELINE_COLS: { key: string; label: string; match: (s: string) => boolean }[] = [
  { key: "due", label: "Due", match: (s) => s === "due" },
  { key: "sent", label: "Sent", match: (s) => s === "sent" },
  { key: "nudge", label: "Needs nudge", match: (s) => s === "no_reply" },
  { key: "replied", label: "Replied", match: (s) => s === "replied" },
  { key: "interested", label: "Interested", match: (s) => s === "replied_interested" },
  { key: "not_now", label: "Not now", match: (s) => s === "replied_not_now" },
];
function PipelinePanel({ items, onOpen }: { items: Followup[]; onOpen: (key: string) => void }) {
  return (
    <div className="overflow-x-auto p-5">
      <div className="flex min-w-[900px] gap-3">
        {PIPELINE_COLS.map((col) => {
          const cards = items.filter((f) => col.match(f.status));
          return (
            <div key={col.key} className="flex-1">
              <div className="mb-2 flex items-center justify-between px-1">
                <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{col.label}</span>
                <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] tabular-nums text-muted-foreground">{cards.length}</span>
              </div>
              <div className="space-y-2">
                {cards.map((f) => {
                  const pm = programMeta(f.program);
                  return (
                    <button key={f.key} onClick={() => onOpen(f.key)} className="block w-full rounded-lg border border-border bg-card p-3 text-left transition-colors hover:bg-accent/40">
                      <div className="truncate text-sm font-medium">{f.startup}</div>
                      <div className="truncate text-xs text-muted-foreground">{f.contact ?? "—"}</div>
                      <div className="mt-1.5 flex items-center gap-1.5">
                        {f.program && <span className="rounded px-1.5 py-0.5 text-[10px] font-medium" style={{ background: pm.bg, color: pm.fg }}>{f.program}</span>}
                        {f.daysSinceSprint != null && <span className="text-[10px] text-muted-foreground">{f.daysSinceSprint}d</span>}
                      </div>
                    </button>
                  );
                })}
                {cards.length === 0 && <div className="rounded-lg border border-dashed border-border px-3 py-4 text-center text-[11px] text-muted-foreground">—</div>}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
