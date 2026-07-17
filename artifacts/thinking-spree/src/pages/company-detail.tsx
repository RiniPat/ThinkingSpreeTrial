import { useState } from "react";
import { useParams, useLocation, Link } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react";
import { Layout } from "@/components/Layout";
import { Skeleton } from "@/components/ui/skeleton";
import { EmailComposer } from "@/components/EmailComposer";
import { CleanSheetDialog, CleanedReportBody, type Report as CleanReport } from "@/components/CleanSheetDialog";
import { EditCompanyDialog } from "@/components/EditCompanyDialog";
import { useToast } from "@/hooks/use-toast";
import {
  ArrowLeft, Building2, User, Mail, ExternalLink, Sparkles, Send, CheckCircle2,
  Clock, Circle, AlertCircle, Upload, Save, Loader2, Calendar, FileText, ChevronRight,
  Pencil, RefreshCw, Trash2, X,
  Target, TrendingUp, DollarSign, Lightbulb, Users2, Wallet, Eye, Wand2,
} from "lucide-react";
import { format, parseISO } from "date-fns";
import {
  LineChart as RcLineChart, Line as RcLine,
  XAxis as RcXAxis, YAxis as RcYAxis,
  Tooltip as RcTooltip, ResponsiveContainer as RcResponsiveContainer,
  CartesianGrid as RcCartesianGrid,
} from "recharts";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

// ───────────── Types ──────────────
type Stage = "pre_sprint" | "pre_email_sent" | "sprint_done" | "post_email_sent";

type Company = {
  id: number;
  companyName: string;
  founderName: string;
  founderEmail: string | null;
  founder2Name: string | null;
  founder2Email: string | null;
  cohortId: number | null;
  cohortName: string | null;
  deckUrl: string | null;
  thinkingSheetUrl: string | null;
  sourceSheetUrl: string | null;
  vision: string | null;
  stageWorkflow: Stage;
  sprintHost: string | null;
  coHost: string | null;
  keyStrength: string | null;
  gap: string | null;
  mentorRecommendation: string | null;
  marketAccess: string | null;
  tasks: string | null;
  // Sprint Data extended fields (v4.7)
  visionRaw: string | null;
  smartGoal3Months: string | null;
  previousFundraiseCr: string | null;
  previousFundraiseOrgs: string | null;
  currentBurn: string | null;
  runway: string | null;
  nextStageGoal: string | null;
  nextStageRunway: string | null;
  fundsFor: string | null;
  observationsTsDashboard: string | null;
  excelData: any;
  createdAt: string;
};

type CompanyEvent = {
  id: number;
  founderId: number;
  kind: string;
  note: string | null;
  metadata: any;
  occurredAt: string;
};

// ───────────── Timeline event metadata ──────────────
/**
 * Each timeline kind has a label, icon, and dot color. We keep this in one
 * map so the tracker and the chips elsewhere stay consistent.
 */
const EVENT_META: Record<string, { label: string; Icon: React.ElementType; dotCls: string }> = {
  template_uploaded:  { label: "Template uploaded",   Icon: Upload,        dotCls: "bg-blue-500" },
  pre_email_drafted:  { label: "Pre-email drafted",   Icon: Sparkles,      dotCls: "bg-amber-500" },
  pre_email_sent:     { label: "Pre-sprint email sent", Icon: Send,        dotCls: "bg-emerald-500" },
  sprint_scheduled:   { label: "Sprint scheduled",    Icon: Calendar,      dotCls: "bg-indigo-500" },
  sprint_completed:   { label: "Sprint completed",    Icon: CheckCircle2,  dotCls: "bg-violet-500" },
  post_email_drafted: { label: "Post-email drafted",  Icon: Sparkles,      dotCls: "bg-amber-500" },
  post_email_sent:    { label: "Post-sprint email sent", Icon: Send,       dotCls: "bg-emerald-500" },
  stage_changed:      { label: "Workflow stage changed", Icon: RefreshCw,  dotCls: "bg-sky-500" },
  sheet_cleaned:      { label: "T-Sheet cleaned from transcript", Icon: Wand2, dotCls: "bg-fuchsia-500" },
};

