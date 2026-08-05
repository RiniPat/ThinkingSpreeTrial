import {
  useGetMe,
  customFetch,
} from "@workspace/api-client-react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Layout } from "@/components/Layout";
import { ResearchCopilotDock } from "@/components/ResearchCopilotDock";
import { Skeleton } from "@/components/ui/skeleton";
import { Link } from "wouter";
import {
  Calendar, Clock, ArrowUpRight, RefreshCw, MapPin, Video,
  ChevronRight, CheckCircle2, AlertCircle, TrendingUp,
} from "lucide-react";
import { format, parseISO, isToday, isTomorrow } from "date-fns";

const BASE = (import.meta as any).env?.BASE_URL?.replace(/\/$/, "") ?? "";

type CalEvent = {
  id: string; title: string; startTime: string; endTime: string;
  location: string | null; description: string;
  meetLink: string | null; attendees: string[];
  isAllDay: boolean; source: "google" | "sprints";
};

/** Groups calendar events by their start-day. Used by the "Today's Schedule"
 *  widget so each day has its own header (Today / Tomorrow / explicit date).
 *  Empty days are omitted. Skips events with malformed dates. */
function groupByDay(events: CalEvent[]): Array<{ dateKey: string; label: string; events: CalEvent[] }> {
  const groups = new Map<string, CalEvent[]>();
  for (const e of events) {
    if (!e.startTime) continue;
    try {
      const d = parseISO(e.startTime);
      const key = format(d, "yyyy-MM-dd");
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(e);
    } catch { /* skip malformed */ }
  }
  return [...groups.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([dateKey, evs]) => {
      const d = parseISO(dateKey + "T00:00:00");
      const label = isToday(d) ? "Today" : isTomorrow(d) ? "Tomorrow" : format(d, "EEEE, MMM d");
      return { dateKey, label, events: evs };
    });
}

