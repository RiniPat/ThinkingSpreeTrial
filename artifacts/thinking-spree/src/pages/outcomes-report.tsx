import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { customFetch, useListIncubators } from "@workspace/api-client-react";
import { Layout } from "@/components/Layout";
import { Skeleton } from "@/components/ui/skeleton";
import {
  TrendingUp, Users, Mail, MessageSquare, CheckCircle2,
  BarChart3, Calendar, Building2,
} from "lucide-react";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

type Report = {
  range: { from: string; to: string };
  cohort: string | null;
  totals: {
    companies: number;
    completedSprints: number;
    completionRate: number;
    preEmailSent: number;
    postEmailSent: number;
    observationsRecorded: number;
  };
  byStage: { stage: string; count: number }[];
  byCohort: { cohort: string; count: number }[];
  topObservationWords: { word: string; count: number }[];
  topCompanies: { id: number; companyName: string; cohort: string | null; stage: string | null; createdAt: string }[];
};

const STAGE_LABELS: Record<string, string> = {
  pre_sprint: "Pre-Sprint",
  scheduled: "Scheduled",
  pre_email_sent: "Pre-Email Sent",
  sprint_done: "Sprint Done",
  post_email_sent: "Completed",
};

const STAGE_COLOR: Record<string, string> = {
  pre_sprint: "bg-amber-100",
  scheduled: "bg-sky-100",
  pre_email_sent: "bg-blue-100",
  sprint_done: "bg-violet-100",
  post_email_sent: "bg-emerald-100",
};