// ─────────── Sub-component: Tracker ─────────────
function Tracker({ events, currentStage, onMarkComplete }: {
  events: CompanyEvent[];
  currentStage: Stage;
  onMarkComplete: () => void;
}) {
  const has = (k: string) => events.some(e => e.kind === k);

  // The four "milestone" steps we always show, completed or not.
  const milestones = [
    { key: "pre_email_sent",  label: "Pre-sprint email sent" },
    { key: "sprint_scheduled", label: "Sprint scheduled" },
    { key: "sprint_completed", label: "Sprint completed" },
    { key: "post_email_sent",  label: "Post-sprint email sent" },
  ];

  return (
    <div className="space-y-6">
      {/* Milestone checklist */}
      <div>
        <h3 className="font-medium text-foreground mb-3">Workflow checklist</h3>
        <ul className="space-y-2">
          {milestones.map(m => {
            const done = has(m.key);
            const matchedEvent = events.find(e => e.kind === m.key);
            return (
              <li key={m.key} className="flex items-center gap-3 rounded-md border border-border bg-card px-3 py-2.5">
                {done ? (
                  <CheckCircle2 className="h-4 w-4 text-emerald-600 flex-shrink-0" />
                ) : (
                  <Circle className="h-4 w-4 text-muted-foreground/40 flex-shrink-0" />
                )}
                <span className={"text-sm flex-1 " + (done ? "text-foreground" : "text-muted-foreground")}>
                  {m.label}
                </span>
                {matchedEvent && (
                  <span className="text-[11px] text-muted-foreground font-mono">
                    {format(parseISO(matchedEvent.occurredAt), "d MMM, HH:mm")}
                  </span>
                )}
                {!done && m.key === "sprint_completed" && currentStage === "pre_email_sent" && (
                  <button
                    onClick={onMarkComplete}
                    className="text-[11px] text-primary hover:underline"
                  >
                    Mark complete →
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      </div>

      {/* Full event history */}
      <div>
        <h3 className="font-medium text-foreground mb-3">Activity history</h3>
        {events.length === 0 ? (
          <p className="text-sm text-muted-foreground">No activity yet.</p>
        ) : (
          <ol className="relative border-l border-border pl-6 space-y-4">
            {events.map(e => {
              const meta = EVENT_META[e.kind] ?? { label: e.kind, Icon: AlertCircle, dotCls: "bg-muted-foreground" };
              const Icon = meta.Icon;
              return (
                <li key={e.id} className="relative">
                  <span
                    className={"absolute -left-[31px] top-1.5 h-3 w-3 rounded-full ring-2 ring-background " + meta.dotCls}
                  />
                  <div className="flex items-baseline gap-2">
                    <Icon className="h-3.5 w-3.5 text-muted-foreground" />
                    <span className="text-sm font-medium text-foreground">{meta.label}</span>
                    <span className="text-[11px] font-mono text-muted-foreground ml-auto">
                      {format(parseISO(e.occurredAt), "d MMM yyyy, HH:mm")}
                    </span>
                  </div>
                  {e.note && (
                    <p className="mt-0.5 text-xs text-muted-foreground">{e.note}</p>
                  )}
                </li>
              );
            })}
          </ol>
        )}
      </div>
    </div>
  );
}

// ─────────── Sub-component: Sprint Data tab ─────────────
/**
 * Visually redesigned for v4.7.
 *
 * Layout (top → bottom):
 *   1. Vision hero card     — AI-summarised "About Startup" (lazy, click to generate)
 *   2. Strategic Direction  — SMART Goal 3mo + Actionable Tasks + Direction
 *   3. SWOT pair            — Strengths | Gaps  (side-by-side cards)
 *   4. Recommendations pair — Mentor Connect | Market Access
 *   5. Financials grid      — Previous fundraise · Burn · Runway · Fund Ask
 *
 * Empty fields are omitted; the entire tab shows an empty state only if
 * NO field across all sections has a value.
 */
function SprintDataTab({ company, onSaveObservations, savingObservations, readOnly }: {
  company: Company;
  onSaveObservations: (text: string) => void;
  savingObservations: boolean;
  readOnly?: boolean;
}) {
  const { toast } = useToast();
  const qc = useQueryClient();
  // Local draft of the observations text. Initialised from the server-side
  // value; user edits update this in-memory and a Save button persists.
  // We don't auto-save on every keystroke to avoid spamming the API.
  const [obs, setObs] = useState<string>(company.observationsTsDashboard ?? "");
  const obsDirty = obs.trim() !== (company.observationsTsDashboard ?? "").trim();

  // Lazy AI summarisation mutation. Triggered by clicking "Generate vision"
  // when there's a raw About-Startup paragraph but no cached vision yet.
  const summariseMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`${BASE}/api/companies/${company.id}/summarise-vision`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      if (!res.ok) {
        const e = await res.json().catch(() => ({}));
        throw new Error(e?.error || `Summarise failed (${res.status})`);
      }
      return (await res.json()) as { vision: string; cached: boolean };
    },
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ["company", company.id] });
      if (!data.cached) {
        toast({ title: "Vision generated", description: "Cached on the company record." });
      }
    },
    onError: (err: any) => {
      toast({ title: "Couldn't generate vision", description: err.message, variant: "destructive" });
    },
  });

  // What we have to show. Used both for the empty-state check and the layout.
  const hasVision      = Boolean(company.vision || company.visionRaw);
  const hasDirection   = Boolean(company.smartGoal3Months || company.tasks);
  const hasSwot        = Boolean(company.keyStrength || company.gap);
  const hasRecos       = Boolean(company.mentorRecommendation || company.marketAccess);
  const hasFinancials  = Boolean(
    company.previousFundraiseCr || company.previousFundraiseOrgs ||
    company.currentBurn || company.runway,
  );
  const hasNextStage   = Boolean(company.nextStageGoal || company.nextStageRunway || company.fundsFor);
  const anyContent = hasVision || hasDirection || hasSwot || hasRecos || hasFinancials || hasNextStage;

  return (
    <div className="space-y-6">
      {/* Inline empty banner when no parsed data — keeps the Observations
          textarea below reachable so the consultant can still take notes
          before/without a sheet sync. */}
      {!anyContent && (
        <div className="rounded-xl border border-dashed border-border bg-card p-8 text-center">
          <FileText className="mx-auto h-8 w-8 text-muted-foreground/40" />
          <h3 className="mt-2 font-medium text-foreground">No session data yet</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            Sprint data will appear here once you fill the SWOT, Funding and SMART Goals tabs
            in your Google Sheet, then click <strong>Re-sync from Sheet</strong>. You can still
            add internal observations below.
          </p>
        </div>
      )}
      {/* ── 1. Vision hero ─────────────────────────────────────────────── */}
      {hasVision && (
        <section
          className="relative overflow-hidden rounded-xl border border-border bg-card p-6"
          style={{
            background: "linear-gradient(135deg, hsl(var(--card)) 0%, hsl(var(--muted) / 0.5) 100%)",
          }}
        >
          {/* Decorative accent corner */}
          <div className="absolute -top-12 -right-12 h-32 w-32 rounded-full opacity-10 blur-2xl"
               style={{ background: "var(--gold)" }} />

          <div className="relative flex items-start gap-3">
            <div className="rounded-lg p-2.5 flex-shrink-0"
                 style={{ background: "var(--gold)", opacity: 0.15 }}>
              <Eye className="h-5 w-5" style={{ color: "var(--gold)" }} />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <h3 className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                  Vision
                </h3>
                {company.vision && (
                  <span className="text-[10px] uppercase tracking-wider text-muted-foreground/70 inline-flex items-center gap-1">
                    <Wand2 className="h-3 w-3" /> AI-summarised
                  </span>
                )}
              </div>

              {company.vision ? (
                <p className="mt-2 font-serif text-xl leading-snug text-foreground">
                  {company.vision}
                </p>
              ) : (
                <div className="mt-3">
                  <p className="text-sm text-muted-foreground">
                    The full "About the Startup" content is available. Generate a crisp 2-3 sentence
                    vision statement using AI.
                  </p>
                  <button
                    onClick={() => summariseMutation.mutate()}
                    disabled={summariseMutation.isPending}
                    className="mt-3 inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50 transition"
                  >
                    {summariseMutation.isPending
                      ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      : <Wand2 className="h-3.5 w-3.5" />}
                    {summariseMutation.isPending ? "Generating…" : "Generate Vision with AI"}
                  </button>
                </div>
              )}

              {/* Show the raw text in a collapsed section for transparency */}
              {company.visionRaw && (
                <details className="mt-4 group">
                  <summary className="cursor-pointer text-[11px] text-muted-foreground hover:text-foreground inline-flex items-center gap-1">
                    <ChevronRight className="h-3 w-3 transition-transform group-open:rotate-90" />
                    View full "About the Startup" text
                  </summary>
                  <div className="mt-2 rounded border border-border bg-background/50 p-3 text-xs text-muted-foreground whitespace-pre-wrap leading-relaxed">
                    {company.visionRaw}
                  </div>
                  {company.vision && (
                    <button
                      onClick={() => {
                        // Clear cached vision so the next click re-generates
                        // (we re-use the same endpoint; it'll re-summarise
                        // because vision is empty server-side after this nudge).
                        // Easier UX: just call the mutation, server returns
                        // cached unless we pass a hint. For simplicity right
                        // now we just regenerate by toast — user can wait
                        // for the next sync to refresh the summary.
                        toast({ title: "Tip", description: "Re-sync the sheet to refresh the Vision summary." });
                      }}
                      className="mt-2 text-[11px] text-primary hover:underline"
                    >
                      Want a different summary? Re-sync the sheet.
                    </button>
                  )}
                </details>
              )}
            </div>
          </div>
        </section>
      )}

      {/* ── 2. Strategic Direction ────────────────────────────────────── */}
      {(company.smartGoal3Months || company.tasks) && (
        <SectionHeader icon={Target} label="Strategic Direction" />
      )}
      {company.smartGoal3Months && (
        <DataCard
          icon={Target}
          title="SMART Goal — Next 3 Months"
          accent="violet"
          text={company.smartGoal3Months}
        />
      )}
      {company.tasks && (
        <DataCard
          icon={CheckCircle2}
          title="Actionable Tasks"
          accent="emerald"
          text={company.tasks}
        />
      )}

      {/* ── 3. SWOT (side-by-side on lg+) ─────────────────────────────── */}
      {hasSwot && <SectionHeader icon={TrendingUp} label="SWOT Highlights" />}
      {hasSwot && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {company.keyStrength && (
            <DataCard icon={TrendingUp} title="Key Strengths" accent="emerald"
                      text={company.keyStrength} />
          )}
          {company.gap && (
            <DataCard icon={AlertCircle} title="Gaps & Risks" accent="amber"
                      text={company.gap} />
          )}
        </div>
      )}

      {/* ── 4. Recommendations (side-by-side on lg+) ──────────────────── */}
      {hasRecos && <SectionHeader icon={Lightbulb} label="Recommendations" />}
      {hasRecos && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {company.mentorRecommendation && (
            <DataCard icon={Users2} title="Mentor Connect" accent="indigo"
                      text={company.mentorRecommendation} />
          )}
          {company.marketAccess && (
            <DataCard icon={Lightbulb} title="Market Access" accent="rose"
                      text={company.marketAccess} />
          )}
        </div>
      )}

      {/* ── 5. Financials ────────────────────────────────────────────── */}
      {/* ── 4½. Next Stage Plan (Metrics tab, v5.1) ─────────────────────── */}
      {hasNextStage && <SectionHeader icon={Target} label="Next Stage Plan" />}
      {hasNextStage && (
        <div className="rounded-xl border border-border bg-card overflow-hidden">
          <div className="grid grid-cols-1 lg:grid-cols-3 divide-y lg:divide-y-0 lg:divide-x divide-border">
            <StatCell icon={Target}
                      label="Quantifiable Goal — Next Stage"
                      value={company.nextStageGoal} />
            <StatCell icon={Clock}
                      label="Runway — Next Stage (Post Funding)"
                      value={company.nextStageRunway} />
            <StatCell icon={Wallet}
                      label="Funds For (What Needs Building)"
                      value={company.fundsFor} />
          </div>
        </div>
      )}

      {hasFinancials && <SectionHeader icon={DollarSign} label="Financials" />}
      {hasFinancials && (
        <div className="rounded-xl border border-border bg-card overflow-hidden">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 divide-y sm:divide-y-0 sm:divide-x divide-border">
            <StatCell icon={Wallet}
                      label="Previous Fundraise"
                      value={company.previousFundraiseCr}
                      sub={company.previousFundraiseOrgs ?? undefined} />
            <StatCell icon={DollarSign}
                      label="Current Burn"
                      value={company.currentBurn} />
            <StatCell icon={Clock}
                      label="Runway"
                      value={company.runway} />
            <StatCell icon={TrendingUp}
                      label="Fund Ask"
                      value={company.excelData?.funding?.fundAskCr
                        ? `₹ ${company.excelData.funding.fundAskCr} Cr`
                        : null} />
          </div>
        </div>
      )}

      {/* ── 6. Observations by TS Team (internal) ───────────────────────
          Post-sprint internal notes from the Host. Saved on the dashboard
          (not in the Google Sheet). Passed to Gemini as additional context
          when generating the post-sprint email so the tone reflects the
          team's view — but the AI is instructed never to quote it verbatim. */}
      <SectionHeader icon={FileText} label="Observations by TS Team (internal)" />
      <div className="rounded-xl border border-border bg-card p-5">
        <p className="text-xs text-muted-foreground mb-3">
          Internal use only. Never sent to the founder. Used as background context
          for the post-sprint email generation.
        </p>
        <textarea
          value={obs}
          onChange={(e) => setObs(e.target.value)}
          rows={5}
          placeholder="Notes from the Host after the sprint session — what stood out, where the founder needs the most support, internal flags..."
          disabled={savingObservations || readOnly}
          className="w-full px-3 py-2 bg-background border border-input rounded-md text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring/20 focus:border-ring transition leading-relaxed disabled:opacity-60"
        />
        <div className="mt-2 flex items-center justify-between">
          <span className="text-[11px] text-muted-foreground">
            {obs.length} characters
            {company.observationsTsDashboard && !obsDirty && " · saved"}
            {obsDirty && " · unsaved changes"}
          </span>
          <div className="flex items-center gap-2">
            {obsDirty && (
              <button
                onClick={() => setObs(company.observationsTsDashboard ?? "")}
                disabled={savingObservations}
                className="text-[11px] text-muted-foreground hover:text-foreground disabled:opacity-60"
              >
                Discard
              </button>
            )}
            <button
              onClick={() => onSaveObservations(obs)}
              disabled={savingObservations || !obsDirty || readOnly}
              title={readOnly ? "Viewing an archived session — switch back to Latest to edit" : ""}
              className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed transition"
            >
              {savingObservations ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />}
              Save observations
            </button>
          </div>
        </div>
      </div>

      {/* Power-user escape hatch: still expose the raw JSON */}
      {company.excelData && (
        <details className="rounded-lg border border-border bg-card p-4">
          <summary className="cursor-pointer text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            Raw parsed sheet data (debug)
          </summary>
          <pre className="mt-3 overflow-x-auto rounded bg-muted p-3 text-[11px] font-mono leading-relaxed">
            {JSON.stringify(company.excelData, null, 2)}
          </pre>
        </details>
      )}
    </div>
  );
}