/** Sprint status chip — bordered pill with icon, matching the lovable look. */
function StatusChip({ status }: { status: string }) {
  const map: Record<string, { cls: string; Icon: React.ElementType }> = {
    completed: { cls: "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-900/30 dark:text-emerald-400 dark:border-emerald-900/50", Icon: CheckCircle2 },
    scheduled: { cls: "bg-blue-50 text-primary border-blue-200 dark:bg-blue-900/30 dark:text-blue-400 dark:border-blue-900/50", Icon: Clock },
    cancelled: { cls: "bg-muted text-muted-foreground border-border", Icon: AlertCircle },
  };
  const m = map[status?.toLowerCase()] ?? map.scheduled;
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium capitalize ${m.cls}`}>
      <m.Icon className="h-3 w-3" />
      {status}
    </span>
  );
}

/** Stat card — number with serif display font + delta + trend + hover arrow.
 *  Numbers are tabular-nums for clean column alignment when values change. */
function StatCard({ label, value, delta, trend, tone = "neutral" }: {
  label: string; value: number | string;
  delta?: string; trend?: string;
  tone?: "up" | "down" | "neutral";
}) {
  const toneCls =
    tone === "up" ? "text-emerald-700 dark:text-emerald-400" :
    tone === "down" ? "text-rose-700 dark:text-rose-400" :
    "text-muted-foreground";
  const accent =
    tone === "up" ? "from-emerald-400/70 to-emerald-500/0" :
    tone === "down" ? "from-rose-400/70 to-rose-500/0" :
    "from-primary/60 to-primary/0";
  return (
    <div
      data-testid={`card-stat-${label.toLowerCase().replace(/\s+/g, "-")}`}
      className="group relative overflow-hidden rounded-xl border border-card-border bg-card p-5 transition-all hover:shadow-md hover:-translate-y-0.5"
    >
      {/* tone accent strip */}
      <div className={`absolute inset-x-0 top-0 h-0.5 bg-gradient-to-r ${accent}`} />
      {/* soft corner glow on hover */}
      <div className={`pointer-events-none absolute -right-8 -top-8 h-24 w-24 rounded-full bg-gradient-to-br ${accent} opacity-0 blur-2xl transition-opacity duration-500 group-hover:opacity-60`} />
      <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
        {label}
      </div>
      <div className="mt-3 flex items-baseline gap-2">
        <div className="font-serif text-4xl text-foreground tabular-nums">{value}</div>
        {delta && <div className={`text-xs font-medium ${toneCls}`}>{delta}</div>}
      </div>
      {trend && <div className="mt-1 text-xs text-muted-foreground">{trend}</div>}
      <div className="absolute right-4 top-4 opacity-0 transition-opacity group-hover:opacity-100">
        <ArrowUpRight className="h-4 w-4 text-muted-foreground" />
      </div>
    </div>
  );
}

/** Animated SVG progress ring — used for the monthly completion rate. */
function CompletionRing({ pct, size = 132 }: { pct: number; size?: number }) {
  const stroke = 10;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const clamped = Math.max(0, Math.min(100, pct));
  const dash = (clamped / 100) * c;
  return (
    <div className="relative inline-flex items-center justify-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <defs>
          <linearGradient id="ringGrad" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="hsl(var(--primary))" />
            <stop offset="100%" stopColor="hsl(var(--primary) / 0.4)" />
          </linearGradient>
        </defs>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="hsl(var(--muted))" strokeWidth={stroke} />
        <circle
          cx={size / 2} cy={size / 2} r={r} fill="none" stroke="url(#ringGrad)" strokeWidth={stroke}
          strokeLinecap="round" strokeDasharray={`${dash} ${c - dash}`}
          style={{ transition: "stroke-dasharray 900ms cubic-bezier(0.22,1,0.36,1)" }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="font-serif text-3xl text-foreground tabular-nums">{clamped}%</span>
        <span className="text-[10px] uppercase tracking-wider text-muted-foreground">complete</span>
      </div>
    </div>
  );
}

export default function DashboardPage() {
  const queryClient = useQueryClient();

  // New monthly stats endpoint — driven by Google Calendar "T-Sprint for..."
  // events + the email_drafts table. Replaces the legacy /stats/overview
  // which counted from the sprintsTable.
  type DashStats = {
    myTSprints: number; scheduled: number; completed: number; completionRate: number;
    emailsSentMonth: number; upcomingThisWeek: number;
    sprintEvents: { id: string; title: string; startISO: string; endISO: string; isPast: boolean; manual?: boolean }[];
    otherEvents?: { id: string; title: string; startISO: string; endISO: string; isPast: boolean }[];
  };
  const { data: stats, isLoading: statsLoading } = useQuery<DashStats>({
    queryKey: ["/api/stats/dashboard"],
    queryFn: () => customFetch<DashStats>(`${BASE}/api/stats/dashboard`, { credentials: "include" }),
    staleTime: 30_000,
  });

  // Manually mark / un-mark a calendar event as a T-Sprint (for events not
  // named "T-Sprint for ...").
  const markSprint = useMutation({
    mutationFn: async (ev: { id: string; title: string; startISO: string; endISO: string; marked: boolean }) => {
      const res = await fetch(`${BASE}/api/calendar/sprint-marks`, {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ googleEventId: ev.id, title: ev.title, startISO: ev.startISO, endISO: ev.endISO, marked: ev.marked }),
      });
      if (!res.ok) throw new Error("Failed to update mark");
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/stats/dashboard"] }),
  });

  // 7-day window of Google Calendar events so the dashboard reflects the
  // consultant's upcoming week. Raw query because the generated client
  // doesn't expose the `days` param.
  const calendarQuery = useQuery<CalEvent[]>({
    queryKey: ["/api/calendar/events", { days: 7 }],
    queryFn: () => customFetch<CalEvent[]>(`${BASE}/api/calendar/events?days=7`, { credentials: "include" }),
    staleTime: 60_000,
  });
  const events = calendarQuery.data;
  const eventsLoading = calendarQuery.isLoading;
  const { data: user } = useGetMe();

  const today = format(new Date(), "EEEE · d MMMM yyyy").toUpperCase();
  const firstName = user?.name?.split(" ")[0] ?? "there";
  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";

  // Pipeline composition for the right-rail bars — now driven by monthly stats.
  const myTotal = stats?.myTSprints ?? 0;
  const pct = (n: number) => myTotal > 0 ? Math.round((n / myTotal) * 100) : 0;
  const pipeline = [
    { stage: "Scheduled",  count: stats?.scheduled ?? 0,       pct: pct(stats?.scheduled ?? 0) },
    { stage: "This Week",  count: stats?.upcomingThisWeek ?? 0, pct: pct(stats?.upcomingThisWeek ?? 0) },
    { stage: "Completed",  count: stats?.completed ?? 0,        pct: pct(stats?.completed ?? 0) },
  ];

  // Recent T-Sprints table now uses the calendar event list from stats.
  const recentSprints = (stats?.sprintEvents ?? []).slice(0, 5);
  const sprintsLoading = statsLoading;

  // Editorial rebrand — same warm-ivory / charcoal / Newsreader-serif language
  // as the sign-in page. We re-skin the homepage by overriding the theme's CSS
  // variables (and display fonts) on this wrapper; every existing Tailwind
  // class below inherits the new palette automatically, so no markup logic
  // changes. Other pages keep the original theme.
  const homeTheme: any = {
    "--background": "40 30% 96%",
    "--card": "0 0% 100%",
    "--card-foreground": "240 6% 16%",
    "--card-border": "40 22% 89%",
    "--border": "40 20% 88%",
    "--foreground": "240 6% 16%",
    "--muted": "40 24% 95%",
    "--muted-foreground": "43 8% 40%",
    "--primary": "240 6% 16%",
    "--primary-foreground": "40 30% 97%",
    "--input": "40 20% 86%",
    "--ring": "240 6% 30%",
    "--app-font-serif": "'Newsreader', Georgia, 'Times New Roman', serif",
    "--app-font-sans": "'Archivo', ui-sans-serif, system-ui, sans-serif",
    fontFamily: "'Archivo', ui-sans-serif, system-ui, sans-serif",
  };

  return (
    <Layout>
      <ResearchCopilotDock />
      <div className="ts-home" style={homeTheme}>
      <main className="flex-1 space-y-8 px-6 py-8 lg:px-10 max-w-[1400px] mx-auto">
        {/* Greeting */}
        <section className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <div className="text-[11px] font-bold uppercase tracking-[0.22em] text-muted-foreground">
              {today}
            </div>
            <h1 className="mt-2 font-serif text-5xl leading-[1.02] text-foreground">
              {greeting}, <span className="italic">{firstName}</span>.
            </h1>
            <p className="mt-2 text-sm text-muted-foreground">
              Here's what's on your plate today — only sprints aligned to you are shown below.
            </p>
          </div>
          <div className="flex items-center gap-2 rounded-lg border border-border bg-card px-4 py-2.5">
            <span className="h-2 w-2 rounded-full" style={{ background: "var(--success)" }} />
            <span className="text-sm text-foreground">All integrations connected</span>
            <span className="text-xs text-muted-foreground">· Calendar · Gmail · Drive</span>
          </div>
        </section>

        {/* Stats — 4 cards driven by Google Calendar (T-Sprint for...) +
            email_drafts.sent_at. All values are scoped to the current
            calendar month, refreshed every 30s. */}
        <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {statsLoading ? (
            Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-28 rounded-xl" />)
          ) : (
            <>
              <StatCard label="My T-Sprints"
                        value={stats?.myTSprints ?? 0}
                        trend={`From Google Calendar · ${format(new Date(), "MMMM")}`} />
              <StatCard label="Scheduled"
                        value={stats?.scheduled ?? 0}
                        trend="Upcoming this month" />
              <StatCard label="Completion Rate"
                        value={`${stats?.completionRate ?? 0}%`}
                        delta={`${stats?.completed ?? 0} completed`} tone="up"
                        trend="Post-email sent this month" />
              <StatCard label="Emails This Month"
                        value={stats?.emailsSentMonth ?? 0}
                        trend="Sent from the suite" />
            </>
          )}
        </section>

        {/* 2-col layout: schedule + pipeline */}
        <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
          {/* Today's Schedule — spans 2 columns */}
          <section className="rounded-xl border border-card-border bg-card xl:col-span-2">
            <header className="flex items-center justify-between border-b border-border px-6 py-4">
              <div>
                <h2 className="font-serif text-xl text-foreground">Today's Schedule</h2>
                <p className="text-xs text-muted-foreground">
                  Pulled from Google Calendar
                  {events && events.length > 0 && ` · ${events.length} session${events.length === 1 ? "" : "s"} this week`}
                </p>
              </div>
              <div className="flex items-center gap-3">
                <button
                  onClick={() => queryClient.invalidateQueries({ queryKey: ["/api/calendar/events", { days: 7 }] })}
                  title="Refresh from Google Calendar"
                  className="p-1 text-muted-foreground hover:text-primary transition"
                >
                  <RefreshCw size={12} className={calendarQuery.isFetching ? "animate-spin" : ""} />
                </button>
                <Link href="/sprint-tracking" className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline">
                  Open calendar <ChevronRight className="h-3 w-3" />
                </Link>
              </div>
            </header>

            {eventsLoading ? (
              <div className="space-y-3 p-6">
                {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-16 rounded-lg" />)}
              </div>
            ) : events && events.length > 0 ? (
              <div className="max-h-[480px] overflow-y-auto">
                {groupByDay(events).map(group => (
                  <div key={group.dateKey}>
                    <div className="flex items-baseline gap-2 px-6 py-3 bg-muted/40 border-b border-border">
                      <h3 className="text-xs font-semibold uppercase tracking-wider text-foreground">{group.label}</h3>
                      <span className="text-[10px] text-muted-foreground">
                        {group.events.length} session{group.events.length === 1 ? "" : "s"}
                      </span>
                    </div>
                    <ul className="divide-y divide-border">
                      {group.events.map(event => (
                        <li
                          key={event.id}
                          data-testid={`card-event-${event.id}`}
                          className="flex items-center gap-5 px-6 py-4 transition-colors hover:bg-muted/40"
                        >
                          <div className="w-14 font-mono text-sm text-muted-foreground">
                            {event.isAllDay ? "—" : format(parseISO(event.startTime), "HH:mm")}
                          </div>
                          <div className="h-10 w-px bg-border" />
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="font-medium text-foreground truncate">{event.title}</span>
                              <span className="rounded border border-border bg-background px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                                {event.source === "google" ? "GCAL" : "SPRINT"}
                              </span>
                            </div>
                            <div className="mt-0.5 flex items-center gap-3 text-xs text-muted-foreground flex-wrap">
                              {!event.isAllDay && (
                                <span className="inline-flex items-center gap-1">
                                  <Clock size={11} />
                                  {format(parseISO(event.startTime), "h:mm a")} – {format(parseISO(event.endTime), "h:mm a")}
                                </span>
                              )}
                              {event.location && !event.location.startsWith("http") && (
                                <span className="inline-flex items-center gap-1 truncate max-w-[200px]" title={event.location}>
                                  <MapPin size={11} />{event.location}
                                </span>
                              )}
                            </div>
                          </div>
                          {event.meetLink ? (
                            <a
                              href={event.meetLink}
                              target="_blank"
                              rel="noreferrer"
                              className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-muted"
                            >
                              <Video size={11} /> Join
                            </a>
                          ) : (
                            <span className="text-xs text-muted-foreground">—</span>
                          )}
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center py-12 px-6">
                <Calendar size={32} className="mx-auto text-muted-foreground/40 mb-2" />
                <p className="text-sm text-muted-foreground">No sessions scheduled this week</p>
                <p className="text-xs text-muted-foreground/60 mt-1">Connect Google Calendar in Settings to sync</p>
              </div>
            )}
          </section>

          {/* Pipeline — gradient progress bars, gold middle bar like the lovable design */}
          <section className="rounded-xl border border-card-border bg-card">
            <header className="flex items-center justify-between border-b border-border px-6 py-4">
              <div>
                <h2 className="font-serif text-xl text-foreground">Sprint Pipeline</h2>
                <p className="text-xs text-muted-foreground">
                  {myTotal} this month · {stats?.completionRate ?? 0}% completion
                </p>
              </div>
              <TrendingUp className="h-4 w-4 text-muted-foreground" />
            </header>
            <div className="space-y-4 px-6 py-5">
              <div className="flex items-center justify-center pb-1">
                <CompletionRing pct={stats?.completionRate ?? 0} />
              </div>
              {pipeline.map((p, i) => (
                <div key={p.stage}>
                  <div className="mb-1.5 flex items-baseline justify-between text-sm">
                    <span className="text-foreground">{p.stage}</span>
                    <span className="font-mono text-xs text-muted-foreground">
                      {p.count} · {p.pct}%
                    </span>
                  </div>
                  <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                    <div
                      className="h-full rounded-full transition-all"
                      style={{
                        width: `${p.pct}%`,
                        background: i === 1
                          ? "var(--gold)"
                          : "linear-gradient(90deg, hsl(var(--primary)), hsl(222 45% 35%))",
                      }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </section>
        </div>

        {/* My T-Sprints this month — straight from Google Calendar.
            "T-Sprint for ..." event title is the filter. Past events are
            shown with a Completed/Pending indicator based on the post-email
            flag in the DB (handled server-side in the stats endpoint). */}
        <section className="rounded-xl border border-card-border bg-card">
          <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-6 py-4">
            <div>
              <h2 className="font-serif text-xl text-foreground">My T-Sprints This Month</h2>
              <p className="text-xs text-muted-foreground">From Google Calendar · auto-detected "T-Sprint for ..." + manually marked</p>
            </div>
            <Link href="/sprint-tracking" className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline">
              View tracking <ArrowUpRight size={11} />
            </Link>
          </header>

          {sprintsLoading ? (
            <div className="space-y-3 p-6">
              {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-14 rounded-lg" />)}
            </div>
          ) : recentSprints.length === 0 ? (
            <div className="text-center py-12">
              <p className="text-sm text-muted-foreground">No T-Sprint sessions in your calendar this month.</p>
              <p className="text-[11px] text-muted-foreground/70 mt-1">
                Tip: name your calendar events "T-Sprint for {"{Company Name}"}" so they appear here.
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-muted/40 text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                    <th className="px-6 py-3">Event Title</th>
                    <th className="px-4 py-3">Date</th>
                    <th className="px-4 py-3">Time</th>
                    <th className="px-4 py-3">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {recentSprints.map(ev => {
                    const start = ev.startISO ? new Date(ev.startISO) : null;
                    return (
                      <tr
                        key={ev.id}
                        data-testid={`card-sprint-${ev.id}`}
                        className="border-b border-border last:border-0 transition-colors hover:bg-muted/30"
                      >
                        <td className="px-6 py-4">
                          <div className="font-medium text-foreground flex items-center gap-2">
                            {ev.title}
                            {ev.manual && <span className="text-[9px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-300">Manual</span>}
                          </div>
                        </td>
                        <td className="px-4 py-4 font-mono text-xs text-muted-foreground">
                          {start ? format(start, "d MMM yyyy") : "—"}
                        </td>
                        <td className="px-4 py-4 font-mono text-xs text-muted-foreground">
                          {start ? format(start, "h:mm a") : "—"}
                        </td>
                        <td className="px-4 py-4">
                          <div className="flex items-center gap-2">
                            {ev.isPast ? <StatusChip status="completed" /> : <StatusChip status="scheduled" />}
                            {ev.manual && (
                              <button
                                onClick={() => markSprint.mutate({ id: ev.id, title: ev.title, startISO: ev.startISO, endISO: ev.endISO, marked: false })}
                                className="text-[10px] text-muted-foreground hover:text-destructive underline"
                                title="Remove the manual T-Sprint mark"
                              >
                                unmark
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {/* Other calendar events this month — let the consultant mark any of
              them as a T-Sprint even if not named "T-Sprint for ...". */}
          {(stats?.otherEvents?.length ?? 0) > 0 && (
            <details className="border-t border-border px-6 py-4">
              <summary className="cursor-pointer text-xs font-medium text-muted-foreground hover:text-foreground">
                Other calendar events this month ({stats!.otherEvents!.length}) — mark any as a T-Sprint
              </summary>
              <ul className="mt-3 space-y-1.5">
                {stats!.otherEvents!.map(ev => {
                  const start = ev.startISO ? new Date(ev.startISO) : null;
                  return (
                    <li key={ev.id} className="flex items-center justify-between gap-3 rounded-md border border-border px-3 py-2">
                      <div className="min-w-0">
                        <div className="text-sm text-foreground truncate">{ev.title || "(no title)"}</div>
                        <div className="text-[11px] text-muted-foreground">{start ? format(start, "d MMM yyyy · h:mm a") : "—"}</div>
                      </div>
                      <button
                        onClick={() => markSprint.mutate({ id: ev.id, title: ev.title, startISO: ev.startISO, endISO: ev.endISO, marked: true })}
                        disabled={markSprint.isPending}
                        className="whitespace-nowrap rounded-md border border-primary/30 bg-primary/5 px-2.5 py-1 text-[11px] font-medium text-primary hover:bg-primary/10 disabled:opacity-50"
                      >
                        + Mark as T-Sprint
                      </button>
                    </li>
                  );
                })}
              </ul>
            </details>
          )}
        </section>

        <footer className="pt-2 text-center text-xs text-muted-foreground">
          Thinking Spree · Consultant Suite · Internal use only
        </footer>
      </main>
      <style>{`
        .ts-home {
          min-height: 100%;
          background-color: #F5F2EC;
          background-image: radial-gradient(rgba(38,38,43,0.045) 0.6px, transparent 0.6px);
          background-size: 30px 30px;
        }
        .ts-home .rounded-xl { border-radius: 16px; }
        .ts-home h1, .ts-home h2, .ts-home h3 { letter-spacing: -0.01em; }
      `}</style>
      </div>
    </Layout>
  );
}
