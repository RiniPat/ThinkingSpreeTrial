import { useEffect, useMemo, useRef, useState, forwardRef, useImperativeHandle } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { customFetch, useGetMe } from "@workspace/api-client-react";
import { Layout } from "@/components/Layout";
import { useToast } from "@/hooks/use-toast";
import {
  Mail, RefreshCw, Loader2, Search, Plus, X, Send, Save, Check,
  Bold, Italic, Underline, Highlighter, List, ListOrdered,
  AlertTriangle, CheckCircle2, Clock, ThumbsUp, ThumbsDown, MinusCircle,
  MessageSquare, Trophy, ChevronRight, ChevronLeft,
  Users, Target, Undo2, BarChart3, Ban,
  FileText, Link2, Sparkles, Paperclip, Trash2, Wand2, Download, FileType2,
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
  interest: string | null;
  interestSetAt: string | null;
  replyState: string | null;
  sentAt: string | null;
  lastContactAt: string | null;
  draftSubject: string | null;
  draftBodyHtml: string | null;
  templateKey: string | null;
  skipped: boolean;
  skipReason: string | null;
  hasSent: boolean;
  awaitingReply: boolean;
  nudgeDue: boolean;
  responseState: string | null;
  responseNote: string | null;
  nudgeSentAt: string | null;
  toffeeSentAt: string | null;
  pipelineStage: string;
  pipelineStageLabel: string;
  enrichmentStatus: string | null;
  tSheetUrl: string | null;
  hasTSheetSummary: boolean;
  hasDocsSummary: boolean;
  hasGrowthDoc: boolean;
  docCount: number;
};
type Stats = {
  due: number; completedSprints: number; sentThisMonth: number;
  replyRate: number; awaitingReply: number; needsNudge: number; skipped: number;
  interested: number; maybe: number; notNow: number; untriaged: number; actionable: number;
};

// ─── Shortlisting (interest) metadata ────────────────────────────────────────
// DB values stay interested/maybe/not_now; UI labels are the shortlisting terms.
const INTEREST_META: Record<string, { label: string; bg: string; fg: string }> = {
  interested: { label: "Shortlisted",     bg: "#E1F5EE", fg: "#0F6E56" },
  maybe:      { label: "Maybe",           bg: "hsl(36 70% 92%)", fg: "#8A5A00" },
  not_now:    { label: "Not shortlisted", bg: "#EEF1F5", fg: "#4A5566" },
};
const ACTIONABLE_INTEREST = new Set(["interested", "maybe"]);

// ─── Client-response metadata (pipeline) ─────────────────────────────────────
const RESPONSE_META: Record<string, { label: string; bg: string; fg: string }> = {
  interested:                { label: "Interested",              bg: "#E1F5EE", fg: "#0F6E56" },
  quotation_sent:            { label: "Quotation sent",          bg: "#E6F1FB", fg: "#0C447C" },
  no_reply_after_quotation:  { label: "No reply after quotation",bg: "#FBEEE1", fg: "#A85A1F" },
  other:                     { label: "Other",                   bg: "#EFEAFB", fg: "#5B3FA8" },
};
const RESPONSE_OPTIONS = ["interested", "quotation_sent", "no_reply_after_quotation", "other"] as const;

// Pipeline stage a send belongs to (drives which template set + timestamp).
const STAGE_OPTIONS: { key: string; label: string }[] = [
  { key: "outreach", label: "1st outreach" },
  { key: "nudge", label: "Nudge" },
  { key: "toffee", label: "Reminder (Toffee)" },
];
const STAGE_SEND_LABEL: Record<string, string> = { outreach: "1st outreach", nudge: "Nudge", toffee: "Reminder (Toffee)" };

// Pipeline stage lanes (send-driven; 7 days per step).
const PIPELINE_LANES: { key: string; label: string; match: (s: string) => boolean }[] = [
  { key: "outreach", label: "1st outreach done", match: (s) => s === "outreach_sent" || s === "nudge_due" },
  { key: "nudge",    label: "Nudge sent",        match: (s) => s === "nudge_sent" || s === "toffee_due" },
  { key: "toffee",   label: "Reminder (Toffee) sent", match: (s) => s === "toffee_sent" },
  { key: "dead",     label: "Dead lead",         match: (s) => s === "dead" },
  { key: "replied",  label: "Replied",           match: (s) => s === "replied" },
];
type Viewer = { name: string | null; role: string; canViewOps: boolean };
type ListPayload = {
  items: Followup[]; stats: Stats; hasCompletedColumn: boolean; syncedAt?: string;
  cohorts?: string[]; scoped?: boolean; viewer?: Viewer;
};
type DbTemplate = { id: number; name: string; subject: string | null; body: string; sortOrder: number; pipelineStage?: string | null };

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

/** ISB retargeting programmes (ISB Cleantech, ISB IRA 2.0) get sheet autofill. */
function isIsbProgram(p: string | null): boolean {
  return /isb|cleantech|ira\s*2/i.test(String(p ?? ""));
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
    key: "ai_email", name: "AI Email", blurb: "Fully AI-written warm re-engagement from the T-sheet + transcript.",
    subject: "Reconnecting with [Company]",
    body:
      "<p>Click <strong>Generate AI draft</strong> to write a warm, personalised re-engagement email for [Company] from the analysed T-sheet and session transcript.</p>",
  },
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

type Profile = { name: string | null; title: string | null; phone: string | null; calendarLink: string | null; sprintHostNames?: string | null };

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

// ─── Triage control (interested / maybe / not now) ──────────────────────────
function TriageCell({ f, compact }: { f: Followup; compact?: boolean }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const set = useMutation({
    mutationFn: (interest: string | null) => customFetch(api(`/sales/followups/${encodeURIComponent(f.key)}/interest`), {
      method: "PUT", credentials: "include", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ interest }),
    }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["/api/sales/followups"] }),
    onError: (e: any) => toast({ title: "Couldn't update triage", description: String(e?.message ?? e), variant: "destructive" }),
  });
  const opts: { key: string; label: string; icon: React.ReactNode; fg: string; bg: string }[] = [
    { key: "interested", label: "Shortlisted", icon: <ThumbsUp size={12} />, fg: "#0F6E56", bg: "#E1F5EE" },
    { key: "maybe", label: "Maybe", icon: <MinusCircle size={12} />, fg: "#8A5A00", bg: "hsl(36 70% 92%)" },
    { key: "not_now", label: "Not shortlisted", icon: <ThumbsDown size={12} />, fg: "#4A5566", bg: "#EEF1F5" },
  ];
  return (
    <div className={`inline-flex overflow-hidden rounded-md border border-border ${compact ? "" : ""}`} onClick={(e) => e.stopPropagation()}>
      {opts.map((o) => {
        const active = f.interest === o.key;
        return (
          <button
            key={o.key}
            title={o.label}
            disabled={set.isPending}
            onClick={() => set.mutate(active ? null : o.key)}
            className="inline-flex items-center gap-1 px-2 py-1 text-[11px] font-medium transition-colors disabled:opacity-50"
            style={active ? { background: o.bg, color: o.fg } : { color: "var(--muted-foreground)" }}
          >
            {o.icon}{!compact && <span>{o.label}</span>}
          </button>
        );
      })}
    </div>
  );
}

// ─── Reply / send helpers (drive insights + the clients "reverted" count) ────
const SENT_STATUSES = new Set(["sent", "no_reply", "replied", "replied_interested", "replied_not_now"]);
const REPLIED_STATUSES = new Set(["replied", "replied_interested", "replied_not_now"]);
/** Has a follow-up actually gone out for this client? */
function isSent(f: Followup): boolean {
  return Boolean(f.sentAt) || SENT_STATUSES.has(f.status);
}
/** Did the client revert back to us (any reply, positive or otherwise)? */
function isReplied(f: Followup): boolean {
  return REPLIED_STATUSES.has(f.status) || f.replyState === "interested" || f.replyState === "not_now";
}

/** Human name for a stored templateKey (DB id, built-in fallback id, or legacy slug). */
function resolveTemplateName(key: string | null, templates: DbTemplate[]): string {
  if (!key) return "Untitled";
  const db = templates.find((t) => String(t.id) === key);
  if (db) return db.name;
  const builtin = TEMPLATES.find((t, i) => key === t.key || key === String(-(i + 1)));
  if (builtin) return builtin.name;
  const legacy: Record<string, string> = { checkin: "Catch-up", next_sprint: "Two-sprint intervention", nudge: "Nudge" };
  return legacy[key] ?? "Other template";
}

type TemplatePerf = { name: string; sent: number; replies: number; rate: number };
/** Per-template send/reply tallies, ranked best-first. */
function computeTemplatePerf(items: Followup[], templates: DbTemplate[]): TemplatePerf[] {
  const map = new Map<string, TemplatePerf>();
  for (const f of items) {
    if (!f.templateKey || !isSent(f)) continue;
    const name = resolveTemplateName(f.templateKey, templates);
    const e = map.get(name) ?? { name, sent: 0, replies: 0, rate: 0 };
    e.sent += 1;
    if (isReplied(f)) e.replies += 1;
    map.set(name, e);
  }
  return [...map.values()]
    .map((e) => ({ ...e, rate: e.sent ? Math.round((e.replies / e.sent) * 100) : 0 }))
    .sort((a, b) => b.replies - a.replies || b.rate - a.rate || b.sent - a.sent);
}