// ─── Sprint Data section primitives ──────────────────────────────────────
function SectionHeader({ icon: Icon, label }: { icon: React.ElementType; label: string }) {
  return (
    <div className="flex items-center gap-2 px-1 pt-2">
      <Icon className="h-3.5 w-3.5 text-muted-foreground" />
      <h2 className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
        {label}
      </h2>
      <div className="flex-1 border-t border-border ml-2" />
    </div>
  );
}

/**
 * A single-field data card. The `accent` prop sets the icon background tint
 * so the eye can scan related cards quickly. We use specific Tailwind classes
 * (rather than dynamic) so JIT compiles them — string-interpolated class
 * names would get tree-shaken.
 */
function DataCard({ icon: Icon, title, accent, text }: {
  icon: React.ElementType;
  title: string;
  accent: "emerald" | "amber" | "violet" | "indigo" | "rose";
  text: string;
}) {
  const accentBg: Record<string, string> = {
    emerald: "bg-emerald-50 text-emerald-700",
    amber:   "bg-amber-50 text-amber-700",
    violet:  "bg-violet-50 text-violet-700",
    indigo:  "bg-indigo-50 text-indigo-700",
    rose:    "bg-rose-50 text-rose-700",
  };
  return (
    <div className="rounded-xl border border-border bg-card p-5 transition-shadow hover:shadow-sm">
      <div className="flex items-center gap-2.5">
        <div className={`rounded-md p-1.5 ${accentBg[accent]}`}>
          <Icon className="h-4 w-4" />
        </div>
        <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{title}</h3>
      </div>
      <p className="mt-3 text-sm text-foreground whitespace-pre-wrap leading-relaxed">{text}</p>
    </div>
  );
}

/** A small numeric/text stat cell — used in the Financials strip. */
function StatCell({ icon: Icon, label, value, sub }: {
  icon: React.ElementType;
  label: string;
  value: string | null;
  sub?: string;
}) {
  return (
    <div className="p-5">
      <div className="flex items-center gap-2 text-muted-foreground">
        <Icon className="h-3.5 w-3.5" />
        <span className="text-[11px] font-semibold uppercase tracking-wider">{label}</span>
      </div>
      <div className="mt-2 font-serif text-2xl text-foreground tabular-nums leading-tight">
        {value || <span className="text-muted-foreground/50 italic text-base">—</span>}
      </div>
      {sub && (
        <p className="mt-1 text-[11px] text-muted-foreground leading-relaxed truncate" title={sub}>
          {sub}
        </p>
      )}
    </div>
  );
}

