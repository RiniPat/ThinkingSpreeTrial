import { useState } from "react";
import { useParams, useLocation, Link } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react";
import { Layout } from "@/components/Layout";
import { Skeleton } from "@/components/ui/skeleton";
import { EmailComposer } from "@/components/EmailComposer";
import { useToast } from "@/hooks/use-toast";
import {
  ArrowLeft, Building2, User, Mail, ExternalLink, Sparkles, Send, CheckCircle2,
  Clock, Circle, AlertCircle, Upload, Save, Loader2, Calendar, FileText, ChevronRight,
} from "lucide-react";
import { format, parseISO } from "date-fns";

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
  vision: string | null;
  stageWorkflow: Stage;
  sprintHost: string | null;
  coHost: string | null;
  keyStrength: string | null;
  gap: string | null;
  mentorRecommendation: string | null;
  marketAccess: string | null;
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
function SprintDataTab({ company }: { company: Company }) {
  const sections = [
    { title: "Vision (About Startup)", value: company.vision },
    { title: "Key Strengths (SWOT)",   value: company.keyStrength },
    { title: "Gaps (SWOT)",             value: company.gap },
    { title: "Mentor Recommendation",   value: company.mentorRecommendation },
    { title: "Market Access",           value: company.marketAccess },
  ];
  const hasAny = sections.some(s => s.value);

  if (!hasAny) {
    return (
      <div className="rounded-xl border border-dashed border-border bg-card p-10 text-center">
        <FileText className="mx-auto h-10 w-10 text-muted-foreground/40" />
        <h3 className="mt-3 font-medium text-foreground">No session data yet</h3>
        <p className="mt-1 text-sm text-muted-foreground">
          Post-sprint data will appear here after you re-upload the completed Sprint Template.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {sections.map(s => s.value && (
        <div key={s.title} className="rounded-lg border border-border bg-card p-5">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{s.title}</h3>
          <p className="mt-2 text-sm text-foreground whitespace-pre-wrap leading-relaxed">{s.value}</p>
        </div>
      ))}
      {/* Raw Excel data viewer for power users */}
      {company.excelData && (
        <details className="rounded-lg border border-border bg-card p-5">
          <summary className="cursor-pointer text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Raw parsed Excel data
          </summary>
          <pre className="mt-3 overflow-x-auto rounded bg-muted p-3 text-[11px] font-mono">
            {JSON.stringify(company.excelData, null, 2)}
          </pre>
        </details>
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
  const [tab, setTab] = useState<"overview" | "sprint" | "timeline">("overview");
  const [editingEmail, setEditingEmail] = useState(false);
  const [composer, setComposer] = useState<{ open: boolean; kind: "pre" | "post" }>({ open: false, kind: "pre" });

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
  const founderEmailMissing = !c.founderEmail || c.founderEmail.includes("@placeholder.local");
  const stageReady = {
    pre:  c.stageWorkflow === "pre_sprint",
    post: c.stageWorkflow === "sprint_done",
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

            {/* Action bar */}
            <div className="flex flex-col items-end gap-2">
              <div className="flex items-center gap-2 flex-wrap">
                <button
                  disabled={!stageReady.pre || founderEmailMissing}
                  onClick={() => setComposer({ open: true, kind: "pre" })}
                  className="inline-flex items-center gap-2 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed transition"
                  title={founderEmailMissing ? "Add founder email first" : ""}
                >
                  <Sparkles className="h-3.5 w-3.5" />
                  Generate Pre-Sprint Email
                </button>
                <button
                  disabled={!stageReady.post || founderEmailMissing}
                  onClick={() => setComposer({ open: true, kind: "post" })}
                  className="inline-flex items-center gap-2 rounded-md border border-border bg-card px-3 py-1.5 text-xs font-medium text-foreground hover:bg-muted disabled:opacity-40 disabled:cursor-not-allowed transition"
                  title={!stageReady.post ? "Mark sprint complete first" : (founderEmailMissing ? "Add founder email first" : "")}
                >
                  <Sparkles className="h-3.5 w-3.5" />
                  Generate Post-Sprint Email
                </button>
                <Link href="/companies">
                  <a className="inline-flex items-center gap-2 rounded-md border border-border bg-card px-3 py-1.5 text-xs font-medium text-foreground hover:bg-muted">
                    <Upload className="h-3.5 w-3.5" />
                    Re-upload Template
                  </a>
                </Link>
              </div>
              <div className="text-[11px] text-muted-foreground">
                Workflow: <span className="font-medium text-foreground">{c.stageWorkflow.replace(/_/g, " ")}</span>
              </div>
            </div>
          </div>
        </section>

        {/* Tabs */}
        <div className="flex items-center gap-1 border-b border-border">
          {([
            { key: "overview", label: "Overview" },
            { key: "sprint", label: "Sprint Data" },
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
              { label: "Deck Link",        value: c.deckUrl },
              { label: "Thinking Sheet",   value: c.thinkingSheetUrl },
              { label: "Created",          value: format(parseISO(c.createdAt), "d MMM yyyy") },
            ].map(f => (
              <div key={f.label} className="rounded-lg border border-border bg-card p-4">
                <div className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">{f.label}</div>
                <div className="mt-1 text-sm text-foreground">
                  {f.value || <span className="text-muted-foreground italic">Not provided</span>}
                </div>
              </div>
            ))}
          </section>
        )}

        {tab === "sprint" && <SprintDataTab company={c} />}

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
          Thinking Spree · Consultant Suite v4.3
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
    </Layout>
  );
}
