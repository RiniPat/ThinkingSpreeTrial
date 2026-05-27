import {
  useGetStatsOverview, useListSprints, useGetMe,
  customFetch,
} from "@workspace/api-client-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Layout } from "@/components/Layout";
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
  return (
    <div
      data-testid={`card-stat-${label.toLowerCase().replace(/\s+/g, "-")}`}
      className="group relative overflow-hidden rounded-xl border border-card-border bg-card p-5 transition-shadow hover:shadow-sm"
    >
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

export default function DashboardPage() {
  const queryClient = useQueryClient();
  const { data: stats, isLoading: statsLoading } = useGetStatsOverview();
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
  const { data: sprints, isLoading: sprintsLoading } = useListSprints();
  const { data: user } = useGetMe();

  // Sprints come back already scoped to this user from the backend.
  // We show the 5 most recent (already DESC sorted server-side).
  const recentSprints = sprints?.slice(0, 5) ?? [];
  const today = format(new Date(), "EEEE · d MMMM yyyy").toUpperCase();
  const firstName = user?.name?.split(" ")[0] ?? "there";
  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";

  // Pipeline composition for the right-rail bars. We derive what we can from
  // the stats overview; if stats aren't loaded yet, the bars render at 0.
  const totalSprints = stats?.totalSprints ?? 0;
  const pct = (n: number) => totalSprints > 0 ? Math.round((n / totalSprints) * 100) : 0;
  const pipeline = [
    { stage: "Scheduled",  count: stats?.scheduledSprints ?? 0, pct: pct(stats?.scheduledSprints ?? 0) },
    { stage: "This Week",  count: stats?.upcomingThisWeek ?? 0, pct: pct(stats?.upcomingThisWeek ?? 0) },
    { stage: "Completed",  count: stats?.completedSprints ?? 0, pct: pct(stats?.completedSprints ?? 0) },
  ];

  return (
    <Layout>
      <main className="flex-1 space-y-8 px-6 py-8 lg:px-10 max-w-[1400px] mx-auto">
        {/* Greeting */}
        <section className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <div className="text-xs uppercase tracking-[0.2em] text-muted-foreground">
              {today}
            </div>
            <h1 className="mt-2 font-serif text-4xl text-foreground">
              {greeting}, <span className="italic text-primary">{firstName}</span>.
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Here's what's on your plate today — only sprints aligned to you are shown below.
            </p>
          </div>
          <div className="flex items-center gap-2 rounded-lg border border-border bg-card px-4 py-2.5">
            <span className="h-2 w-2 rounded-full" style={{ background: "var(--success)" }} />
            <span className="text-sm text-foreground">All integrations connected</span>
            <span className="text-xs text-muted-foreground">· Calendar · Gmail · Drive</span>
          </div>
        </section>

        {/* Stats — 4 columns on xl, mirrors the lovable layout. */}
        <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {statsLoading ? (
            Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-28 rounded-xl" />)
          ) : (
            <>
              <StatCard label="My T-Sprints"      value={stats?.totalSprints ?? 0}        trend="Total assigned to me" />
              <StatCard label="Scheduled"         value={stats?.scheduledSprints ?? 0}    trend="Upcoming sessions" />
              <StatCard label="Completion Rate"
                        value={`${totalSprints > 0 ? Math.round(((stats?.completedSprints ?? 0) / totalSprints) * 100) : 0}%`}
                        delta={`${stats?.completedSprints ?? 0} done`} tone="up"
                        trend="Closed sprints" />
              <StatCard label="Emails This Month" value={stats?.emailsSentThisMonth ?? 0}  trend="Sent from the suite" />
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
                  {totalSprints} total · {stats?.totalFounders ?? 0} founders
                </p>
              </div>
              <TrendingUp className="h-4 w-4 text-muted-foreground" />
            </header>
            <div className="space-y-4 px-6 py-5">
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

        {/* Recent T-Sprints — table layout matches the lovable bottom table */}
        <section className="rounded-xl border border-card-border bg-card">
          <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-6 py-4">
            <div>
              <h2 className="font-serif text-xl text-foreground">My Recent T-Sprints</h2>
              <p className="text-xs text-muted-foreground">Latest assigned to me · sorted newest first</p>
            </div>
            <Link href="/companies" className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline">
              View all <ArrowUpRight size={11} />
            </Link>
          </header>

          {sprintsLoading ? (
            <div className="space-y-3 p-6">
              {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-14 rounded-lg" />)}
            </div>
          ) : recentSprints.length === 0 ? (
            <div className="text-center py-12">
              <p className="text-sm text-muted-foreground">No T-Sprints assigned to you yet</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-muted/40 text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                    <th className="px-6 py-3">Venture</th>
                    <th className="px-4 py-3">Founder</th>
                    <th className="px-4 py-3">Date</th>
                    <th className="px-4 py-3">Host</th>
                    <th className="px-4 py-3">Status</th>
                    <th className="px-6 py-3 text-right">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {recentSprints.map(sprint => (
                    <tr
                      key={sprint.id}
                      data-testid={`card-sprint-${sprint.id}`}
                      className="border-b border-border last:border-0 transition-colors hover:bg-muted/30"
                    >
                      <td className="px-6 py-4">
                        <div className="font-medium text-foreground">{sprint.companyName}</div>
                      </td>
                      <td className="px-4 py-4 text-muted-foreground">{sprint.founderName}</td>
                      <td className="px-4 py-4 font-mono text-xs text-muted-foreground">
                        {sprint.scheduledDate}
                      </td>
                      <td className="px-4 py-4 text-muted-foreground">
                        {sprint.sprintHost && sprint.sprintHost !== sprint.consultantName
                          ? sprint.sprintHost
                          : "—"}
                      </td>
                      <td className="px-4 py-4">
                        <StatusChip status={sprint.status} />
                      </td>
                      <td className="px-6 py-4 text-right">
                        <Link
                          href={`/sprints/${sprint.id}`}
                          className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
                        >
                          Open <ChevronRight className="h-3 w-3" />
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <footer className="pt-2 text-center text-xs text-muted-foreground">
          Thinking Spree · Consultant Suite v4.1 · Internal use only
        </footer>
      </main>
    </Layout>
  );
}