// ─────────── Main page ─────────────
export default function CompanyDetailPage() {
  const params = useParams<{ id: string }>();
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const qc = useQueryClient();
  const id = Number(params.id);
  const [tab, setTab] = useState<"overview" | "sprint" | "compare" | "timeline">("overview");
  const [editingEmail, setEditingEmail] = useState(false);
  const [composer, setComposer] = useState<{ open: boolean; kind: "pre" | "post" }>({ open: false, kind: "pre" });
  const [cleanOpen, setCleanOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleteText, setDeleteText] = useState("");

  const { data, isLoading, refetch } = useQuery<{ company: Company; events: CompanyEvent[] }>({
    queryKey: ["company", id],
    queryFn: () => customFetch(`${BASE}/api/companies/${id}`, { credentials: "include" }),
    enabled: Number.isFinite(id),
    staleTime: 10_000,
  });

  // Save founder email (manual fallback when Excel didn't have it)
  const emailMutation = useMutation({
    mutationFn: async (email: string) => {
      const res = await fetch(`${BASE}/api/companies/${id}/founder-email`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      if (!res.ok) throw new Error((await res.json()).error || "Failed to update email");
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Founder email updated" });
      qc.invalidateQueries({ queryKey: ["company", id] });
      setEditingEmail(false);
    },
    onError: (err: any) => toast({ title: "Update failed", description: err.message, variant: "destructive" }),
  });

  // Mark sprint completed → backend logs an event and advances stage
  const completeMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`${BASE}/api/companies/${id}/events`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind: "sprint_completed", note: "Manually marked complete" }),
      });
      if (!res.ok) throw new Error((await res.json()).error || "Failed");
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Sprint marked complete", description: "You can now generate the post-sprint email." });
      qc.invalidateQueries({ queryKey: ["company", id] });
    },
    onError: (err: any) => toast({ title: "Failed", description: err.message, variant: "destructive" }),
  });

  // Re-pull from the originally-linked Google Sheet
  const resyncMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`${BASE}/api/companies/${id}/resync`, {
        method: "POST", credentials: "include",
      });
      if (!res.ok) throw new Error((await res.json()).error || "Re-sync failed");
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Synced from Google Sheet", description: "Latest data pulled successfully." });
      qc.invalidateQueries({ queryKey: ["company", id] });
    },
    onError: (err: any) => toast({ title: "Sync failed", description: err.message, variant: "destructive" }),
  });

  // Delete the entire company (cascades to drafts + events)
  const deleteMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`${BASE}/api/companies/${id}`, { method: "DELETE", credentials: "include" });
      if (!res.ok) throw new Error((await res.json()).error || "Delete failed");
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Company deleted" });
      qc.invalidateQueries({ queryKey: ["companies"] });
      setLocation("/companies");
    },
    onError: (err: any) => toast({ title: "Delete failed", description: err.message, variant: "destructive" }),
  });

  // ─── Multi-sprint sessions (v5.2) ──────────────────────────────────
  // Sessions are immutable snapshots of the company's Sprint Data at a
  // point in time. The "active session" is what the user is currently
  // viewing — either the live data (null) or a frozen session row.
  const [activeSessionId, setActiveSessionId] = useState<number | null>(null);
  type Session = {
    id: number;
    label: string;
    sessionNumber: number;
    stageWorkflow: string | null;
    vision: string | null; visionRaw: string | null;
    keyStrength: string | null; gap: string | null;
    mentorRecommendation: string | null; marketAccess: string | null;
    tasks: string | null;
    smartGoal3Months: string | null;
    previousFundraiseCr: string | null; previousFundraiseOrgs: string | null;
    currentBurn: string | null; runway: string | null;
    nextStageGoal: string | null; nextStageRunway: string | null; fundsFor: string | null;
    observationsTsDashboard: string | null;
    excelData: any;
    createdAt: string;
  };
  const { data: sessionsData } = useQuery<{ sessions: Session[] }>({
    queryKey: ["company-sessions", id],
    queryFn: () => customFetch(`${BASE}/api/companies/${id}/sessions`, { credentials: "include" }),
    enabled: Number.isFinite(id),
    staleTime: 10_000,
  });
  const sessions = sessionsData?.sessions ?? [];
  const activeSession = activeSessionId !== null
    ? sessions.find(s => s.id === activeSessionId) ?? null
    : null;

  // Create a new snapshot. Optional label.
  const snapshotMutation = useMutation({
    mutationFn: async (label?: string) => {
      const res = await fetch(`${BASE}/api/companies/${id}/sessions`, {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ label }),
      });
      if (!res.ok) throw new Error((await res.json()).error || "Snapshot failed");
      return (await res.json()).session as Session;
    },
    onSuccess: (s) => {
      toast({ title: "Sprint session saved", description: `Snapshot "${s.label}" archived.` });
      qc.invalidateQueries({ queryKey: ["company-sessions", id] });
      qc.invalidateQueries({ queryKey: ["company", id] });
    },
    onError: (err: any) => toast({ title: "Snapshot failed", description: err.message, variant: "destructive" }),
  });

  const deleteSessionMutation = useMutation({
    mutationFn: async (sessionId: number) => {
      const res = await fetch(`${BASE}/api/companies/${id}/sessions/${sessionId}`, {
        method: "DELETE", credentials: "include",
      });
      if (!res.ok) throw new Error("Delete failed");
    },
    onSuccess: () => {
      toast({ title: "Session deleted" });
      qc.invalidateQueries({ queryKey: ["company-sessions", id] });
      setActiveSessionId(null);
    },
  });

  /**
   * Merged view of the company. If a session is active, we overlay its
   * frozen fields on top of the live company so the rest of the UI
   * (Sprint Data tab, etc.) "just works" without knowing about sessions.
   */
  function mergeWithSession(live: any, session: Session | null): any {
    if (!session) return live;
    return {
      ...live,
      stageWorkflow: session.stageWorkflow ?? live.stageWorkflow,
      vision: session.vision,
      visionRaw: session.visionRaw,
      keyStrength: session.keyStrength,
      gap: session.gap,
      mentorRecommendation: session.mentorRecommendation,
      marketAccess: session.marketAccess,
      tasks: session.tasks,
      smartGoal3Months: session.smartGoal3Months,
      previousFundraiseCr: session.previousFundraiseCr,
      previousFundraiseOrgs: session.previousFundraiseOrgs,
      currentBurn: session.currentBurn,
      runway: session.runway,
      nextStageGoal: session.nextStageGoal,
      nextStageRunway: session.nextStageRunway,
      fundsFor: session.fundsFor,
      observationsTsDashboard: session.observationsTsDashboard,
      excelData: session.excelData,
    };
  }

  // Manual workflow stage change. Free-form: forward or backward. Logged
  // as a `stage_changed` timeline event by the server.
  const stageMutation = useMutation({
    mutationFn: async (stage: string) => {
      const res = await fetch(`${BASE}/api/companies/${id}/stage`, {
        method: "PATCH", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stage }),
      });
      if (!res.ok) throw new Error((await res.json()).error || "Stage change failed");
      return res.json();
    },
    onSuccess: (_, stage) => {
      toast({ title: "Workflow stage updated", description: `→ ${stage.replace(/_/g, " ")}` });
      qc.invalidateQueries({ queryKey: ["company", id] });
      qc.invalidateQueries({ queryKey: ["companies"] });
    },
    onError: (err: any) => toast({ title: "Stage change failed", description: err.message, variant: "destructive" }),
  });

  // Save TS team post-sprint observations (internal use)
  const observationsMutation = useMutation({
    mutationFn: async (observations: string) => {
      const res = await fetch(`${BASE}/api/companies/${id}/observations`, {
        method: "PATCH", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ observations }),
      });
      if (!res.ok) throw new Error((await res.json()).error || "Save failed");
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Observations saved" });
      qc.invalidateQueries({ queryKey: ["company", id] });
    },
    onError: (err: any) => toast({ title: "Save failed", description: err.message, variant: "destructive" }),
  });

  if (!Number.isFinite(id)) return <Layout><div className="p-10">Invalid company ID</div></Layout>;
  if (isLoading) {
    return (
      <Layout>
        <div className="px-10 py-8 space-y-4 max-w-[1400px] mx-auto">
          <Skeleton className="h-8 w-1/3" />
          <Skeleton className="h-32 w-full" />
          <Skeleton className="h-64 w-full" />
        </div>
      </Layout>
    );
  }
  if (!data?.company) {
    return <Layout><div className="p-10">Company not found</div></Layout>;
  }

  const c = data.company;
  const events = data.events;

  // Most recent "Clean the Sheet" run, if any — surfaced as a dashboard card.
  // Falls back from the Google Sheet write when the account can't edit it.
  const latestClean = (() => {
    const ev = events.find(e => e.kind === "sheet_cleaned" && e.metadata);
    if (!ev) return null;
    const m = ev.metadata as any;
    const report: CleanReport = {
      spreadsheetId: m.spreadsheetId ?? "",
      wrote: !!m.wrote,
      writeError: m.writeError ?? null,
      actionsWritten: Array.isArray(m.actionBlocks) ? m.actionBlocks.length : 0,
      ideasTouched: m.ideasTouched ?? [],
      audienceRowsAdded: m.audienceRowsAdded ?? (m.extracted?.targetAudience?.length ?? 0),
      suggestionsAdded: m.suggestionsAdded ?? (m.extracted?.suggestions?.length ?? 0),
      reorganizedAdded: m.reorganizedAdded ?? (m.extracted?.reorganized?.length ?? 0),
      targetTabFound: m.targetTabFound !== false,
      actionBlocks: m.actionBlocks ?? [],
      unmatched: [],
      extracted: m.extracted ?? { actions: [], targetAudience: [], suggestions: [] },
    };
    return { report, at: ev.occurredAt, wrote: !!m.wrote };
  })();
  const founderEmailMissing = !c.founderEmail || c.founderEmail.includes("@placeholder.local");
  // Stage gating — generous on purpose, since consultants regularly want to
  // re-draft an email after editing context. Workflow-wise:
  //   pre_sprint       → Pre is the natural action; Post is locked.
  //   pre_email_sent   → still allow regenerating Pre (rare but valid).
  //   sprint_done      → Post is the natural action; Pre still allowed.
  //   post_email_sent  → both still allowed (re-draft for forwarding etc.)
  const stageReady = {
    pre:  c.stageWorkflow !== "post_email_sent" || true, // always allow drafting
    post: c.stageWorkflow === "sprint_done" || c.stageWorkflow === "post_email_sent",
  };

  return (
    <Layout>
      <main className="flex-1 space-y-6 px-6 py-8 lg:px-10 max-w-[1400px] mx-auto">
        {/* Back link */}
        <button onClick={() => setLocation("/companies")} className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-4 w-4" /> Back to Companies
        </button>

        {/* Header */}
        <section className="rounded-xl border border-border bg-card p-6">
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div className="min-w-0">
              <div className="flex items-center gap-2 text-xs uppercase tracking-[0.2em] text-muted-foreground">
                <Building2 className="h-3 w-3" />
                {c.cohortName ?? "Uncategorised"}
              </div>
              <h1 className="mt-2 font-serif text-4xl text-foreground">{c.companyName}</h1>
              <div className="mt-2 flex items-center gap-3 flex-wrap text-sm text-muted-foreground">
                <span className="inline-flex items-center gap-1"><User className="h-3.5 w-3.5" />{c.founderName}</span>
                {founderEmailMissing ? (
                  editingEmail ? (
                    <span className="inline-flex items-center gap-2">
                      <input
                        type="email"
                        placeholder="founder@startup.com"
                        defaultValue=""
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            const v = (e.target as HTMLInputElement).value.trim();
                            if (v) emailMutation.mutate(v);
                          }
                        }}
                        autoFocus
                        className="px-2 py-1 text-xs bg-background border border-input rounded"
                      />
                      <button
                        onClick={() => setEditingEmail(false)}
                        className="text-xs text-muted-foreground hover:text-foreground"
                      >Cancel</button>
                    </span>
                  ) : (
                    <button
                      onClick={() => setEditingEmail(true)}
                      className="inline-flex items-center gap-1 text-amber-700 hover:underline"
                    >
                      <AlertCircle className="h-3.5 w-3.5" />
                      Add founder email
                    </button>
                  )
                ) : (
                  <span className="inline-flex items-center gap-1"><Mail className="h-3.5 w-3.5" />{c.founderEmail}</span>
                )}
                {c.deckUrl && (
                  <a href={c.deckUrl.startsWith("http") ? c.deckUrl : `https://${c.deckUrl}`} target="_blank" rel="noreferrer"
                     className="inline-flex items-center gap-1 text-primary hover:underline">
                    <ExternalLink className="h-3.5 w-3.5" />Deck
                  </a>
                )}
              </div>
            </div>

            {/* Action bar — buttons are enabled regardless of founder email.
                If email is missing, the composer dialog itself prompts for it
                before allowing Send. This is friendlier than locking the
                button and forcing a separate email-edit step. */}
            <div className="flex flex-col items-end gap-2">
              <div className="flex items-center gap-2 flex-wrap">
                <button
                  disabled={!stageReady.pre}
                  onClick={() => setComposer({ open: true, kind: "pre" })}
                  className="inline-flex items-center gap-2 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed transition"
                >
                  <Sparkles className="h-3.5 w-3.5" />
                  Generate Pre-Sprint Email
                </button>
                <button
                  disabled={!stageReady.post}
                  onClick={() => setComposer({ open: true, kind: "post" })}
                  className="inline-flex items-center gap-2 rounded-md border border-border bg-card px-3 py-1.5 text-xs font-medium text-foreground hover:bg-muted disabled:opacity-40 disabled:cursor-not-allowed transition"
                  title={!stageReady.post ? "Re-sync sheet with post-sprint data first, or mark sprint complete" : ""}
                >
                  <Sparkles className="h-3.5 w-3.5" />
                  Generate Post-Sprint Email
                </button>
                {c.sourceSheetUrl && (
                  <button
                    onClick={() => resyncMutation.mutate()}
                    disabled={resyncMutation.isPending}
                    className="inline-flex items-center gap-2 rounded-md border border-border bg-card px-3 py-1.5 text-xs font-medium text-foreground hover:bg-muted disabled:opacity-60"
                    title="Pull latest data from the linked Google Sheet"
                  >
                    {resyncMutation.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
                    Re-sync from Sheet
                  </button>
                )}
                {(c.sourceSheetUrl || c.thinkingSheetUrl) && (
                  <button
                    onClick={() => setCleanOpen(true)}
                    className="inline-flex items-center gap-2 rounded-md border border-primary/30 bg-primary/5 px-3 py-1.5 text-xs font-medium text-primary hover:bg-primary/10 transition"
                    title="Organise a Fathom transcript into the T-Sheet"
                  >
                    <Wand2 className="h-3.5 w-3.5" />
                    Clean the Sheet
                  </button>
                )}
                <button
                  onClick={() => setEditOpen(true)}
                  className="inline-flex items-center gap-2 rounded-md border border-border bg-card px-3 py-1.5 text-xs font-medium text-foreground hover:bg-muted"
                >
                  <Pencil className="h-3.5 w-3.5" />
                  Edit
                </button>
                <button
                  onClick={() => { setConfirmDelete(true); setDeleteText(""); }}
                  className="inline-flex items-center gap-2 rounded-md border border-destructive/30 bg-card px-3 py-1.5 text-xs font-medium text-destructive hover:bg-destructive/10"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  Delete
                </button>
              </div>
              <div className="text-[11px] text-muted-foreground flex items-center gap-2 flex-wrap">
                <span>Workflow:</span>
                <select
                  value={c.stageWorkflow}
                  onChange={(e) => stageMutation.mutate(e.target.value)}
                  disabled={stageMutation.isPending}
                  className="text-[11px] bg-background border border-input rounded px-1.5 py-0.5 text-foreground font-medium focus:outline-none focus:ring-2 focus:ring-ring/20 disabled:opacity-60"
                  title="Change the workflow stage — you can move forward or backward freely"
                >
                  <option value="pre_sprint">Pre-Sprint</option>
                  <option value="scheduled">Scheduled</option>
                  <option value="pre_email_sent">Pre-Email Sent</option>
                  <option value="sprint_done">Sprint Done</option>
                  <option value="post_email_sent">Completed</option>
                </select>
                {stageMutation.isPending && <Loader2 className="h-3 w-3 animate-spin" />}
                {c.sourceSheetUrl && <span>· <a href={c.sourceSheetUrl} target="_blank" rel="noreferrer" className="text-primary hover:underline">Linked sheet</a></span>}
              </div>
            </div>
          </div>
        </section>

        {/* ─── Multi-Sprint Session bar (v5.2) ───────────────────────────
            Lets the consultant snapshot the current Sprint Data and switch
            between archived sessions. Compact: dropdown + actions only. */}
        <section className="rounded-lg border border-border bg-card p-3 flex items-center gap-3 flex-wrap text-xs">
          <span className="font-semibold uppercase tracking-wider text-muted-foreground">Sprint Session:</span>
          <select
            value={activeSessionId === null ? "live" : String(activeSessionId)}
            onChange={(e) => setActiveSessionId(e.target.value === "live" ? null : Number(e.target.value))}
            className="bg-background border border-input rounded px-2 py-1 text-foreground font-medium focus:outline-none focus:ring-2 focus:ring-ring/20"
          >
            <option value="live">Latest (live data)</option>
            {sessions.map(s => (
              <option key={s.id} value={s.id}>
                {s.label} — {new Date(s.createdAt).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}
              </option>
            ))}
          </select>
          {activeSession ? (
            <>
              <span className="rounded-full bg-amber-50 text-amber-800 border border-amber-200 px-2 py-0.5 text-[10px] font-medium">
                Viewing archived snapshot — read-only
              </span>
              <button
                onClick={() => {
                  if (confirm(`Delete session "${activeSession.label}"? This cannot be undone.`)) {
                    deleteSessionMutation.mutate(activeSession.id);
                  }
                }}
                className="ml-auto inline-flex items-center gap-1 rounded-md text-destructive hover:bg-destructive/10 px-2 py-1 text-[11px]"
              >
                <Trash2 className="h-3 w-3" /> Delete session
              </button>
            </>
          ) : (
            <>
              {sessions.length > 0 && (
                <span className="text-muted-foreground">
                  {sessions.length} archived session{sessions.length === 1 ? "" : "s"}
                </span>
              )}
              <button
                onClick={() => {
                  const label = prompt(
                    `Save the current Sprint Data as Session ${sessions.length + 1}?\nLabel (optional, defaults to "Sprint ${sessions.length + 1}"):`,
                    `Sprint ${sessions.length + 1}`,
                  );
                  if (label !== null) snapshotMutation.mutate(label || undefined);
                }}
                disabled={snapshotMutation.isPending}
                className="ml-auto inline-flex items-center gap-1.5 rounded-md bg-primary px-2.5 py-1 text-[11px] font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
                title="Snapshot the current Sprint Data as a session. Use this before a re-sync if you want to preserve current results."
              >
                {snapshotMutation.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />}
                Save as new session
              </button>
            </>
          )}
        </section>

        {/* Tabs */}
        <div className="flex items-center gap-1 border-b border-border">
          {([
            { key: "overview", label: "Overview" },
            { key: "sprint", label: "Sprint Data" },
            { key: "compare", label: "Compare Sessions" },
            { key: "timeline", label: "Timeline" },
          ] as const).map(t => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={
                "px-4 py-2 text-sm font-medium transition-colors border-b-2 -mb-px " +
                (tab === t.key
                  ? "border-primary text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground")
              }
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* Tab content */}
        {tab === "overview" && (
          <section className="grid gap-4 md:grid-cols-2">
            {[
              { label: "Cohort",           value: c.cohortName },
              { label: "Founder",          value: c.founderName },
              { label: "Founder Email",    value: founderEmailMissing ? "— (set in header)" : c.founderEmail },
              { label: "Sprint Host",      value: c.sprintHost },
              { label: "Co-Host",          value: c.coHost },
              // Deck and Thinking Sheet are URLs — render as clickable links.
              // Thinking Sheet falls back to source_sheet_url (the consultant's
              // pasted Google Sheets URL is the Thinking Sheet by definition,
              // per the team's workflow).
              { label: "Deck Link",        value: c.deckUrl, href: c.deckUrl },
              { label: "Thinking Sheet",   value: c.thinkingSheetUrl ?? c.sourceSheetUrl, href: c.thinkingSheetUrl ?? c.sourceSheetUrl },
              { label: "Created",          value: format(parseISO(c.createdAt), "d MMM yyyy") },
            ].map(f => (
              <div key={f.label} className="rounded-lg border border-border bg-card p-4">
                <div className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">{f.label}</div>
                <div className="mt-1 text-sm text-foreground break-all">
                  {f.value ? (
                    f.href && /^https?:\/\//i.test(String(f.href)) ? (
                      <a href={String(f.href)} target="_blank" rel="noreferrer"
                         className="text-primary hover:underline inline-flex items-center gap-1">
                        <ExternalLink className="h-3 w-3 flex-shrink-0" />
                        Open link
                      </a>
                    ) : (
                      String(f.value)
                    )
                  ) : (
                    <span className="text-muted-foreground italic">Not provided</span>
                  )}
                </div>
              </div>
            ))}
          </section>
        )}

        {tab === "overview" && latestClean && (
          <section className={`mt-4 rounded-xl border bg-card p-5 ${latestClean.wrote ? "border-border" : "border-amber-300 dark:border-amber-900/50"}`}>
            <div className="mb-3 flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Wand2 className="h-4 w-4 text-primary" />
                <h3 className="text-sm font-semibold text-foreground">
                  Cleaned T-Sheet output
                </h3>
                <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${latestClean.wrote ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400" : "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400"}`}>
                  {latestClean.wrote ? "Written to sheet" : "Apply manually"}
                </span>
              </div>
              <span className="text-[11px] text-muted-foreground">
                {format(parseISO(latestClean.at), "d MMM yyyy, h:mm a")}
              </span>
            </div>
            <CleanedReportBody report={latestClean.report} />
          </section>
        )}

        {tab === "sprint" && (
          <SprintDataTab
            company={mergeWithSession(c, activeSession)}
            onSaveObservations={(text) => observationsMutation.mutate(text)}
            savingObservations={observationsMutation.isPending}
            readOnly={activeSession !== null}
          />
        )}

        {tab === "compare" && (
          <CompareSessionsTab company={c} sessions={sessions} />
        )}

        {tab === "timeline" && (
          <section className="rounded-xl border border-border bg-card p-6">
            <Tracker
              events={events}
              currentStage={c.stageWorkflow}
              onMarkComplete={() => completeMutation.mutate()}
            />
          </section>
        )}

        <footer className="pt-2 text-center text-xs text-muted-foreground">
          Thinking Spree · Consultant Suite v5.3
        </footer>
      </main>

      {/* AI email composer — renders only when open */}
      <EmailComposer
        companyId={id}
        open={composer.open}
        kind={composer.kind}
        founderEmail={founderEmailMissing ? null : c.founderEmail}
        founderName={c.founderName}
        companyName={c.companyName}
        onClose={() => setComposer({ ...composer, open: false })}
        onSent={() => qc.invalidateQueries({ queryKey: ["company", id] })}
      />

      {/* Clean the Sheet dialog */}
      <CleanSheetDialog
        companyId={id}
        companyName={c.companyName}
        open={cleanOpen}
        sheetUrl={c.sourceSheetUrl ?? c.thinkingSheetUrl ?? null}
        onClose={() => setCleanOpen(false)}
        onDone={() => qc.invalidateQueries({ queryKey: ["company", id] })}
      />

      {/* Edit dialog */}
      <EditCompanyDialog
        companyId={id}
        open={editOpen}
        initial={{
          companyName: c.companyName,
          founderName: c.founderName,
          founderEmail: c.founderEmail,
          cohortName: c.cohortName,
          deckUrl: c.deckUrl,
          sprintHost: c.sprintHost,
          coHost: c.coHost,
        }}
        onClose={() => setEditOpen(false)}
      />

      {/* Delete confirmation dialog — identical UX to the one on /companies */}
      {confirmDelete && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ background: "rgba(15, 23, 42, 0.55)", backdropFilter: "blur(4px)" }}
          onMouseDown={(e) => {
            if (e.target === e.currentTarget && !deleteMutation.isPending) {
              setConfirmDelete(false); setDeleteText("");
            }
          }}
        >
          <div
            className="w-full max-w-md rounded-xl border border-border bg-card shadow-2xl"
            onMouseDown={(e) => e.stopPropagation()}
          >
            <header className="flex items-start gap-3 border-b border-border px-6 py-4">
              <div className="rounded-md bg-destructive/10 p-2 flex-shrink-0">
                <AlertCircle className="h-5 w-5 text-destructive" />
              </div>
              <div>
                <h2 className="font-serif text-xl text-foreground">Delete company permanently?</h2>
                <p className="mt-0.5 text-xs text-muted-foreground">This cannot be undone.</p>
              </div>
            </header>
            <div className="px-6 py-4 space-y-3 text-sm text-foreground">
              <p>You're about to delete <strong>{c.companyName}</strong>. This will also remove all timeline events and email drafts for this company.</p>
              <p className="text-xs text-muted-foreground">Type <span className="font-mono font-semibold text-foreground">DELETE</span> below to confirm.</p>
              <input
                type="text"
                value={deleteText}
                onChange={(e) => setDeleteText(e.target.value)}
                placeholder="DELETE"
                autoFocus
                disabled={deleteMutation.isPending}
                className="w-full px-3 py-2 bg-background border border-input rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-destructive/30 focus:border-destructive font-mono"
              />
            </div>
            <footer className="flex items-center justify-end gap-2 border-t border-border px-6 py-3 bg-muted/30">
              <button
                onClick={() => { if (!deleteMutation.isPending) { setConfirmDelete(false); setDeleteText(""); } }}
                disabled={deleteMutation.isPending}
                className="rounded-md border border-border bg-background px-3 py-1.5 text-xs font-medium text-foreground hover:bg-muted disabled:opacity-60"
              >
                Cancel
              </button>
              <button
                onClick={() => deleteMutation.mutate()}
                disabled={deleteMutation.isPending || deleteText !== "DELETE"}
                className="inline-flex items-center gap-1.5 rounded-md bg-destructive px-3 py-1.5 text-xs font-medium text-destructive-foreground hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {deleteMutation.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                Delete permanently
              </button>
            </footer>
          </div>
        </div>
      )}
    </Layout>
  );
}