function toDateInput(d: Date): string {
  // YYYY-MM-DD in local time, suitable for <input type="date">
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

export default function OutcomesReportPage() {
  // Default: last 30 days, all cohorts.
  const now = new Date();
  const defaultFrom = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  const [from, setFrom] = useState(toDateInput(defaultFrom));
  const [to, setTo] = useState(toDateInput(now));
  const [cohort, setCohort] = useState<string>("all");

  const { data: incubators } = useListIncubators();
  const cohortNames = useMemo(() => {
    const names = (incubators ?? []).map(i => i.name);
    return Array.from(new Set(names)).sort();
  }, [incubators]);

  const queryParams = new URLSearchParams();
  if (from) queryParams.set("from", from);
  if (to) queryParams.set("to", to);
  if (cohort !== "all") queryParams.set("cohort", cohort);

  const { data, isLoading } = useQuery<Report>({
    queryKey: ["/api/reports/outcomes", from, to, cohort],
    queryFn: () => customFetch(`${BASE}/api/reports/outcomes?${queryParams.toString()}`, { credentials: "include" }),
    staleTime: 30_000,
  });

  return (
    <Layout>
      <main className="flex-1 space-y-6 px-6 py-8 lg:px-10 max-w-[1400px] mx-auto">
        <section className="flex items-end justify-between gap-4 flex-wrap">
          <div>
            <div className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Workspace</div>
            <h1 className="mt-2 font-serif text-4xl text-foreground">Sprint Outcomes</h1>
            <p className="mt-1 text-sm text-muted-foreground max-w-2xl">
              Aggregate view of sprint activity. Filter by date range and cohort to slice the data
              and find patterns across founders supported in the window.
            </p>
          </div>
        </section>

        {/* Filter bar */}
        <section className="rounded-xl border border-border bg-card p-4 flex items-center gap-4 flex-wrap">
          <div className="flex items-center gap-2">
            <Calendar className="h-3.5 w-3.5 text-muted-foreground" />
            <label className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">From</label>
            <input type="date" value={from} onChange={(e) => setFrom(e.target.value)}
              className="px-2 py-1 bg-background border border-input rounded text-xs" />
          </div>
          <div className="flex items-center gap-2">
            <label className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">To</label>
            <input type="date" value={to} onChange={(e) => setTo(e.target.value)}
              className="px-2 py-1 bg-background border border-input rounded text-xs" />
          </div>
          <div className="flex items-center gap-2">
            <Building2 className="h-3.5 w-3.5 text-muted-foreground" />
            <label className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Cohort</label>
            <select value={cohort} onChange={(e) => setCohort(e.target.value)}
              className="px-2 py-1 bg-background border border-input rounded text-xs min-w-[160px]">
              <option value="all">All cohorts</option>
              {cohortNames.map(n => <option key={n} value={n}>{n}</option>)}
            </select>
          </div>
          <div className="ml-auto flex gap-1.5">
            <QuickRangeButton label="Last 7d" onClick={() => { const d = new Date(); d.setDate(d.getDate() - 7); setFrom(toDateInput(d)); setTo(toDateInput(new Date())); }} />
            <QuickRangeButton label="Last 30d" onClick={() => { const d = new Date(); d.setDate(d.getDate() - 30); setFrom(toDateInput(d)); setTo(toDateInput(new Date())); }} />
            <QuickRangeButton label="Last 90d" onClick={() => { const d = new Date(); d.setDate(d.getDate() - 90); setFrom(toDateInput(d)); setTo(toDateInput(new Date())); }} />
          </div>
        </section>

        {isLoading ? (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-24 rounded-xl" />)}
          </div>
        ) : !data ? (
          <div className="text-center text-sm text-muted-foreground py-10">No data.</div>
        ) : (
          <>
            {/* Totals strip */}
            <section className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
              <Stat icon={Users}        label="Companies"           value={data.totals.companies} />
              <Stat icon={CheckCircle2} label="Sprints Completed"   value={data.totals.completedSprints} />
              <Stat icon={TrendingUp}   label="Completion Rate"     value={`${data.totals.completionRate}%`} accent="emerald" />
              <Stat icon={Mail}         label="Pre-Emails Sent"     value={data.totals.preEmailSent} />
              <Stat icon={Mail}         label="Post-Emails Sent"    value={data.totals.postEmailSent} />
              <Stat icon={MessageSquare} label="Observations Logged" value={data.totals.observationsRecorded} />
            </section>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* Stage breakdown */}
              <section className="rounded-xl border border-border bg-card p-5">
                <div className="flex items-center gap-2 mb-4">
                  <BarChart3 className="h-4 w-4 text-muted-foreground" />
                  <h2 className="font-serif text-xl text-foreground">Companies by Stage</h2>
                </div>
                {data.byStage.length === 0 ? (
                  <p className="text-sm text-muted-foreground py-8 text-center">No companies in this window.</p>
                ) : (
                  <BarList items={data.byStage.map(s => ({
                    label: STAGE_LABELS[s.stage] ?? s.stage,
                    value: s.count,
                    color: STAGE_COLOR[s.stage] ?? "bg-slate-100",
                  }))} />
                )}
              </section>

              {/* Cohort breakdown */}
              <section className="rounded-xl border border-border bg-card p-5">
                <div className="flex items-center gap-2 mb-4">
                  <Building2 className="h-4 w-4 text-muted-foreground" />
                  <h2 className="font-serif text-xl text-foreground">By Cohort</h2>
                </div>
                {data.byCohort.length === 0 ? (
                  <p className="text-sm text-muted-foreground py-8 text-center">No companies in this window.</p>
                ) : (
                  <BarList items={data.byCohort.map(c => ({ label: c.cohort, value: c.count, color: "bg-amber-100" }))} />
                )}
              </section>
            </div>

            {/* Observation themes */}
            <section className="rounded-xl border border-border bg-card p-5">
              <div className="flex items-center gap-2 mb-4">
                <MessageSquare className="h-4 w-4 text-muted-foreground" />
                <h2 className="font-serif text-xl text-foreground">Top Themes in Observations</h2>
              </div>
              {data.topObservationWords.length === 0 ? (
                <p className="text-sm text-muted-foreground py-8 text-center">
                  No observation notes recorded in this window.
                </p>
              ) : (
                <>
                  <p className="text-xs text-muted-foreground mb-3">
                    Naive word-frequency across the Observations by TS Team field. Useful as a starting point to spot recurring topics — not a replacement for reading the notes.
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {data.topObservationWords.map(w => {
                      const max = data.topObservationWords[0].count;
                      const intensity = Math.round((w.count / max) * 100);
                      return (
                        <span key={w.word} className="inline-flex items-center gap-1.5 rounded-full border border-violet-200 bg-violet-50 px-3 py-1 text-xs"
                          style={{ fontSize: `${0.7 + (intensity / 100) * 0.35}rem` }}>
                          <span className="font-medium text-violet-900 capitalize">{w.word}</span>
                          <span className="text-violet-700/70 tabular-nums">{w.count}</span>
                        </span>
                      );
                    })}
                  </div>
                </>
              )}
            </section>

            {/* Recent completed sprints */}
            <section className="rounded-xl border border-border bg-card overflow-hidden">
              <header className="px-5 py-3 border-b border-border bg-muted/30">
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4 text-muted-foreground" />
                  <h2 className="font-serif text-xl text-foreground">Recent Completed Sprints</h2>
                </div>
              </header>
              {data.topCompanies.length === 0 ? (
                <p className="px-5 py-8 text-sm text-muted-foreground text-center">No completed sprints in this window.</p>
              ) : (
                <table className="w-full text-sm">
                  <thead className="bg-muted/20 text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                    <tr>
                      <th className="px-5 py-2.5">Company</th>
                      <th className="px-5 py-2.5">Cohort</th>
                      <th className="px-5 py-2.5">Stage</th>
                      <th className="px-5 py-2.5">Added</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.topCompanies.map(c => (
                      <tr key={c.id} className="border-t border-border hover:bg-muted/20">
                        <td className="px-5 py-2.5">
                          <a href={`/companies/${c.id}`} className="font-medium text-foreground hover:text-primary">{c.companyName}</a>
                        </td>
                        <td className="px-5 py-2.5 text-muted-foreground">{c.cohort ?? "—"}</td>
                        <td className="px-5 py-2.5 text-muted-foreground">{STAGE_LABELS[c.stage ?? ""] ?? c.stage}</td>
                        <td className="px-5 py-2.5 text-muted-foreground text-xs">
                          {new Date(c.createdAt).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </section>
          </>
        )}

        <footer className="pt-2 text-center text-xs text-muted-foreground">Thinking Spree · Consultant Suite v5.2</footer>
      </main>
    </Layout>
  );
}

function Stat({ icon: Icon, label, value, accent }: { icon: React.ElementType; label: string; value: number | string; accent?: "emerald" }) {
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="flex items-center gap-2 text-muted-foreground">
        <Icon className="h-3.5 w-3.5" />
        <span className="text-[11px] font-semibold uppercase tracking-wider">{label}</span>
      </div>
      <div className={`mt-1.5 font-serif text-2xl tabular-nums ${accent === "emerald" ? "text-emerald-700" : "text-foreground"}`}>
        {value}
      </div>
    </div>
  );
}

function BarList({ items }: { items: { label: string; value: number; color: string }[] }) {
  const max = Math.max(...items.map(i => i.value), 1);
  return (
    <div className="space-y-2.5">
      {items.map((item, i) => (
        <div key={i}>
          <div className="flex items-center justify-between text-xs mb-1">
            <span className="text-foreground">{item.label}</span>
            <span className="text-muted-foreground tabular-nums">{item.value}</span>
          </div>
          <div className="h-2 bg-muted rounded-full overflow-hidden">
            <div className={`h-full ${item.color} rounded-full transition-all`}
              style={{ width: `${(item.value / max) * 100}%` }} />
          </div>
        </div>
      ))}
    </div>
  );
}

function QuickRangeButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button onClick={onClick}
      className="rounded-md border border-border bg-card px-2.5 py-1 text-[11px] font-medium text-muted-foreground hover:bg-muted hover:text-foreground transition">
      {label}
    </button>
  );
}