// ─── Template performance panel (visual insight) ────────────────────────────
function TemplatePerformance({ items, templates }: { items: Followup[]; templates: DbTemplate[] }) {
  const perf = useMemo(() => computeTemplatePerf(items, templates), [items, templates]);
  const totalReplies = useMemo(() => items.filter(isReplied).length, [items]);
  const totalSent = useMemo(() => items.filter(isSent).length, [items]);
  const replyRate = totalSent ? Math.round((totalReplies / totalSent) * 100) : 0;
  const best = perf[0] ?? null;
  const maxRate = Math.max(1, ...perf.map((p) => p.rate));

  return (
    <div className="flex flex-col rounded-xl border border-card-border bg-card p-5">
      <div className="flex items-center justify-between">
        <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          What’s working
        </div>
        <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium"
          style={{ background: "#E0F4F3", color: "#0B6B6B" }}>
          <MessageSquare size={11} /> {totalReplies} repl{totalReplies === 1 ? "y" : "ies"}
        </span>
      </div>

      {/* Hero numbers */}
      <div className="mt-3 flex flex-wrap items-end gap-x-6 gap-y-2">
        <div>
          <div className="font-serif text-4xl leading-none" style={{ color: GOLD }}>{totalReplies}</div>
          <div className="mt-1 text-[11px] text-muted-foreground">clients reverted</div>
        </div>
        <div>
          <div className="font-serif text-4xl leading-none">{replyRate}<span className="text-2xl">%</span></div>
          <div className="mt-1 text-[11px] text-muted-foreground">reply rate · {totalSent} sent</div>
        </div>
        {best && (
          <div className="ml-auto text-right">
            <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Top template</div>
            <div className="mt-0.5 inline-flex items-center gap-1 text-sm font-medium">
              <Trophy size={13} style={{ color: GOLD }} /> {best.name}
            </div>
          </div>
        )}
      </div>

      {/* Per-template bars */}
      <div className="mt-4 space-y-2.5">
        {perf.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border px-3 py-6 text-center text-[12px] text-muted-foreground">
            Send a few follow-ups and log the replies — the best-performing template will surface here.
          </div>
        ) : (
          perf.slice(0, 4).map((p, i) => (
            <div key={p.name}>
              <div className="mb-1 flex items-center justify-between gap-2 text-xs">
                <span className="flex min-w-0 items-center gap-1.5 font-medium">
                  {i === 0 && <Trophy size={12} style={{ color: GOLD }} className="shrink-0" />}
                  <span className="truncate">{p.name}</span>
                </span>
                <span className="shrink-0 tabular-nums text-muted-foreground">
                  {p.replies}/{p.sent} · {p.rate}%
                </span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-muted">
                <div className="h-full rounded-full transition-all"
                  style={{ width: `${Math.round((p.rate / maxRate) * 100)}%`, background: i === 0 ? GOLD : "hsl(222 47% 45%)" }} />
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

const FILTERS = [
  { key: "all", label: "All" },
  { key: "untriaged", label: "To shortlist" },
  { key: "interested", label: "Shortlisted" },
  { key: "maybe", label: "Maybe" },
  { key: "not_now", label: "Not shortlisted" },
  { key: "sent", label: "Sent" },
  { key: "nudge", label: "Needs nudge" },
] as const;
type FilterKey = (typeof FILTERS)[number]["key"];

const PAGE_SIZE = 40; // "indexation": render at most one page of clients at a time

// ─── Page ───────────────────────────────────────────────────────────────────
export default function SalesInboxPage() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [filter, setFilter] = useState<FilterKey>("all");
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const [openKey, setOpenKey] = useState<string | null>(null);
  const [syncedAt, setSyncedAt] = useState<string | null>(null);
  const [tab, setTab] = useState<"followups" | "templates" | "clients" | "pipeline" | "ops">("followups");
  const [logOpen, setLogOpen] = useState(false);
  // Selected cohort (program) to narrow the list to, and check coverage against.
  const [cohort, setCohort] = useState<string | null>(null);
  // Oversight roles (sales/ops/admin) can flip between all rows and only their own.
  const [scopeMode, setScopeMode] = useState<"all" | "mine">("all");

  // Tab-visibility permissions (Ops tracking is ops/admin only).
  const { data: perms } = useQuery<{ canViewSalesOps: boolean; role: string }>({
    queryKey: ["/api/me/permissions"],
    queryFn: () => customFetch(`${BASE}/api/me/permissions`, { credentials: "include" }),
    staleTime: 60_000,
  });

  const scopeParam = scopeMode === "mine" ? "?scope=mine" : "";
  const { data, isLoading, isError, error } = useQuery<ListPayload>({
    queryKey: ["/api/sales/followups", scopeMode],
    queryFn: () => customFetch(api(`/sales/followups${scopeParam}`), { credentials: "include" }),
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
    mutationFn: () => customFetch(api(`/sales/followups/refresh${scopeParam}`), { method: "POST", credentials: "include" }),
    onSuccess: (res: ListPayload) => {
      qc.setQueryData(["/api/sales/followups", scopeMode], res);
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

  // Cohorts the viewer can see (server-computed over the scoped rows; fall back
  // to deriving from items). Drives the cohort dropdown + clickable badges.
  const cohorts = useMemo(() => {
    if (data?.cohorts?.length) return data.cohorts;
    return [...new Set(items.map((f) => (f.program ?? "").trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b));
  }, [data?.cohorts, items]);

  // If the selected cohort disappears (e.g. after a scope switch), clear it.
  useEffect(() => {
    if (cohort && !cohorts.some((c) => c.toLowerCase() === cohort.toLowerCase())) setCohort(null);
  }, [cohort, cohorts]);

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    return items.filter((f) => {
      if (cohort && (f.program ?? "").trim().toLowerCase() !== cohort.toLowerCase()) return false;
      if (term && !(`${f.startup} ${f.contact ?? ""} ${f.email ?? ""} ${f.program ?? ""}`.toLowerCase().includes(term))) return false;
      switch (filter) {
        case "untriaged": return !f.interest;
        case "interested": return f.interest === "interested";
        case "maybe": return f.interest === "maybe";
        case "not_now": return f.interest === "not_now";
        case "sent": return f.hasSent;
        case "nudge": return f.nudgeDue;
        default: return true;
      }
    }).sort((a, b) => {
      // Latest companies first: most recent sprint at the top, oldest at the end.
      const ta = a.lastSprintDate ? new Date(a.lastSprintDate).getTime() : -Infinity;
      const tb = b.lastSprintDate ? new Date(b.lastSprintDate).getTime() : -Infinity;
      return tb - ta;
    });
  }, [items, q, filter, cohort]);

  // Coverage for the selected cohort — answers "have I reached out to every
  // company on this list?". Computed over the viewer's (scoped) rows in the cohort.
  const coverage = useMemo(() => {
    if (!cohort) return null;
    const inCohort = items.filter((f) => (f.program ?? "").trim().toLowerCase() === cohort.toLowerCase());
    const actionable = inCohort.filter((f) => ACTIONABLE_INTEREST.has(f.interest ?? ""));
    const reached = actionable.filter((f) => f.hasSent).length;
    const untriaged = inCohort.filter((f) => !f.interest).length;
    const notNow = inCohort.filter((f) => f.interest === "not_now").length;
    const target = actionable.length; // interested/maybe = the ones we intend to contact
    const pending = target - reached;
    return {
      total: inCohort.length, reached, skipped: notNow, untriaged, pending, target,
      pct: target ? Math.round((reached / target) * 100) : 100,
      complete: pending === 0 && untriaged === 0,
    };
  }, [items, cohort]);

  // Pagination ("indexation") — only ever render one page of rows so a large
  // client list (hundreds of rows) never bogs the page down.
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const pageItems = useMemo(
    () => filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE),
    [filtered, safePage],
  );
  // Any change to the filter, search, or cohort resets to the first page.
  useEffect(() => { setPage(1); }, [filter, q, cohort]);

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

        {/* Scope indicator — consultants are limited to their own companies;
            oversight roles can toggle Mine / All. */}
        {data && (
          <div className="mt-4 flex flex-wrap items-center gap-2 text-[12px]">
            {data.scoped ? (
              <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-muted/50 px-3 py-1 text-muted-foreground">
                <Users size={12} /> Showing only companies you hosted or co-hosted
              </span>
            ) : perms?.canViewSalesOps || !data.scoped ? (
              <div className="inline-flex overflow-hidden rounded-full border border-border">
                {(["all", "mine"] as const).map((m) => (
                  <button
                    key={m}
                    onClick={() => setScopeMode(m)}
                    className="px-3 py-1 text-xs font-medium transition-colors"
                    style={scopeMode === m ? { background: "hsl(222 47% 20%)", color: "white" } : { color: "var(--muted-foreground)" }}
                  >
                    {m === "all" ? "All consultants" : "Only mine"}
                  </button>
                ))}
              </div>
            ) : null}
          </div>
        )}

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

        {/* Insights: key stats (left) + template performance (right) — a balanced
            two-column band so the top of the page reads evenly, not cluttered. */}
        <div className="mt-6 grid gap-4 lg:grid-cols-[1.15fr_1fr]">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <StatCard label="To shortlist" value={stats?.untriaged ?? "—"} accent hint="not yet marked" />
            <StatCard label="Shortlisted / Maybe" value={stats ? stats.interested + stats.maybe : "—"} hint="to follow up" />
            <StatCard label="Awaiting reply" value={stats?.awaitingReply ?? "—"} />
            <StatCard label="Needs nudge" value={stats?.needsNudge ?? "—"} hint="7+ days, no reply" />
            <StatCard label="Sent this month" value={stats?.sentThisMonth ?? "—"} />
            <StatCard label="Reply rate" value={stats ? `${stats.replyRate}%` : "—"} />
          </div>
          <TemplatePerformance items={items} templates={templates} />
        </div>

        {/* Section card */}
        <div className="mt-6 rounded-xl border border-card-border bg-card">
          {/* Underline tabs */}
          <div className="flex items-center gap-6 border-b border-border px-5">
            {([
              { label: "Follow-ups", key: "followups" as const },
              { label: "Pipeline", key: "pipeline" as const },
              { label: "Templates", key: "templates" as const },
              ...(perms?.canViewSalesOps ? [{ label: "Ops tracking", key: "ops" as const }] : []),
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
            <TemplatesPanel profile={profile} canEdit={perms?.canViewSalesOps ?? false} />
          ) : tab === "pipeline" ? (
            <PipelinePanel onOpen={(k) => setOpenKey(k)} />
          ) : tab === "ops" ? (
            <OpsPanel cohort={cohort} cohorts={cohorts} onCohort={setCohort} />
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
            {/* Cohort filter — pick a cohort to narrow the list and check coverage. */}
            {cohorts.length > 0 && (
              <select
                value={cohort ?? ""}
                onChange={(e) => setCohort(e.target.value || null)}
                className="rounded-full border border-border bg-background px-3 py-1 text-xs font-medium text-muted-foreground outline-none focus:ring-2 focus:ring-ring/40"
                title="Filter by cohort / program"
              >
                <option value="">All cohorts</option>
                {cohorts.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            )}
            <div className="relative ml-auto">
              <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Search client, contact, email, cohort…"
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

          {/* Cohort coverage — "have I reached out to every company on this list?" */}
          {cohort && coverage && (
            <div className="border-b border-border px-5 py-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2 text-sm">
                  {coverage.complete
                    ? <CheckCircle2 size={16} style={{ color: "var(--success)" }} />
                    : <Target size={16} className="text-muted-foreground" />}
                  <span className="font-medium">{cohort}</span>
                  <span className="text-muted-foreground">
                    {coverage.complete
                      ? `All ${coverage.target} targeted compan${coverage.target === 1 ? "y" : "ies"} reached out to`
                      : `${coverage.reached}/${coverage.target} reached out · ${coverage.pending} still to contact`}
                    {coverage.skipped > 0 ? ` · ${coverage.skipped} not targeting` : ""}
                  </span>
                </div>
                <button onClick={() => setCohort(null)} className="text-xs text-muted-foreground underline-offset-2 hover:underline">Clear cohort</button>
              </div>
              <div className="mt-2 h-2 overflow-hidden rounded-full bg-muted">
                <div className="h-full rounded-full transition-all"
                  style={{ width: `${coverage.pct}%`, background: coverage.complete ? "var(--success)" : GOLD }} />
              </div>
            </div>
          )}

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
            <>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-[11px] uppercase tracking-wider text-muted-foreground">
                    <th className="px-5 py-2.5 font-medium">Client</th>
                    <th className="px-3 py-2.5 font-medium">Shortlist</th>
                    <th className="px-3 py-2.5 font-medium">Status</th>
                    <th className="px-3 py-2.5 font-medium">Program</th>
                    <th className="px-3 py-2.5 font-medium">Stage</th>
                    <th className="px-3 py-2.5 font-medium">Days</th>
                    <th className="px-3 py-2.5 font-medium">Sprint done</th>
                    <th className="px-3 py-2.5 font-medium">Sessions</th>
                    <th className="px-3 py-2.5 font-medium">Host</th>
                  </tr>
                </thead>
                <tbody>
                  {pageItems.map((f) => {
                    const sm = statusMeta(f.status);
                    const pm = programMeta(f.program);
                    const stg = STAGE_META[(f.stage ?? "").toLowerCase()];
                    return (
                      <tr
                        key={f.key}
                        onClick={() => setOpenKey(f.key)}
                        className="cursor-pointer border-b border-border/60 hover:bg-accent/40"
                        data-testid={`row-followup-${f.key}`}
                      >
                        {/* Client + an always-visible Follow-up button on the far
                            left, so the consultant never has to scroll sideways. */}
                        <td className="px-5 py-3">
                          <div className="flex items-center justify-between gap-3">
                            <div className="min-w-0">
                              <div className="truncate font-medium">{f.startup}</div>
                              <div className="truncate text-xs text-muted-foreground">{f.contact ?? "—"}{f.email ? ` · ${f.email}` : ""}</div>
                            </div>
                            <button
                              onClick={(e) => { e.stopPropagation(); setOpenKey(f.key); }}
                              className="inline-flex shrink-0 items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium text-white"
                              style={{ background: "hsl(222 47% 20%)" }}
                              data-testid={`action-open-${f.key}`}
                            >
                              <Mail size={13} /> Follow up
                            </button>
                          </div>
                        </td>
                        <td className="px-3 py-3">
                          <TriageCell f={f} compact />
                        </td>
                        <td className="px-3 py-3">
                          <span className="whitespace-nowrap rounded-full px-2.5 py-1 text-[11px] font-medium" style={{ background: sm.bg, color: sm.fg }}>{sm.label}</span>
                          {f.nudgeDue && (
                            <span className="ml-1.5 inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-1 text-[11px] font-medium" style={{ background: "#FBEEE1", color: "#A85A1F" }}>
                              <Clock size={11} /> Nudge due
                            </span>
                          )}
                        </td>
                        <td className="px-3 py-3">
                          {f.program
                            ? <button
                                onClick={(e) => { e.stopPropagation(); setCohort(f.program); }}
                                title={`Show only ${f.program} & check coverage`}
                                className="rounded px-2 py-0.5 text-[11px] font-medium hover:ring-2 hover:ring-ring/40"
                                style={{ background: pm.bg, color: pm.fg }}
                              >{f.program}</button>
                            : <span className="text-muted-foreground">—</span>}
                        </td>
                        <td className="px-3 py-3">
                          {f.stage
                            ? <span className="rounded px-2 py-0.5 text-[11px] font-medium" style={stg ? { background: stg.bg, color: stg.fg } : { background: "#F1EFE8", color: "#5F5E5A" }}>{f.stage}</span>
                            : <span className="text-muted-foreground">—</span>}
                        </td>
                        <td className="px-3 py-3 tabular-nums">
                          {f.daysSinceSprint != null ? `${f.daysSinceSprint}d` : "—"}
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
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Pager */}
            {filtered.length > PAGE_SIZE && (
              <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-5 py-3 text-sm">
                <span className="text-muted-foreground">
                  Showing <span className="tabular-nums">{(safePage - 1) * PAGE_SIZE + 1}</span>–
                  <span className="tabular-nums">{Math.min(safePage * PAGE_SIZE, filtered.length)}</span> of{" "}
                  <span className="tabular-nums">{filtered.length}</span>
                </span>
                <div className="flex items-center gap-1.5">
                  <button
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                    disabled={safePage <= 1}
                    className="inline-flex items-center gap-1 rounded-md border border-border px-2.5 py-1.5 text-xs font-medium hover:bg-accent disabled:opacity-40"
                  >
                    <ChevronLeft size={14} /> Prev
                  </button>
                  <span className="px-1 tabular-nums text-muted-foreground">Page {safePage} / {totalPages}</span>
                  <button
                    onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                    disabled={safePage >= totalPages}
                    className="inline-flex items-center gap-1 rounded-md border border-border px-2.5 py-1.5 text-xs font-medium hover:bg-accent disabled:opacity-40"
                  >
                    Next <ChevronRight size={14} />
                  </button>
                </div>
              </div>
            )}
            </>
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
// Enrichment context returned by GET /:key/context.
type CtxDoc = { id: number; title: string | null; sourceType: string; url: string | null; status: string | null; error: string | null };
type GrowthState = { brief: any; docxUrl: string | null; pdfUrl: string | null; needsValidation?: string[] } | null;
type ContextPayload = {
  interest: string | null;
  tSheetUrl: string | null; tSheetSummary: string | null; docsSummary: string | null;
  enrichmentStatus: string | null; enrichmentError: string | null; enrichedAt: string | null;
  docs: CtxDoc[];
  growth: { brief: any; docxUrl: string | null; pdfUrl: string | null; generatedAt: string | null } | null;
};

function ComposeDrawer({ row, templates, profile, onClose }: { row: Followup; templates: DbTemplate[]; profile?: Profile; onClose: () => void }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const { data: me } = useGetMe();
  const prof: Profile = profile ?? { name: (me as any)?.name ?? null, title: null, phone: null, calendarLink: null };
  const editorRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [tmplId, setTmplId] = useState<number | null>(null);
  const [subject, setSubject] = useState<string>(row.draftSubject ?? "");
  const [to, setTo] = useState<string>(row.email ?? "");
  const [confirmSend, setConfirmSend] = useState(false);

  // Shortlisting (local mirror for instant gating; server is source of truth).
  const [interest, setInterest] = useState<string | null>(row.interest ?? null);
  const actionable = ACTIONABLE_INTEREST.has(interest ?? "");

  // Pipeline stage this send is (outreach | nudge | toffee).
  const [stage, setStage] = useState<string>("outreach");
  // Client-response tracking.
  const [respState, setRespState] = useState<string>(row.responseState ?? "");
  const [respNote, setRespNote] = useState<string>(row.responseNote ?? "");

  // Enrichment state.
  const [tSheetUrl, setTSheetUrl] = useState<string>(row.tSheetUrl ?? "");
  // Transcript Google-Doc (auto-filled from the "For ISB" master sheet for ISB
  // programmes; read during Analyse as a meeting doc).
  const [transcriptGdocUrl, setTranscriptGdocUrl] = useState<string>("");
  const [existingDocs, setExistingDocs] = useState<(CtxDoc & { keep: boolean })[]>([]);
  const [pendingLinks, setPendingLinks] = useState<string[]>([]);
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [linkInput, setLinkInput] = useState("");
  const [enrichStatus, setEnrichStatus] = useState<string | null>(row.enrichmentStatus ?? null);
  const [enrichError, setEnrichError] = useState<string | null>(null);

  // Growth Prospects state.
  const [growth, setGrowth] = useState<GrowthState>(null);
  const [attachGrowth, setAttachGrowth] = useState(false);
  const [briefEditor, setBriefEditor] = useState<string>("");
  const [showBriefJson, setShowBriefJson] = useState(false);

  // Hydrate from the server context once (T-sheet URL, docs, prior summaries, growth doc).
  const ctxQuery = useQuery<ContextPayload>({
    queryKey: ["/api/sales/followups", row.key, "context"],
    queryFn: () => customFetch(api(`/sales/followups/${encodeURIComponent(row.key)}/context`), { credentials: "include" }),
    staleTime: 10_000,
  });
  useEffect(() => {
    const c = ctxQuery.data;
    if (!c) return;
    setInterest(c.interest ?? null);
    if (c.tSheetUrl != null) setTSheetUrl(c.tSheetUrl);
    setExistingDocs((c.docs ?? []).map((d) => ({ ...d, keep: true })));
    setEnrichStatus(c.enrichmentStatus ?? null);
    setEnrichError(c.enrichmentError ?? null);
    if (c.growth) {
      setGrowth({ brief: c.growth.brief, docxUrl: c.growth.docxUrl, pdfUrl: c.growth.pdfUrl, needsValidation: c.growth.brief?.needsValidation });
      setBriefEditor(JSON.stringify(c.growth.brief, null, 2));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctxQuery.data]);

  // ISB autofill — for ISB Cleantech / IRA 2.0, pull the T-Sheet + transcript
  // Gdoc links from the "For ISB" master sheet and pre-fill any empty field.
  // Never clobbers a value the consultant already has (typed or hydrated).
  const isbEligible = isIsbProgram(row.program);
  const isbQuery = useQuery<{ eligible: boolean; tSheetUrl: string | null; transcriptGdocUrl: string | null }>({
    queryKey: ["/api/sales/followups", row.key, "isb-links"],
    queryFn: () => customFetch(api(`/sales/followups/${encodeURIComponent(row.key)}/isb-links`), { credentials: "include" }),
    enabled: isbEligible,
    staleTime: 60_000,
  });
  useEffect(() => {
    const d = isbQuery.data;
    if (!d) return;
    if (d.tSheetUrl) setTSheetUrl((prev) => (prev.trim() ? prev : d.tSheetUrl!));
    if (d.transcriptGdocUrl) setTranscriptGdocUrl((prev) => (prev.trim() ? prev : d.transcriptGdocUrl!));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isbQuery.data]);

  const picks: DbTemplate[] = templates.length
    ? templates
    : TEMPLATES.map((t, i) => ({ id: -(i + 1), name: t.name, subject: t.subject, body: t.body, sortOrder: i, pipelineStage: "outreach" }));
  // Templates for the selected pipeline stage (fall back to all if none tagged).
  const stagePicks = picks.filter((t) => (t.pipelineStage ?? "outreach") === stage);
  const effectivePicks = stagePicks.length ? stagePicks : picks;

  useEffect(() => {
    if (editorRef.current) {
      editorRef.current.innerHTML = row.draftBodyHtml ?? "<p>Analyse the T-sheet, pick a template, then Generate an AI draft — or paste your own.</p>";
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function applyTemplate(t: DbTemplate) {
    setTmplId(t.id);
    setConfirmSend(false);
    setSubject(resolveMerge(t.subject ?? "", row, prof));
    if (editorRef.current) editorRef.current.innerHTML = highlightPlaceholders(resolveMerge(t.body, row, prof));
  }

  function exec(cmd: string, value?: string) {
    editorRef.current?.focus();
    document.execCommand(cmd, false, value);
  }
  const readBody = () => sanitize(stripPlaceholderHighlight(editorRef.current?.innerHTML ?? ""));

  const chosenTemplate = tmplId != null ? picks.find((t) => t.id === tmplId) ?? null : null;

  // ── Triage ─────────────────────────────────────────────────────────────────
  const triage = useMutation({
    mutationFn: (v: string | null) => customFetch(api(`/sales/followups/${encodeURIComponent(row.key)}/interest`), {
      method: "PUT", credentials: "include", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ interest: v }),
    }),
    onSuccess: (_r, v) => { setInterest(v); qc.invalidateQueries({ queryKey: ["/api/sales/followups"] }); },
    onError: (e: any) => toast({ title: "Couldn't update triage", description: String(e?.message ?? e), variant: "destructive" }),
  });

  // ── Analyse (enrich) ─────────────────────────────────────────────────────
  const analyse = useMutation({
    mutationFn: () => {
      const fd = new FormData();
      fd.append("tSheetUrl", tSheetUrl.trim());
      // Fold the transcript Gdoc into the doc links (deduped against docs already
      // read) so Analyse reads it alongside any manually-added meeting docs.
      const keptUrls = new Set(existingDocs.filter((d) => d.keep && d.url).map((d) => d.url as string));
      const t = transcriptGdocUrl.trim();
      const docUrls = [...pendingLinks];
      if (t && !keptUrls.has(t) && !docUrls.includes(t)) docUrls.push(t);
      fd.append("docUrls", JSON.stringify(docUrls));
      fd.append("keepDocIds", JSON.stringify(existingDocs.filter((d) => d.keep).map((d) => d.id)));
      for (const f of pendingFiles) fd.append("files", f);
      return customFetch(api(`/sales/followups/${encodeURIComponent(row.key)}/enrich`), { method: "POST", credentials: "include", body: fd });
    },
    onSuccess: (r: any) => {
      setEnrichStatus(r.enrichmentStatus ?? null);
      setEnrichError(r.enrichmentError ?? null);
      setExistingDocs((r.docs ?? []).map((d: CtxDoc) => ({ ...d, keep: true })));
      setPendingLinks([]); setPendingFiles([]);
      qc.invalidateQueries({ queryKey: ["/api/sales/followups", row.key, "context"] });
      qc.invalidateQueries({ queryKey: ["/api/sales/followups"] });
      const msg = r.enrichmentStatus === "ok" ? "Analysed cleanly" : r.enrichmentStatus === "partial" ? "Analysed — some docs couldn't be read" : "Analysis had problems";
      toast({ title: msg, description: r.enrichmentError ?? undefined, variant: r.enrichmentStatus === "error" ? "destructive" : undefined });
    },
    onError: (e: any) => toast({ title: "Analyse failed", description: String(e?.message ?? e), variant: "destructive" }),
  });

  // ── Generate AI draft ──────────────────────────────────────────────────────
  const generate = useMutation({
    mutationFn: () => customFetch(api(`/sales/followups/${encodeURIComponent(row.key)}/generate`), {
      method: "POST", credentials: "include", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ templateBody: chosenTemplate?.body ?? "", templateIntent: chosenTemplate?.name ?? null }),
    }),
    onSuccess: (r: any) => {
      if (r.subject) setSubject(r.subject);
      if (editorRef.current) editorRef.current.innerHTML = highlightPlaceholders(resolveMerge(r.bodyHtml ?? "", row, prof));
      setConfirmSend(false);
      toast({ title: "Draft generated", description: "Review and edit before sending." });
    },
    onError: (e: any) => toast({ title: "Generation failed", description: String(e?.message ?? e), variant: "destructive" }),
  });

  // ── Growth Prospects document ────────────────────────────────────────────
  const growthGen = useMutation({
    mutationFn: (brief?: any) => customFetch(api(`/sales/followups/${encodeURIComponent(row.key)}/growth-prospects`), {
      method: "POST", credentials: "include", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(brief ? { brief } : {}),
    }),
    onSuccess: (r: any) => {
      setGrowth({ brief: r.brief, docxUrl: r.docxUrl, pdfUrl: r.pdfUrl, needsValidation: r.needsValidation });
      setBriefEditor(JSON.stringify(r.brief, null, 2));
      setAttachGrowth(true);
      qc.invalidateQueries({ queryKey: ["/api/sales/followups"] });
      toast({ title: "Growth Prospects ready", description: r.pdfError ? "DOCX ready (PDF skipped)." : "DOCX + PDF ready." });
    },
    onError: (e: any) => toast({ title: "Couldn't build the document", description: String(e?.message ?? e), variant: "destructive" }),
  });
  function reRenderBrief() {
    try { growthGen.mutate(JSON.parse(briefEditor)); }
    catch { toast({ title: "That JSON isn't valid", variant: "destructive" }); }
  }

  // ── Save / Send / reply-log ─────────────────────────────────────────────────
  const saveDraft = useMutation({
    mutationFn: () => customFetch(api(`/sales/followups/${encodeURIComponent(row.key)}/draft`), {
      method: "POST", credentials: "include", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ subject, bodyHtml: readBody(), templateKey: tmplId != null ? String(tmplId) : null }),
    }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["/api/sales/followups"] }); toast({ title: "Draft saved" }); },
    onError: (e: any) => toast({ title: "Couldn't save draft", description: String(e?.message ?? e), variant: "destructive" }),
  });

  const send = useMutation({
    mutationFn: () => customFetch(api(`/sales/followups/${encodeURIComponent(row.key)}/send`), {
      method: "POST", credentials: "include", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        subject, bodyHtml: readBody(), to, stage,
        templateKey: tmplId != null ? String(tmplId) : row.templateKey ?? null,
        attachGrowthProspects: attachGrowth && Boolean(growth),
      }),
    }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["/api/sales/followups"] }); qc.invalidateQueries({ queryKey: ["/api/sales/followups/pipeline"] }); toast({ title: `${STAGE_SEND_LABEL[stage] ?? "Follow-up"} sent`, description: `Emailed ${to}.` }); onClose(); },
    onError: (e: any) => toast({ title: "Send failed", description: String(e?.message ?? e), variant: "destructive" }),
  });

  // Log the client's response (breaks the pipeline chain).
  const saveResponse = useMutation({
    mutationFn: () => customFetch(api(`/sales/followups/${encodeURIComponent(row.key)}/response`), {
      method: "PUT", credentials: "include", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ state: respState || null, note: respNote.trim() || null }),
    }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["/api/sales/followups"] }); qc.invalidateQueries({ queryKey: ["/api/sales/followups/pipeline"] }); toast({ title: "Response saved" }); },
    onError: (e: any) => toast({ title: "Couldn't save response", description: String(e?.message ?? e), variant: "destructive" }),
  });

  function attemptSend() {
    const left = countPlaceholders(editorRef.current?.innerHTML ?? "");
    if (left > 0 && !confirmSend) {
      setConfirmSend(true);
      toast({ title: `${left} placeholder${left === 1 ? "" : "s"} still unfilled`, description: "Fill the highlighted brackets, or press Send again to send anyway.", variant: "destructive" });
      return;
    }
    send.mutate();
  }

  function addLink() {
    const v = linkInput.trim();
    if (!v) return;
    setPendingLinks((ls) => [...ls, v]);
    setLinkInput("");
  }
  function onPickFiles(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    if (files.length) setPendingFiles((fs) => [...fs, ...files]);
    e.target.value = "";
  }

  const pm = programMeta(row.program);
  const stg = STAGE_META[(row.stage ?? "").toLowerCase()];
  const docTotal = existingDocs.filter((d) => d.keep).length + pendingLinks.length + pendingFiles.length;

  const ToolBtn = ({ onClick, title, children }: { onClick: () => void; title: string; children: React.ReactNode }) => (
    <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={onClick} title={title}
      className="inline-flex h-8 w-8 items-center justify-center rounded hover:bg-accent">{children}</button>
  );
  const enrichChip = (() => {
    switch (enrichStatus) {
      case "ok": return { label: "Analysed", bg: "#E1F5EE", fg: "#0F6E56", icon: <CheckCircle2 size={12} /> };
      case "partial": return { label: "Partly analysed", bg: "#FBEEE1", fg: "#A85A1F", icon: <AlertTriangle size={12} /> };
      case "error": return { label: "Analysis error", bg: "#FBE9EF", fg: "#A32B58", icon: <AlertTriangle size={12} /> };
      case "running": return { label: "Analysing…", bg: "#E6F1FB", fg: "#0C447C", icon: <Loader2 size={12} className="animate-spin" /> };
      default: return null;
    }
  })();

  return (
    <div className="fixed inset-0 z-50 flex justify-end" role="dialog" aria-modal="true">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative flex h-full w-full max-w-2xl flex-col bg-background shadow-2xl">
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
          {/* Step 1 — Triage */}
          <div>
            <div className="mb-2 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              <span className="inline-flex h-4 w-4 items-center justify-center rounded-full bg-foreground/90 text-[10px] text-background">1</span> Is this worth pursuing?
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {(["interested", "maybe", "not_now"] as const).map((k) => {
                const m = INTEREST_META[k]; const active = interest === k;
                return (
                  <button key={k} disabled={triage.isPending} onClick={() => triage.mutate(active ? null : k)}
                    className="inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs font-medium transition-colors disabled:opacity-60"
                    style={active ? { background: m.bg, color: m.fg, borderColor: "transparent" } : { borderColor: "var(--border)", color: "var(--muted-foreground)" }}>
                    {k === "interested" ? <ThumbsUp size={13} /> : k === "maybe" ? <MinusCircle size={13} /> : <ThumbsDown size={13} />} {m.label}
                  </button>
                );
              })}
            </div>
            {!actionable && (
              <p className="mt-2 text-[12px] text-muted-foreground">
                Mark <strong>Shortlisted</strong> or <strong>Maybe</strong> to analyse, draft and send. <strong>Not shortlisted</strong> keeps them off the actionable list.
              </p>
            )}
          </div>

          {/* Step 2 — Analyse (T-sheet + docs) */}
          <div className={actionable ? "" : "pointer-events-none opacity-50"}>
            <div className="mb-2 flex items-center justify-between">
              <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                <span className="inline-flex h-4 w-4 items-center justify-center rounded-full bg-foreground/90 text-[10px] text-background">2</span> Context to draft from
              </div>
              {enrichChip && (
                <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium" style={{ background: enrichChip.bg, color: enrichChip.fg }}>
                  {enrichChip.icon} {enrichChip.label}
                </span>
              )}
            </div>
            <label className="block text-sm">
              <span className="mb-1 block text-[11px] text-muted-foreground">
                T-sheet URL (Google Sheet)
                {isbEligible && isbQuery.data?.tSheetUrl && <span className="ml-1 text-[10px] text-muted-foreground/80">· auto-filled from For ISB</span>}
              </span>
              <input value={tSheetUrl} onChange={(e) => setTSheetUrl(e.target.value)} placeholder="https://docs.google.com/spreadsheets/…"
                className="w-full rounded-md border border-border bg-card px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring/40" />
            </label>

            {isbEligible && (
              <label className="mt-3 block text-sm">
                <span className="mb-1 block text-[11px] text-muted-foreground">
                  Transcript (Google Doc)
                  {isbQuery.data?.transcriptGdocUrl && <span className="ml-1 text-[10px] text-muted-foreground/80">· auto-filled from For ISB</span>}
                </span>
                <input value={transcriptGdocUrl} onChange={(e) => setTranscriptGdocUrl(e.target.value)} placeholder="https://docs.google.com/document/…"
                  className="w-full rounded-md border border-border bg-card px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring/40" />
              </label>
            )}

            {/* Doc attach — optional, add as many (or none) */}
            <div className="mt-3">
              <div className="mb-1 flex items-center justify-between">
                <span className="text-[11px] text-muted-foreground">Meeting docs (optional — Google Doc links and/or uploads)</span>
                <span className="text-[11px] text-muted-foreground">{docTotal} attached</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="relative flex-1">
                  <Link2 size={13} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
                  <input value={linkInput} onChange={(e) => setLinkInput(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addLink(); } }}
                    placeholder="Paste a Google Doc link"
                    className="w-full rounded-md border border-border bg-card py-1.5 pl-8 pr-3 text-sm outline-none focus:ring-2 focus:ring-ring/40" />
                </div>
                <button onClick={addLink} className="inline-flex items-center gap-1 rounded-md border border-border px-2.5 py-1.5 text-xs font-medium hover:bg-accent"><Plus size={13} /> Add link</button>
                <button onClick={() => fileRef.current?.click()} className="inline-flex items-center gap-1 rounded-md border border-border px-2.5 py-1.5 text-xs font-medium hover:bg-accent"><Paperclip size={13} /> Upload</button>
                <input ref={fileRef} type="file" multiple accept=".pdf,.docx,.txt,.md,.vtt,.srt" className="hidden" onChange={onPickFiles} />
              </div>

              {/* Chips */}
              {(existingDocs.length > 0 || pendingLinks.length > 0 || pendingFiles.length > 0) && (
                <div className="mt-2 space-y-1.5">
                  {existingDocs.map((d) => (
                    <div key={`e${d.id}`} className="flex items-center gap-2 rounded-md border border-border bg-card px-2.5 py-1.5 text-xs" style={{ opacity: d.keep ? 1 : 0.4 }}>
                      {d.sourceType === "gdoc" ? <Link2 size={13} /> : <FileText size={13} />}
                      <span className="min-w-0 flex-1 truncate">{d.title || (d.sourceType === "gdoc" ? "Google Doc" : "File")}</span>
                      {d.status === "error"
                        ? <span className="inline-flex items-center gap-1 text-[11px]" style={{ color: "#A32B58" }} title={d.error ?? ""}><AlertTriangle size={11} /> couldn’t open</span>
                        : <span className="inline-flex items-center gap-1 text-[11px]" style={{ color: "#0F6E56" }}><CheckCircle2 size={11} /> read</span>}
                      <button onClick={() => setExistingDocs((ds) => ds.map((x) => x.id === d.id ? { ...x, keep: !x.keep } : x))} className="rounded p-0.5 hover:bg-accent" title={d.keep ? "Remove on next analyse" : "Keep"}>
                        {d.keep ? <Trash2 size={13} /> : <Undo2 size={13} />}
                      </button>
                    </div>
                  ))}
                  {pendingLinks.map((l, i) => (
                    <div key={`l${i}`} className="flex items-center gap-2 rounded-md border border-dashed border-border bg-card px-2.5 py-1.5 text-xs">
                      <Link2 size={13} /><span className="min-w-0 flex-1 truncate">{l}</span>
                      <span className="text-[11px] text-muted-foreground">new · analyse to read</span>
                      <button onClick={() => setPendingLinks((ls) => ls.filter((_, j) => j !== i))} className="rounded p-0.5 hover:bg-accent"><X size={13} /></button>
                    </div>
                  ))}
                  {pendingFiles.map((f, i) => (
                    <div key={`f${i}`} className="flex items-center gap-2 rounded-md border border-dashed border-border bg-card px-2.5 py-1.5 text-xs">
                      <FileText size={13} /><span className="min-w-0 flex-1 truncate">{f.name}</span>
                      <span className="text-[11px] text-muted-foreground">new · analyse to read</span>
                      <button onClick={() => setPendingFiles((fs) => fs.filter((_, j) => j !== i))} className="rounded p-0.5 hover:bg-accent"><X size={13} /></button>
                    </div>
                  ))}
                </div>
              )}
              {enrichError && <p className="mt-1.5 text-[11px]" style={{ color: "#A85A1F" }}>{enrichError}</p>}

              <button onClick={() => analyse.mutate()} disabled={!actionable || analyse.isPending || (!tSheetUrl.trim() && !transcriptGdocUrl.trim() && docTotal === 0)}
                className="mt-2 inline-flex items-center gap-2 rounded-md border border-border px-3 py-2 text-sm font-medium hover:bg-accent disabled:opacity-60">
                {analyse.isPending ? <Loader2 size={15} className="animate-spin" /> : <Sparkles size={15} />}
                {enrichStatus ? "Re-analyse" : "Analyse"}
              </button>
            </div>
          </div>

          {/* Step 3 — Draft */}
          <div className={actionable ? "" : "pointer-events-none opacity-50"}>
            <div className="mb-2 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              <span className="inline-flex h-4 w-4 items-center justify-center rounded-full bg-foreground/90 text-[10px] text-background">3</span> Draft the email
            </div>
            {/* Pipeline stage — which step of the chain this send is. */}
            <div className="mb-2">
              <div className="mb-1 text-[11px] text-muted-foreground">Pipeline stage (7 days apart, sent manually)</div>
              <div className="inline-flex overflow-hidden rounded-md border border-border">
                {STAGE_OPTIONS.map((s) => {
                  const active = stage === s.key;
                  return (
                    <button key={s.key} onClick={() => { setStage(s.key); setTmplId(null); }}
                      className="px-3 py-1.5 text-xs font-medium transition-colors"
                      style={active ? { background: "hsl(222 47% 20%)", color: "white" } : { color: "var(--muted-foreground)" }}>
                      {s.label}
                    </button>
                  );
                })}
              </div>
            </div>
            <div className="grid gap-2 sm:grid-cols-3">
              {effectivePicks.map((t) => {
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
            <button onClick={() => generate.mutate()} disabled={!actionable || generate.isPending || !chosenTemplate}
              className="mt-2 inline-flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium text-white disabled:opacity-60" style={{ background: GOLD }}>
              {generate.isPending ? <Loader2 size={15} className="animate-spin" /> : <Wand2 size={15} />}
              {generate.isPending ? "Generating…" : "Generate AI draft"}
            </button>
            {!chosenTemplate && <span className="ml-2 text-[11px] text-muted-foreground">Pick a template first.</span>}
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
              <div ref={editorRef} contentEditable suppressContentEditableWarning data-testid="followup-editor"
                className="prose prose-sm min-h-[200px] max-w-none px-3 py-3 font-sans text-[15px] leading-relaxed outline-none [&_*]:font-sans [&_ul]:list-disc [&_ol]:list-decimal [&_ul]:pl-5 [&_ol]:pl-5" />
            </div>
            <p className="mt-1.5 text-[11px] text-muted-foreground">Highlighted [brackets] still need filling. Bold, italics, highlight and lists all carry into the email.</p>
          </div>

          {/* Step 4 — Growth Prospects document */}
          <div className={actionable ? "" : "pointer-events-none opacity-50"}>
            <div className="mb-2 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              <span className="inline-flex h-4 w-4 items-center justify-center rounded-full bg-foreground/90 text-[10px] text-background">4</span> Growth Prospects document (optional attachment)
            </div>
            {!growth ? (
              <button onClick={() => growthGen.mutate(undefined)} disabled={!actionable || growthGen.isPending}
                className="inline-flex items-center gap-2 rounded-md border border-border px-3 py-2 text-sm font-medium hover:bg-accent disabled:opacity-60">
                {growthGen.isPending ? <Loader2 size={15} className="animate-spin" /> : <FileType2 size={15} />}
                Generate Growth Prospects
              </button>
            ) : (
              <div className="rounded-lg border border-border bg-card p-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="font-medium">{growth.brief?.headline || "Growth Prospects"}</div>
                    <div className="mt-0.5 text-[12px] text-muted-foreground">{growth.brief?.oneLiner}</div>
                  </div>
                  <button onClick={() => growthGen.mutate(undefined)} disabled={growthGen.isPending} title="Regenerate from AI"
                    className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs hover:bg-accent disabled:opacity-60">
                    {growthGen.isPending ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />} Regenerate
                  </button>
                </div>
                {Array.isArray(growth.brief?.statTiles) && growth.brief.statTiles.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-2">
                    {growth.brief.statTiles.map((t: any, i: number) => (
                      <span key={i} className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium" style={{ background: "#EEF2F7", color: "#17335C" }}>
                        <strong>{t.value}</strong> {t.label}
                      </span>
                    ))}
                  </div>
                )}
                {Array.isArray(growth.needsValidation) && growth.needsValidation.length > 0 && (
                  <div className="mt-2 rounded-md border border-amber-300 bg-amber-50 px-2.5 py-1.5 text-[11px] text-amber-900">
                    <strong>Confirm before sending:</strong> {growth.needsValidation.join("; ")}
                  </div>
                )}
                <div className="mt-2 flex flex-wrap items-center gap-3 text-xs">
                  {growth.docxUrl && <a href={growth.docxUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 underline-offset-2 hover:underline"><Download size={13} /> DOCX</a>}
                  {growth.pdfUrl
                    ? <a href={growth.pdfUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 underline-offset-2 hover:underline"><Download size={13} /> PDF</a>
                    : <span className="text-muted-foreground">PDF not produced</span>}
                  <label className="ml-auto inline-flex items-center gap-1.5">
                    <input type="checkbox" checked={attachGrowth} onChange={(e) => setAttachGrowth(e.target.checked)} /> Attach to email
                  </label>
                </div>
                <button onClick={() => setShowBriefJson((s) => !s)} className="mt-2 text-[11px] text-muted-foreground underline-offset-2 hover:underline">
                  {showBriefJson ? "Hide" : "Edit fields (advanced) — re-render without AI"}
                </button>
                {showBriefJson && (
                  <div className="mt-2">
                    <textarea value={briefEditor} onChange={(e) => setBriefEditor(e.target.value)} spellCheck={false}
                      className="h-40 w-full rounded-md border border-border bg-background p-2 font-mono text-[11px] outline-none focus:ring-2 focus:ring-ring/40" />
                    <button onClick={reRenderBrief} disabled={growthGen.isPending}
                      className="mt-1 inline-flex items-center gap-1 rounded-md border border-border px-2.5 py-1.5 text-xs font-medium hover:bg-accent disabled:opacity-60">
                      {growthGen.isPending ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />} Re-render from edits
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="border-t border-border px-6 py-4">
          {/* Client response — breaks the pipeline chain. Consultant-set. */}
          <div className="mb-3">
            <div className="mb-1.5 flex flex-wrap items-center gap-2">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Client response</span>
              {RESPONSE_OPTIONS.map((k) => {
                const m = RESPONSE_META[k]; const active = respState === k;
                return (
                  <button key={k} onClick={() => setRespState(active ? "" : k)}
                    className="rounded-full border px-2 py-0.5 text-[11px] font-medium transition-colors"
                    style={active ? { background: m.bg, color: m.fg, borderColor: "transparent" } : { borderColor: "var(--border)", color: "var(--muted-foreground)" }}>
                    {m.label}
                  </button>
                );
              })}
            </div>
            <div className="flex items-center gap-2">
              <input value={respNote} onChange={(e) => setRespNote(e.target.value)} placeholder="Optional remark (e.g. asked to revisit in Q3)"
                className="flex-1 rounded-md border border-border bg-card px-2 py-1 text-xs outline-none focus:ring-2 focus:ring-ring/40" />
              <button onClick={() => saveResponse.mutate()} disabled={saveResponse.isPending}
                className="inline-flex items-center gap-1 whitespace-nowrap rounded-md border border-border px-2.5 py-1 text-xs font-medium hover:bg-accent disabled:opacity-60">
                {saveResponse.isPending ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />} Save response
              </button>
            </div>
          </div>
          <div className="flex items-center justify-end gap-2">
            <button onClick={() => saveDraft.mutate()} disabled={saveDraft.isPending}
              className="inline-flex items-center gap-2 rounded-md border border-border px-3.5 py-2 text-sm font-medium hover:bg-accent disabled:opacity-60" data-testid="button-save-draft">
              {saveDraft.isPending ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />} Save draft
            </button>
            <button onClick={attemptSend} disabled={!actionable || send.isPending || !to}
              className="inline-flex items-center gap-2 rounded-md px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
              style={{ background: confirmSend ? "hsl(0 65% 42%)" : "hsl(222 47% 20%)" }} data-testid="button-send-followup">
              {send.isPending ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />}
              {confirmSend ? "Send anyway" : attachGrowth && growth ? "Send with document" : "Send follow-up"}
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
          className="prose prose-sm max-w-none px-3 py-3 font-sans text-[15px] leading-relaxed outline-none [&_*]:font-sans [&_ul]:list-disc [&_ol]:list-decimal [&_ul]:pl-5 [&_ol]:pl-5"
          style={{ minHeight }} />
      </div>
    );
  },
);

// ─── Templates manager (Templates tab) ──────────────────────────────────────
const STAGE_TAG_LABEL: Record<string, string> = { outreach: "1st outreach", nudge: "Nudge", toffee: "Reminder (Toffee)" };
function TemplatesPanel({ profile, canEdit }: { profile?: Profile; canEdit: boolean }) {
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
      <div className="mb-3 flex items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          Shared library{canEdit ? " — edits are live for the whole team, no deploy needed" : " (read-only — Ops/Admin edit the shared copy)"}. Use <code className="rounded bg-muted px-1">[Square Bracket]</code> placeholders; the app fills [First Name], [Company], [Name], [Title], [Phone], [Calendar link] and highlights the rest.
        </p>
        {canEdit && (
          <button onClick={() => setEditing("new")} className="inline-flex shrink-0 items-center gap-1.5 rounded-md px-3 py-2 text-sm font-medium text-white" style={{ background: "hsl(222 47% 20%)" }}>
            <Plus size={15} /> New template
          </button>
        )}
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
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium">{t.name}</span>
                  {t.pipelineStage && <span className="rounded px-1.5 py-0.5 text-[10px] font-medium" style={{ background: "#EEF2F7", color: "#17335C" }}>{STAGE_TAG_LABEL[t.pipelineStage] ?? t.pipelineStage}</span>}
                </div>
                <div className="truncate text-xs text-muted-foreground">{t.subject || "—"}</div>
              </div>
              {canEdit && (
                <div className="flex shrink-0 items-center gap-1">
                  <button onClick={() => setEditing(t)} className="rounded-md border border-border px-2.5 py-1.5 text-xs hover:bg-accent">Edit</button>
                  <button onClick={() => { if (confirm(`Delete “${t.name}”?`)) del.mutate(t.id); }} className="rounded-md border border-border px-2.5 py-1.5 text-xs text-destructive hover:bg-accent">Delete</button>
                </div>
              )}
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
  const [pipelineStage, setPipelineStage] = useState<string>(template?.pipelineStage ?? "outreach");

  const save = useMutation({
    mutationFn: () => {
      const payload = { name, subject, pipelineStage, body: bodyRef.current?.getHtml() ?? "" };
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
          <div className="grid grid-cols-2 gap-3">
            <label className="block text-sm">
              <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Subject</span>
              <input value={subject} onChange={(e) => setSubject(e.target.value)} className="w-full rounded-md border border-border bg-card px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring/40" />
            </label>
            <label className="block text-sm">
              <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Pipeline stage</span>
              <select value={pipelineStage} onChange={(e) => setPipelineStage(e.target.value)} className="w-full rounded-md border border-border bg-card px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring/40">
                <option value="outreach">1st outreach</option>
                <option value="nudge">Nudge</option>
                <option value="toffee">Reminder (Toffee)</option>
              </select>
            </label>
          </div>
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
  const [sprintHostNames, setSprintHostNames] = useState(profile?.sprintHostNames ?? "");
  useEffect(() => {
    setTitle(profile?.title ?? ""); setPhone(profile?.phone ?? ""); setCalendarLink(profile?.calendarLink ?? "");
    setSprintHostNames(profile?.sprintHostNames ?? "");
  }, [profile?.title, profile?.phone, profile?.calendarLink, profile?.sprintHostNames]);

  const save = useMutation({
    mutationFn: () => customFetch(api("/me/followup-profile"), {
      method: "PUT", credentials: "include", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title, phone, calendarLink, sprintHostNames }),
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
          <label className="text-sm sm:col-span-3"><span className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Sprint host name(s)</span>
            <input value={sprintHostNames} onChange={(e) => setSprintHostNames(e.target.value)} placeholder="How your name appears in the sheet's Host / Co-Host column (comma-separated for aliases)" className="w-full rounded-md border border-border bg-card px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring/40" />
            <span className="mt-1 block text-[11px] text-muted-foreground">Used to show you only the companies you hosted or co-hosted. Leave blank to match your account name.</span></label>
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
  const [page, setPage] = useState(1);

  // "Reverted" = the client replied to a follow-up (interested or not-now).
  const reverted = useMemo(() => items.filter(isReplied).length, [items]);
  const sent = useMemo(() => items.filter(isSent).length, [items]);
  const revertRate = sent ? Math.round((reverted / sent) * 100) : 0;

  const rows = useMemo(() => {
    const term = q.trim().toLowerCase();
    return items
      .filter((f) => !term || `${f.startup} ${f.contact ?? ""} ${f.email ?? ""} ${f.program ?? ""}`.toLowerCase().includes(term))
      .sort((a, b) => {
        // Clients who reverted float to the top, then most recent sprint first.
        const ra = isReplied(a) ? 0 : 1, rb = isReplied(b) ? 0 : 1;
        if (ra !== rb) return ra - rb;
        const ta = a.lastSprintDate ? new Date(a.lastSprintDate).getTime() : -Infinity;
        const tb = b.lastSprintDate ? new Date(b.lastSprintDate).getTime() : -Infinity;
        return tb - ta;
      });
  }, [items, q]);

  useEffect(() => { setPage(1); }, [q]);
  const totalPages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const pageRows = useMemo(() => rows.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE), [rows, safePage]);

  if (loading) return <div className="flex items-center gap-2 p-10 text-sm text-muted-foreground"><Loader2 size={16} className="animate-spin" /> Loading clients…</div>;

  return (
    <div>
      {/* Reverted-back insight header */}
      <div className="grid gap-3 border-b border-border px-5 py-4 sm:grid-cols-3">
        <div className="rounded-lg border border-card-border bg-card px-4 py-3">
          <div className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Total clients</div>
          <div className="mt-1 font-serif text-3xl leading-none">{items.length}</div>
          <div className="mt-1 text-[11px] text-muted-foreground">from Live Sprint Tracking</div>
        </div>
        <div className="rounded-lg border px-4 py-3" style={{ borderColor: "var(--gold)", background: "hsl(36 70% 97%)" }}>
          <div className="text-[11px] font-medium uppercase tracking-wider" style={{ color: "#8A5A00" }}>Reverted for follow-up</div>
          <div className="mt-1 flex items-baseline gap-2">
            <div className="font-serif text-3xl leading-none" style={{ color: GOLD }}>{reverted}</div>
            <span className="text-sm text-muted-foreground">/ {sent} contacted</span>
          </div>
          <div className="mt-1 text-[11px] text-muted-foreground">{revertRate}% of clients we followed up with replied</div>
        </div>
        <div className="rounded-lg border border-card-border bg-card px-4 py-3">
          <div className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Follow-ups sent</div>
          <div className="mt-1 font-serif text-3xl leading-none">{sent}</div>
          <div className="mt-1 text-[11px] text-muted-foreground">across all clients</div>
        </div>
      </div>

      <div className="flex items-center justify-between gap-2 border-b border-border px-5 py-3">
        <div className="text-sm text-muted-foreground">{rows.length} client{rows.length === 1 ? "" : "s"}{q ? " matched" : ""}</div>
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
              <th className="px-3 py-2.5 font-medium">Reverted</th>
              <th className="px-3 py-2.5 font-medium">Email</th>
              <th className="px-3 py-2.5 font-medium">Program</th>
              <th className="px-3 py-2.5 font-medium">Stage</th>
              <th className="px-3 py-2.5 font-medium">Host</th>
              <th className="px-3 py-2.5 font-medium">Sessions</th>
              <th className="px-3 py-2.5 font-medium">Last sprint</th>
            </tr>
          </thead>
          <tbody>
            {pageRows.map((f) => {
              const pm = programMeta(f.program);
              const stg = STAGE_META[(f.stage ?? "").toLowerCase()];
              const replied = isReplied(f);
              return (
                <tr key={f.key} className="border-b border-border/60 hover:bg-accent/40">
                  <td className="px-5 py-3"><div className="font-medium">{f.startup}</div><div className="text-xs text-muted-foreground">{f.contact ?? "—"}</div></td>
                  <td className="px-3 py-3">
                    {replied
                      ? <span className="inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-medium" style={{ background: "#E1F5EE", color: "#0F6E56" }}><CheckCircle2 size={12} /> Reverted</span>
                      : isSent(f)
                        ? <span className="whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-medium" style={{ background: "#E6F1FB", color: "#0C447C" }}>Awaiting</span>
                        : <span className="text-muted-foreground">—</span>}
                  </td>
                  <td className="px-3 py-3 text-muted-foreground">{f.email ?? "—"}</td>
                  <td className="px-3 py-3">{f.program ? <span className="rounded px-2 py-0.5 text-[11px] font-medium" style={{ background: pm.bg, color: pm.fg }}>{f.program}</span> : "—"}</td>
                  <td className="px-3 py-3">{f.stage ? <span className="rounded px-2 py-0.5 text-[11px] font-medium" style={stg ? { background: stg.bg, color: stg.fg } : { background: "#F1EFE8", color: "#5F5E5A" }}>{f.stage}</span> : "—"}</td>
                  <td className="px-3 py-3">{f.host ?? "—"}{f.cohost ? <span className="text-xs text-muted-foreground"> +{f.cohost}</span> : ""}</td>
                  <td className="px-3 py-3 tabular-nums">{f.sessions ?? "—"}</td>
                  <td className="px-3 py-3">{fmtDate(f.lastSprintDate)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Pager */}
      {rows.length > PAGE_SIZE && (
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-5 py-3 text-sm">
          <span className="text-muted-foreground">
            Showing <span className="tabular-nums">{(safePage - 1) * PAGE_SIZE + 1}</span>–
            <span className="tabular-nums">{Math.min(safePage * PAGE_SIZE, rows.length)}</span> of{" "}
            <span className="tabular-nums">{rows.length}</span>
          </span>
          <div className="flex items-center gap-1.5">
            <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={safePage <= 1}
              className="inline-flex items-center gap-1 rounded-md border border-border px-2.5 py-1.5 text-xs font-medium hover:bg-accent disabled:opacity-40">
              <ChevronLeft size={14} /> Prev
            </button>
            <span className="px-1 tabular-nums text-muted-foreground">Page {safePage} / {totalPages}</span>
            <button onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={safePage >= totalPages}
              className="inline-flex items-center gap-1 rounded-md border border-border px-2.5 py-1.5 text-xs font-medium hover:bg-accent disabled:opacity-40">
              Next <ChevronRight size={14} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Pipeline board (Pipeline tab) ──────────────────────────────────────────
// Tracks the emails THIS consultant sent (their own Gmail), stage by stage:
// 1st outreach → Nudge → Reminder (Toffee) → Dead lead, plus a Replied lane.
// A client response at any stage moves the card to Replied. Cohort filter on top.
type PipelineItem = {
  key: string; startup: string; contact: string | null; email: string | null; program: string | null;
  stage: string; stageLabel: string; dueNext: boolean;
  sentAt: string | null; nudgeSentAt: string | null; toffeeSentAt: string | null;
  responseState: string | null; responseNote: string | null;
  lastActivityAt: string | null; daysSinceLast: number | null;
};
function PipelinePanel({ onOpen }: { onOpen: (key: string) => void }) {
  const [cohort, setCohort] = useState<string | null>(null);
  const cohortParam = cohort ? `?cohort=${encodeURIComponent(cohort)}` : "";
  const { data, isLoading, isError, error } = useQuery<{ items: PipelineItem[]; cohorts: string[] }>({
    queryKey: ["/api/sales/followups/pipeline", cohort],
    queryFn: () => customFetch(api(`/sales/followups/pipeline${cohortParam}`), { credentials: "include" }),
    staleTime: 20_000,
  });
  const items = data?.items ?? [];
  const cohorts = data?.cohorts ?? [];

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-3">
        <div className="text-sm text-muted-foreground">
          {items.length} compan{items.length === 1 ? "y" : "ies"} you emailed{cohort ? ` · ${cohort}` : ""}
        </div>
        {cohorts.length > 0 && (
          <select value={cohort ?? ""} onChange={(e) => setCohort(e.target.value || null)}
            className="rounded-full border border-border bg-background px-3 py-1 text-xs font-medium text-muted-foreground outline-none focus:ring-2 focus:ring-ring/40"
            title="Filter by cohort / program">
            <option value="">All cohorts</option>
            {cohorts.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        )}
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center gap-2 py-16 text-sm text-muted-foreground"><Loader2 size={16} className="animate-spin" /> Loading pipeline…</div>
      ) : isError ? (
        <div className="px-5 py-12 text-center text-sm text-destructive">{String((error as any)?.message ?? "Failed to load.")}</div>
      ) : items.length === 0 ? (
        <div className="px-5 py-14 text-center text-sm text-muted-foreground">No sent follow-ups yet{cohort ? ` in ${cohort}` : ""}. Send from the Follow-ups tab and they’ll appear here.</div>
      ) : (
        <div className="overflow-x-auto p-5">
          <div className="flex min-w-[1100px] gap-3">
            {PIPELINE_LANES.map((lane) => {
              const cards = items.filter((f) => lane.match(f.stage));
              return (
                <div key={lane.key} className="flex-1">
                  <div className="mb-2 flex items-center justify-between px-1">
                    <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{lane.label}</span>
                    <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] tabular-nums text-muted-foreground">{cards.length}</span>
                  </div>
                  <div className="space-y-2">
                    {cards.map((f) => {
                      const pm = programMeta(f.program);
                      const resp = f.responseState ? RESPONSE_META[f.responseState] : null;
                      return (
                        <button key={f.key} onClick={() => onOpen(f.key)} className="block w-full rounded-lg border border-border bg-card p-3 text-left transition-colors hover:bg-accent/40">
                          <div className="truncate text-sm font-medium">{f.startup}</div>
                          <div className="truncate text-xs text-muted-foreground">{f.contact ?? "—"}</div>
                          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                            {f.program && <span className="rounded px-1.5 py-0.5 text-[10px] font-medium" style={{ background: pm.bg, color: pm.fg }}>{f.program}</span>}
                            {resp && <span className="rounded px-1.5 py-0.5 text-[10px] font-medium" style={{ background: resp.bg, color: resp.fg }}>{resp.label}</span>}
                            {f.dueNext && !resp && <span className="inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 text-[10px] font-medium" style={{ background: "#FBEEE1", color: "#A85A1F" }}><Clock size={9} /> next due</span>}
                          </div>
                          {f.responseNote && <div className="mt-1 truncate text-[11px] text-muted-foreground" title={f.responseNote}>“{f.responseNote}”</div>}
                          {f.daysSinceLast != null && <div className="mt-1 text-[10px] text-muted-foreground">{f.daysSinceLast}d since last</div>}
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
      )}
      <div className="border-t border-border px-5 py-3 text-[11px] text-muted-foreground">
        Only companies you emailed from your own account. Each stage is 7 days apart; a client reply breaks the chain into <strong>Replied</strong>.
      </div>
    </div>
  );
}

// ─── Operations tracking (Ops tab · ops/admin only) ─────────────────────────
// Per-consultant follow-up progress: has each consultant reached out to every
// company they hosted or co-hosted (that they're willing to contact)?
type OpsConsultant = {
  host: string;
  matchedUser: { id: number; name: string; email: string } | null;
  cohorts: string[];
  companies: number; assigned: number; interestedOrMaybe: number;
  reached: number; pending: number; due: number;
  sent: number; nudgesDue: number; replied: number;
  repliedInterested: number; repliedNotNow: number;
  drafted: number; notNow: number; skipped: number;
  lastSentAt: string | null;
  replyRate: number; behind: boolean; completionPct: number;
};
function OpsPanel({ cohort, cohorts, onCohort }: { cohort: string | null; cohorts: string[]; onCohort: (c: string | null) => void }) {
  const cohortParam = cohort ? `?cohort=${encodeURIComponent(cohort)}` : "";
  const { data, isLoading, isError, error } = useQuery<{ consultants: OpsConsultant[]; cohorts: string[] }>({
    queryKey: ["/api/sales/followups/ops-progress", cohort],
    queryFn: () => customFetch(api(`/sales/followups/ops-progress${cohortParam}`), { credentials: "include" }),
    staleTime: 30_000,
  });
  const rawList = data?.consultants ?? [];
  const opts = data?.cohorts?.length ? data.cohorts : cohorts;
  const [pick, setPick] = useState<string>("");
  const names = useMemo(() => rawList.map((c) => c.matchedUser?.name ?? c.host), [rawList]);
  const list = pick ? rawList.filter((c) => (c.matchedUser?.name ?? c.host) === pick) : rawList;
  const pendingConsultants = list.filter((c) => c.pending > 0).length;
  const totalPending = list.reduce((n, c) => n + c.pending, 0);

  return (
    <div>
      {/* Header + cohort filter */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-3">
        <div className="flex items-center gap-2 text-sm">
          <BarChart3 size={16} className="text-muted-foreground" />
          <span className="font-medium">Consultant follow-up progress</span>
          <span className="text-muted-foreground">
            · {list.length} consultant{list.length === 1 ? "" : "s"} · {pendingConsultants} with {totalPending} pending
          </span>
        </div>
        <div className="flex items-center gap-2">
          {names.length > 0 && (
            <select value={pick} onChange={(e) => setPick(e.target.value)}
              className="rounded-full border border-border bg-background px-3 py-1 text-xs font-medium text-muted-foreground outline-none focus:ring-2 focus:ring-ring/40"
              title="Filter by consultant">
              <option value="">All consultants</option>
              {names.map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
          )}
          {opts.length > 0 && (
            <select value={cohort ?? ""} onChange={(e) => onCohort(e.target.value || null)}
              className="rounded-full border border-border bg-background px-3 py-1 text-xs font-medium text-muted-foreground outline-none focus:ring-2 focus:ring-ring/40">
              <option value="">All cohorts</option>
              {opts.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          )}
        </div>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center gap-2 py-16 text-sm text-muted-foreground"><Loader2 size={16} className="animate-spin" /> Loading progress…</div>
      ) : isError ? (
        <div className="px-5 py-12 text-center text-sm text-destructive">{String((error as any)?.message ?? "Failed to load.")}</div>
      ) : list.length === 0 ? (
        <div className="px-5 py-14 text-center text-sm text-muted-foreground">No consultants with companies{cohort ? ` in ${cohort}` : ""} yet.</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-[11px] uppercase tracking-wider text-muted-foreground">
                <th className="px-5 py-2.5 font-medium">Consultant</th>
                <th className="px-3 py-2.5 font-medium">Interested / Maybe</th>
                <th className="px-3 py-2.5 font-medium">Sent</th>
                <th className="px-3 py-2.5 font-medium">Pending</th>
                <th className="px-3 py-2.5 font-medium">Nudges due</th>
                <th className="px-3 py-2.5 font-medium">Replied</th>
                <th className="px-3 py-2.5 font-medium">Reply outcomes</th>
                <th className="px-3 py-2.5 font-medium">Reply rate</th>
                <th className="px-3 py-2.5 font-medium">Last sent</th>
              </tr>
            </thead>
            <tbody>
              {list.map((c) => {
                const done = c.pending === 0 && c.interestedOrMaybe > 0;
                return (
                  <tr key={c.host} className="border-b border-border/60">
                    <td className="px-5 py-3">
                      <div className="font-medium">{c.matchedUser?.name ?? c.host}</div>
                      <div className="text-xs text-muted-foreground">
                        {c.matchedUser?.email ?? (c.matchedUser ? "" : "unmatched — no user alias")}
                        {c.cohorts.length ? ` · ${c.cohorts.join(", ")}` : ""}
                      </div>
                    </td>
                    <td className="px-3 py-3 tabular-nums">{c.interestedOrMaybe}<span className="text-xs text-muted-foreground"> / {c.assigned}</span></td>
                    <td className="px-3 py-3 tabular-nums">{c.sent}</td>
                    <td className="px-3 py-3">
                      {c.pending > 0
                        ? <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium" style={{ background: "hsl(36 70% 92%)", color: "#8A5A00" }}>{c.pending} to send</span>
                        : c.interestedOrMaybe > 0
                          ? <span className="inline-flex items-center gap-1 text-[12px]" style={{ color: "var(--success)" }}><CheckCircle2 size={13} /> Done</span>
                          : <span className="text-muted-foreground">—</span>}
                    </td>
                    <td className="px-3 py-3">
                      {c.nudgesDue > 0
                        ? <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium" style={{ background: "#FBEEE1", color: "#A85A1F" }}><Clock size={11} /> {c.nudgesDue}</span>
                        : <span className="text-muted-foreground">0</span>}
                    </td>
                    <td className="px-3 py-3 tabular-nums">{c.replied}</td>
                    <td className="px-3 py-3 text-[11px]">
                      <span style={{ color: "#0F6E56" }}>{c.repliedInterested} interested</span>
                      <span className="text-muted-foreground"> · {c.repliedNotNow} not now</span>
                    </td>
                    <td className="px-3 py-3">
                      <div className="flex items-center gap-2">
                        <span className="tabular-nums text-sm font-medium" style={{ color: c.behind ? "#A32B58" : undefined }}>{c.replyRate}%</span>
                        {c.behind && c.sent > 0 && <span className="rounded-full px-2 py-0.5 text-[10px] font-medium" style={{ background: "#FBE9EF", color: "#A32B58" }}>behind</span>}
                        {done && <CheckCircle2 size={13} style={{ color: "var(--success)" }} />}
                      </div>
                    </td>
                    <td className="px-3 py-3 text-muted-foreground">{c.lastSentAt ? fmtDate(c.lastSentAt) : "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <div className="border-t border-border px-5 py-3 text-[11px] text-muted-foreground">
        Only companies triaged <strong>Interested</strong> or <strong>Maybe</strong> count as “should follow up”. Reply rate = replied ÷ sent; “behind” flags a rate under 30%.
      </div>
    </div>
  );
}