/* ───────────────────────────────────────────────────────────────────────────
 * CompareSessionsTab (v5.3)
 *
 * Two views in one tab:
 *   (1) Side-by-side SWOT/Sprint Data diff between two chosen sessions
 *   (2) Progression line chart of a chosen metric across all sessions
 *
 * "Sessions" here includes the live (current) data as a pseudo-session
 * labeled "Latest" — appended to the array as the most recent snapshot.
 * That way the consultant can compare Latest vs Sprint 1 naturally.
 *
 * Metrics for the chart come from `excelData.smart` (revenueLast12Months,
 * revenueLastMonthMrr, teamSize) and from the typed `fundAskCr` column.
 * Numbers are coerced from strings like "₹2.1 Cr" → 2.1 by stripping
 * non-numeric characters.
 * ─────────────────────────────────────────────────────────────────────────── */

type ComparableSession = {
  id: number | "live";
  label: string;
  sessionNumber: number;
  createdAt: string;
  keyStrength: string | null;
  gap: string | null;
  mentorRecommendation: string | null;
  marketAccess: string | null;
  smartGoal3Months: string | null;
  tasks: string | null;
  previousFundraiseCr: string | null;
  currentBurn: string | null;
  runway: string | null;
  fundsFor: string | null;
  nextStageGoal: string | null;
  excelData: any;
  fundAskCrNumeric: number | null;   // for chart only
};

/**
 * Extract a numeric value out of a raw string. Returns null if no digits
 * are present. "₹2.5 Cr (Pre-seed)" → 2.5; "₹40 L / month" → 40;
 * "10 months" → 10. The unit context (Cr vs L vs months) is responsibility
 * of the caller — we just pull the first numeric run.
 */
function extractNumber(raw: string | number | null | undefined): number | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : null;
  const m = String(raw).match(/-?\d+(?:[.,]\d+)?/);
  if (!m) return null;
  const n = Number(m[0].replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

function toComparable(c: any): ComparableSession {
  // Used to convert both archived sessions and the live company into a
  // single shape the rest of the tab can work with.
  return {
    id: c.id,
    label: c.label ?? "Latest",
    sessionNumber: c.sessionNumber ?? 999_999,
    createdAt: c.createdAt ?? new Date().toISOString(),
    keyStrength: c.keyStrength ?? null,
    gap: c.gap ?? null,
    mentorRecommendation: c.mentorRecommendation ?? null,
    marketAccess: c.marketAccess ?? null,
    smartGoal3Months: c.smartGoal3Months ?? null,
    tasks: c.tasks ?? null,
    previousFundraiseCr: c.previousFundraiseCr ?? null,
    currentBurn: c.currentBurn ?? null,
    runway: c.runway ?? null,
    fundsFor: c.fundsFor ?? null,
    nextStageGoal: c.nextStageGoal ?? null,
    excelData: c.excelData ?? null,
    fundAskCrNumeric: extractNumber(c.excelData?.funding?.fundAskCr),
  };
}

type MetricKey =
  | "fundAskCr"
  | "revenueLast12Months"
  | "revenueLastMonthMrr"
  | "teamSize"
  | "previousFundraiseCr"
  | "runway"
  | "currentBurn";

const METRIC_DEFS: { key: MetricKey; label: string; unit: string; pickValue: (s: ComparableSession) => number | null }[] = [
  { key: "fundAskCr",            label: "Fund Ask",           unit: "₹ Cr",        pickValue: s => s.fundAskCrNumeric ?? extractNumber(s.excelData?.funding?.fundAskCr) },
  { key: "revenueLast12Months",  label: "Revenue (12mo)",     unit: "raw number",  pickValue: s => extractNumber(s.excelData?.smart?.revenueLast12Months) },
  { key: "revenueLastMonthMrr",  label: "MRR (last month)",   unit: "raw number",  pickValue: s => extractNumber(s.excelData?.smart?.revenueLastMonthMrr) },
  { key: "teamSize",             label: "Team Size",          unit: "headcount",   pickValue: s => extractNumber(s.excelData?.smart?.teamSize) },
  { key: "previousFundraiseCr",  label: "Previous Fundraise", unit: "raw number",  pickValue: s => extractNumber(s.previousFundraiseCr) },
  { key: "runway",               label: "Runway",             unit: "raw number",  pickValue: s => extractNumber(s.runway) },
  { key: "currentBurn",          label: "Current Burn",       unit: "raw number",  pickValue: s => extractNumber(s.currentBurn) },
];

function CompareSessionsTab({ company, sessions }: { company: any; sessions: any[] }) {
  // Build the canonical list: archived sessions (sorted by number) +
  // "Latest" pseudo-session at the end. Always include Latest even if
  // there are zero archived sessions — comparing Latest to itself is
  // useless, but the UI gracefully handles that case.
  const archivedComparable: ComparableSession[] = (sessions ?? [])
    .map(toComparable)
    .sort((a, b) => a.sessionNumber - b.sessionNumber);
  const liveComparable: ComparableSession = toComparable({
    ...company,
    id: "live" as const,
    label: "Latest",
    sessionNumber: (archivedComparable.at(-1)?.sessionNumber ?? 0) + 1,
    createdAt: new Date().toISOString(),
  });
  const all = [...archivedComparable, liveComparable];

  // Default diff picks: Latest vs most recent archived (if any)
  const defaultLeft = archivedComparable.length > 0 ? archivedComparable.at(-1)!.id : liveComparable.id;
  const [leftId, setLeftId] = useState<string>(String(defaultLeft));
  const [rightId, setRightId] = useState<string>("live");

  const left = all.find(s => String(s.id) === leftId);
  const right = all.find(s => String(s.id) === rightId);

  const [metric, setMetric] = useState<MetricKey>("fundAskCr");
  const metricDef = METRIC_DEFS.find(m => m.key === metric)!;

  // Chart data — one point per session in chronological order.
  const chartData = all.map(s => ({
    name: s.label,
    value: metricDef.pickValue(s),
  }));
  const hasAnyValue = chartData.some(d => d.value !== null);

  if (all.length === 1) {
    return (
      <section className="rounded-xl border border-dashed border-border bg-card p-10 text-center">
        <h3 className="font-medium text-foreground">Only one session exists</h3>
        <p className="mt-1 text-sm text-muted-foreground">
          Use <strong>Save as new session</strong> in the bar above to snapshot the current Sprint Data.
          Once you have at least one archived session, you can compare them here.
        </p>
      </section>
    );
  }

  return (
    <div className="space-y-6">
      {/* ───── SWOT side-by-side diff ───────────────────────────────── */}
      <section className="rounded-xl border border-border bg-card overflow-hidden">
        <header className="px-5 py-3 border-b border-border bg-muted/30 flex items-center gap-3 flex-wrap">
          <h3 className="font-serif text-lg text-foreground">Side-by-side comparison</h3>
          <div className="ml-auto flex items-center gap-3 flex-wrap text-xs">
            <div className="flex items-center gap-2">
              <span className="text-muted-foreground uppercase tracking-wider text-[10px] font-semibold">Left</span>
              <select value={leftId} onChange={(e) => setLeftId(e.target.value)}
                className="bg-background border border-input rounded px-2 py-1 text-foreground font-medium">
                {all.map(s => <option key={s.id} value={String(s.id)}>{s.label}</option>)}
              </select>
            </div>
            <span className="text-muted-foreground">vs</span>
            <div className="flex items-center gap-2">
              <span className="text-muted-foreground uppercase tracking-wider text-[10px] font-semibold">Right</span>
              <select value={rightId} onChange={(e) => setRightId(e.target.value)}
                className="bg-background border border-input rounded px-2 py-1 text-foreground font-medium">
                {all.map(s => <option key={s.id} value={String(s.id)}>{s.label}</option>)}
              </select>
            </div>
          </div>
        </header>

        {leftId === rightId ? (
          <div className="p-10 text-center text-sm text-muted-foreground">
            Pick two different sessions to compare.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/20 text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                <tr>
                  <th className="px-4 py-3 w-[180px]">Field</th>
                  <th className="px-4 py-3">{left?.label}</th>
                  <th className="px-4 py-3">{right?.label}</th>
                </tr>
              </thead>
              <tbody>
                {[
                  { key: "keyStrength",          label: "Key Strengths" },
                  { key: "gap",                   label: "Gaps" },
                  { key: "mentorRecommendation",  label: "Mentor Connect" },
                  { key: "marketAccess",          label: "Market Access" },
                  { key: "smartGoal3Months",      label: "SMART Goal (3mo)" },
                  { key: "tasks",                  label: "Actionable Tasks" },
                  { key: "nextStageGoal",          label: "Next Stage Goal" },
                  { key: "previousFundraiseCr",   label: "Previous Fundraise" },
                  { key: "currentBurn",            label: "Current Burn" },
                  { key: "runway",                 label: "Runway" },
                ].map(field => {
                  const lVal = (left as any)?.[field.key];
                  const rVal = (right as any)?.[field.key];
                  const changed = (lVal ?? "").trim() !== (rVal ?? "").trim();
                  return (
                    <tr key={field.key} className={`border-t border-border ${changed ? "" : "opacity-60"}`}>
                      <td className="px-4 py-3 align-top">
                        <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{field.label}</div>
                        {changed && lVal && rVal && (
                          <span className="mt-1 inline-block rounded-full bg-amber-50 text-amber-800 border border-amber-200 px-1.5 py-0.5 text-[9px] font-medium">
                            Changed
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 align-top">
                        <DiffCell value={lVal} otherValue={rVal} />
                      </td>
                      <td className="px-4 py-3 align-top">
                        <DiffCell value={rVal} otherValue={lVal} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* ───── Metric progression chart ─────────────────────────────── */}
      <section className="rounded-xl border border-border bg-card overflow-hidden">
        <header className="px-5 py-3 border-b border-border bg-muted/30 flex items-center gap-3 flex-wrap">
          <h3 className="font-serif text-lg text-foreground">Progression chart</h3>
          <div className="ml-auto flex items-center gap-2 text-xs">
            <span className="text-muted-foreground uppercase tracking-wider text-[10px] font-semibold">Metric</span>
            <select value={metric} onChange={(e) => setMetric(e.target.value as MetricKey)}
              className="bg-background border border-input rounded px-2 py-1 text-foreground font-medium">
              {METRIC_DEFS.map(m => <option key={m.key} value={m.key}>{m.label}</option>)}
            </select>
          </div>
        </header>

        {!hasAnyValue ? (
          <div className="p-10 text-center text-sm text-muted-foreground">
            <p>No numeric data for <strong>{metricDef.label}</strong> across these sessions.</p>
            <p className="mt-1 text-xs">Make sure the source sheet has values for this field, and that each session was snapshotted after the data was populated.</p>
          </div>
        ) : (
          <div className="p-5">
            <SimpleLineChart
              data={chartData}
              ySuffix={metricDef.unit === "headcount" ? "" : ""}
              valueLabel={metricDef.label}
            />
            <p className="mt-3 text-[11px] text-muted-foreground text-center">
              Values extracted numerically from each session's raw text (e.g. "₹2.5 Cr (Pre-seed)" → 2.5).
              Empty points mean the field was blank in that session.
            </p>
          </div>
        )}
      </section>
    </div>
  );
}

/** Renders a single cell in the SWOT diff. Shows "—" for empty + a subtle
 *  tint when the value differs from the other side. */
function DiffCell({ value, otherValue }: { value: string | null; otherValue: string | null }) {
  const v = (value ?? "").trim();
  const o = (otherValue ?? "").trim();
  if (!v) return <span className="text-muted-foreground/50 italic">—</span>;
  const changed = v !== o;
  return (
    <div className={`whitespace-pre-wrap leading-relaxed text-sm ${changed ? "text-foreground" : "text-muted-foreground"}`}>
      {v}
    </div>
  );
}

/**
 * Compact line chart using Recharts. Intentionally minimal — full tooltips,
 * gridlines, and axes calibrated for short session-count series. Empty
 * (null) points are connected with a dashed segment to make the gap visible.
 */
function SimpleLineChart({ data, valueLabel }: {
  data: { name: string; value: number | null }[];
  ySuffix?: string;
  valueLabel: string;
}) {
  return (
    <div className="w-full h-[280px]">
      <RcResponsiveContainer width="100%" height="100%">
        <RcLineChart data={data} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
          <RcCartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
          <RcXAxis dataKey="name" stroke="hsl(var(--muted-foreground))" fontSize={11} />
          <RcYAxis stroke="hsl(var(--muted-foreground))" fontSize={11} />
          <RcTooltip
            contentStyle={{
              background: "hsl(var(--card))",
              border: "1px solid hsl(var(--border))",
              borderRadius: 8,
              fontSize: 12,
            }}
            labelFormatter={(l: any) => `Session: ${l}`}
            formatter={(v: any) => [v, valueLabel]}
          />
          <RcLine
            type="monotone"
            dataKey="value"
            stroke="hsl(222 38% 15%)"
            strokeWidth={2}
            dot={{ r: 4, fill: "hsl(222 38% 15%)" }}
            activeDot={{ r: 6 }}
            connectNulls={false}
          />
        </RcLineChart>
      </RcResponsiveContainer>
    </div>
  );
}
