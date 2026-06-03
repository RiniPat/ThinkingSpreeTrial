import { useState, useMemo, useEffect, type ReactNode } from "react";
import { useListIncubators, useUpdateSprint, getListSprintsQueryKey, customFetch } from "@workspace/api-client-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { useLocation } from "wouter";
import { Layout } from "@/components/Layout";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Activity, CheckCircle, Clock, XCircle, Zap, ChevronRight, Search,
  User, Calendar as CalendarIcon, TrendingUp, Filter, X, ArrowUpDown,
  LayoutGrid, Table as TableIcon, ChevronUp, ChevronDown, RotateCcw, Loader2,
  Users, Download, RefreshCw, Trash2, Plus,
} from "lucide-react";
import { format, parseISO, isThisWeek, isThisMonth } from "date-fns";

const BASE = (import.meta as any).env?.BASE_URL?.replace(/\/$/, "") ?? "";

// ─── Types ────────────────────────────────────────────────────────────────
type Sprint = {
  id: number; founderId: number; founderName: string; companyName: string;
  industry?: string | null; stage?: string | null;
  programName?: string | null; partnerName?: string | null;
  scheduledDate: string; scheduledTime?: string | null; endTime?: string | null;
  totalDuration?: string | null;
  consultantName: string; sprintHost?: string | null; coHost?: string | null;
  status: string;
  sprintNumber?: number | null;
  sessionType?: string | null;
  paymentStatus?: string | null;
  billedTo?: string | null;
  price?: string | number | null;
  billNumber?: string | null;
  cyYear?: number | null; month?: number | null; week?: number | null; quarter?: string | null;
  strengths?: string | null; gaps?: string | null; nextGoal?: string | null;
};

type SortKey = "date" | "company" | "host" | "status" | "sprintNumber";
type SortDir = "asc" | "desc";

const STATUS_CONFIG = {
  completed: { icon: CheckCircle, color: "text-emerald-600 dark:text-emerald-400", bg: "bg-emerald-100 dark:bg-emerald-900/30", label: "Completed" },
  scheduled: { icon: Clock,       color: "text-blue-600 dark:text-blue-400",       bg: "bg-blue-100 dark:bg-blue-900/30",       label: "Scheduled" },
  cancelled: { icon: XCircle,     color: "text-red-600 dark:text-red-400",          bg: "bg-red-100 dark:bg-red-900/30",          label: "Cancelled" },
};

// Common dropdown choices for the daily-update fields. Consultants will be
// updating these inline after each sprint, so it's important that the picker
// shows the same options across the team.
const SESSION_TYPE_CHOICES = ["Need Assessment", "Strategy", "Fundraising", "Market Access", "Mentorship", "Review", "Other"];
// Payment Status — matched to the Live Sprint Tracking sheet's dropdown.
const PAYMENT_CHOICES = ["Received", "NA", "Pending", "Bill Raised"];
// Stage of business — from the sheet. Editable: any typed/legacy value is kept.
const STAGE_CHOICES = ["Idea", "MVP", "Prototype", "Early Traction", "Early Growth", "Growth", "Business Expansion", "Market Expansion", "1:many"];
// "Billed to" — from the sheet.
const BILLED_TO_CHOICES = ["National Entreprenurship Network", "Ashoka", "ISB", "JU", "TISS", "Elecroom", "WInspire"];

/** Program "family" = the first word of the program name, so "Wadhwani 11.1",
 *  "Wadhwani 4.2", etc. all collapse to a single "Wadhwani" option. */
function programFamily(name?: string | null): string | null {
  if (!name) return null;
  const t = name.trim();
  return t ? t.split(/\s+/)[0] : null;
}

function exportCsv(rows: Sprint[]) {
  const cols: Array<[string, (s: Sprint) => string]> = [
    ["Date",         s => s.scheduledDate ?? ""],
    ["Time",         s => s.scheduledTime ?? ""],
    ["Company",      s => s.companyName ?? ""],
    ["Founder",      s => s.founderName ?? ""],
    ["Industry",     s => s.industry ?? ""],
    ["Stage",        s => s.stage ?? ""],
    ["Program",      s => s.programName ?? ""],
    ["Partner",      s => s.partnerName ?? ""],
    ["Host",         s => s.sprintHost ?? s.consultantName ?? ""],
    ["Co-Host",      s => s.coHost ?? ""],
    ["Sprint #",     s => s.sprintNumber != null ? String(s.sprintNumber) : ""],
    ["Session Type", s => s.sessionType ?? ""],
    ["Payment",      s => s.paymentStatus ?? ""],
    ["Status",       s => s.status ?? ""],
  ];
  const escape = (v: string) => /[,"\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
  const csv = [
    cols.map(c => c[0]).join(","),
    ...rows.map(r => cols.map(c => escape(c[1](r))).join(",")),
  ].join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `sprint-tracking-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

// ─── Components ───────────────────────────────────────────────────────────
function StatsStrip({ sprints }: { sprints: Sprint[] }) {
  const completed = sprints.filter(s => s.status === "completed").length;
  const scheduled = sprints.filter(s => s.status === "scheduled").length;
  const thisWeek = sprints.filter(s => {
    try { return isThisWeek(parseISO(s.scheduledDate + "T00:00:00")); } catch { return false; }
  }).length;
  const thisMonth = sprints.filter(s => {
    try { return isThisMonth(parseISO(s.scheduledDate + "T00:00:00")); } catch { return false; }
  }).length;

  const items = [
    { label: "Showing",     value: sprints.length, color: "text-foreground", icon: Zap },
    { label: "Completed",   value: completed,      color: "text-emerald-600 dark:text-emerald-400", icon: CheckCircle },
    { label: "Scheduled",   value: scheduled,      color: "text-blue-600 dark:text-blue-400", icon: Clock },
    { label: "This Week",   value: thisWeek,       color: "text-violet-600 dark:text-violet-400", icon: CalendarIcon },
    { label: "This Month",  value: thisMonth,      color: "text-amber-600 dark:text-amber-400", icon: TrendingUp },
    { label: "Analysis",    value: sprints.filter(s => s.strengths || s.gaps || s.nextGoal).length, color: "text-primary", icon: Activity },
  ];
  return (
    <div className="grid grid-cols-3 lg:grid-cols-6 gap-3 mb-6">
      {items.map(({ label, value, color, icon: Icon }) => (
        <div key={label} className="bg-card border border-card-border rounded-xl p-3.5 text-center">
          <Icon size={14} className={`mx-auto mb-1 ${color}`} />
          <p className={`text-2xl font-bold tabular-nums ${color}`}>{value}</p>
          <p className="text-[11px] text-muted-foreground mt-0.5 uppercase tracking-wide">{label}</p>
        </div>
      ))}
    </div>
  );
}

function SprintCard({ sprint, onClick }: { sprint: Sprint; onClick: () => void }) {
  const sc = STATUS_CONFIG[sprint.status as keyof typeof STATUS_CONFIG] ?? STATUS_CONFIG.scheduled;
  const hasAnalysis = !!(sprint.strengths || sprint.gaps || sprint.nextGoal);
  return (
    <div onClick={onClick}
      className="bg-card border border-card-border rounded-xl p-4 hover:border-primary/40 hover:shadow-md transition-all cursor-pointer group">
      <div className="flex items-start justify-between gap-2 mb-2.5">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5 flex-wrap">
            <h3 className="font-semibold text-foreground text-sm truncate">{sprint.companyName}</h3>
            {sprint.sprintNumber != null && (
              <span className="text-[10px] font-medium bg-muted text-muted-foreground px-1.5 py-0.5 rounded">
                #{sprint.sprintNumber}
              </span>
            )}
          </div>
          <p className="text-xs text-muted-foreground mt-0.5 truncate">{sprint.founderName}</p>
        </div>
        <span className={`flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-full whitespace-nowrap ${sc.bg} ${sc.color}`}>
          <sc.icon size={10} />{sc.label}
        </span>
      </div>

      <div className="space-y-1 mb-2.5">
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <CalendarIcon size={10} />
          {format(parseISO(sprint.scheduledDate + "T00:00:00"), "d MMM yyyy")}
          {sprint.scheduledTime && <span>· {sprint.scheduledTime}</span>}
        </div>
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <User size={10} />
          {sprint.sprintHost ?? sprint.consultantName}
          {sprint.coHost && <span className="text-muted-foreground/60">+ {sprint.coHost}</span>}
        </div>
        {sprint.programName && (
          <div className="text-[11px] text-muted-foreground/80 truncate">
            <span className="font-medium">Program:</span> {sprint.programName}
          </div>
        )}
      </div>

      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          {sprint.sessionType && (
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-secondary text-secondary-foreground">{sprint.sessionType}</span>
          )}
          {hasAnalysis && (
            <span className="flex items-center gap-0.5 text-[10px] text-emerald-600 dark:text-emerald-400">
              <Activity size={10} />Analysis
            </span>
          )}
        </div>
        <ChevronRight size={13} className="text-muted-foreground group-hover:text-primary transition-colors" />
      </div>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────
export default function SprintTrackingPage() {
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  // The Sprint Tracking page is the team-wide live register. By default it shows
  // EVERY sprint (scope=all) — matching the master "Sheet Tracking" workbook.
  // Consultants can flip to "Mine only" if they want their own view.
  const [scope, setScope] = useState<"all" | "mine">("all");
  const [addOpen, setAddOpen] = useState(false);
  const [page, setPage] = useState(0);
  const PAGE_SIZE = 50;
  const sprintsQuery = useQuery<Sprint[]>({
    queryKey: ["/api/sprints", scope],
    queryFn: () => customFetch<Sprint[]>(`${BASE}/api/sprints?scope=${scope}`, { credentials: "include" }),
    staleTime: 30_000,
  });
  const isLoading = sprintsQuery.isLoading;
  const sprintsData = sprintsQuery.data;
  const { data: incubators } = useListIncubators();
  const sprints: Sprint[] = (sprintsData ?? []) as Sprint[];

  // ─── Sprint Template companies (v4.8) ─────────────────────────────────
  // Top-of-page section listing the Sprint-Template-ingested companies
  // grouped by cohort, with workflow stage shown for each. This is a
  // different data source from the legacy `sprints` table below — these
  // are the new-style companies with stageWorkflow + Google Sheets sync.
  type SprintCompany = {
    id: number;
    companyName: string;
    founderName: string;
    cohortName: string | null;
    stageWorkflow: string;
    sprintHost: string | null;
  };
  const companiesQuery = useQuery<{ companies: SprintCompany[] }>({
    queryKey: ["/api/companies"],
    queryFn: () => customFetch(`${BASE}/api/companies`, { credentials: "include" }),
    staleTime: 30_000,
  });
  const sprintCompanies = companiesQuery.data?.companies ?? [];
  const companiesByCohort = useMemo(() => {
    const map = new Map<string, SprintCompany[]>();
    for (const c of sprintCompanies) {
      const key = c.cohortName ?? "Uncategorised";
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(c);
    }
    return Array.from(map.entries()).sort(([a],[b]) => {
      if (a === "Uncategorised") return 1;
      if (b === "Uncategorised") return -1;
      return a.localeCompare(b);
    });
  }, [sprintCompanies]);

  // ─── Filter state — mirrors Sheet Tracking columns ─────────────────────
  const [searchText, setSearchText]   = useState("");
  const [status, setStatus]           = useState<"all"|"scheduled"|"completed"|"cancelled">("all");
  const [industry, setIndustry]       = useState("all");
  const [stage, setStage]             = useState("all");
  const [program, setProgram]         = useState("all");
  const [partner, setPartner]         = useState("all");
  const [host, setHost]               = useState("all");
  const [coHost, setCoHost]           = useState("all");
  const [sessionType, setSessionType] = useState("all");
  const [payment, setPayment]         = useState("all");
  const [year, setYear]               = useState("all");
  const [quarter, setQuarter]         = useState("all");
  const [month, setMonth]             = useState("all");
  const [dateFrom, setDateFrom]       = useState("");
  const [dateTo, setDateTo]           = useState("");

  // Sort — default: most recent date first
  const [sortKey, setSortKey] = useState<SortKey>("date");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [view, setView] = useState<"cards" | "table">("table");

  // Build distinct option lists from data
  const opts = useMemo(() => {
    const dedup = <T,>(arr: (T | null | undefined)[]) => [...new Set(arr.filter(Boolean) as T[])].sort();
    return {
      industries:   dedup(sprints.map(s => s.industry)),
      stages:       dedup(sprints.map(s => s.stage)),
      programs:     dedup(sprints.map(s => programFamily(s.programName))),
      partners:     dedup(sprints.map(s => s.partnerName)),
      hosts:        dedup(sprints.map(s => s.sprintHost ?? s.consultantName)),
      coHosts:      dedup(sprints.map(s => s.coHost)),
      sessionTypes: dedup(sprints.map(s => s.sessionType)),
      payments:     dedup(sprints.map(s => s.paymentStatus)),
      years:        dedup(sprints.map(s => s.cyYear?.toString())),
      quarters:     ["Q1","Q2","Q3","Q4"],
      months:       Array.from({ length: 12 }, (_, i) => String(i + 1)),
    };
  }, [sprints]);

  const filtered = useMemo(() => {
    const q = searchText.trim().toLowerCase();
    return sprints.filter(s => {
      if (q && !`${s.companyName} ${s.founderName} ${s.consultantName ?? ""}`.toLowerCase().includes(q)) return false;
      if (status !== "all" && s.status !== status) return false;
      if (industry !== "all" && s.industry !== industry) return false;
      if (stage !== "all" && s.stage !== stage) return false;
      if (program !== "all" && programFamily(s.programName) !== program) return false;
      if (partner !== "all" && s.partnerName !== partner) return false;
      if (host !== "all" && (s.sprintHost ?? s.consultantName) !== host) return false;
      if (coHost !== "all" && s.coHost !== coHost) return false;
      if (sessionType !== "all" && s.sessionType !== sessionType) return false;
      if (payment !== "all" && s.paymentStatus !== payment) return false;
      if (year !== "all" && String(s.cyYear) !== year) return false;
      if (quarter !== "all" && s.quarter !== quarter) return false;
      if (month !== "all" && String(s.month) !== month) return false;
      if (dateFrom && s.scheduledDate < dateFrom) return false;
      if (dateTo && s.scheduledDate > dateTo) return false;
      return true;
    });
  }, [sprints, searchText, status, industry, stage, program, partner, host, coHost, sessionType, payment, year, quarter, month, dateFrom, dateTo]);

  // Sort
  const sorted = useMemo(() => {
    const out = [...filtered];
    const dir = sortDir === "asc" ? 1 : -1;
    out.sort((a, b) => {
      let cmp = 0;
      if (sortKey === "date") cmp = a.scheduledDate.localeCompare(b.scheduledDate);
      else if (sortKey === "company") cmp = a.companyName.localeCompare(b.companyName);
      else if (sortKey === "host") cmp = (a.sprintHost ?? a.consultantName).localeCompare(b.sprintHost ?? b.consultantName);
      else if (sortKey === "status") cmp = a.status.localeCompare(b.status);
      else if (sortKey === "sprintNumber") cmp = (a.sprintNumber ?? 0) - (b.sprintNumber ?? 0);
      return cmp * dir;
    });
    return out;
  }, [filtered, sortKey, sortDir]);

  // Pagination — render one page at a time so the DOM stays light even when the
  // team-wide register has thousands of rows.
  const pageCount = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
  useEffect(() => { if (page > pageCount - 1) setPage(0); }, [pageCount, page]);
  const pageRows = useMemo(
    () => sorted.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE),
    [sorted, page],
  );

  function toggleSort(k: SortKey) {
    if (sortKey === k) setSortDir(d => d === "asc" ? "desc" : "asc");
    else { setSortKey(k); setSortDir(k === "date" ? "desc" : "asc"); }
  }

  function resetFilters() {
    setSearchText(""); setStatus("all"); setIndustry("all"); setStage("all");
    setProgram("all"); setPartner("all"); setHost("all"); setCoHost("all");
    setSessionType("all"); setPayment("all"); setYear("all"); setQuarter("all");
    setMonth("all"); setDateFrom(""); setDateTo("");
  }
  const activeFilterCount = [
    status, industry, stage, program, partner, host, coHost, sessionType, payment, year, quarter, month,
  ].filter(v => v !== "all").length + (dateFrom ? 1 : 0) + (dateTo ? 1 : 0) + (searchText.trim() ? 1 : 0);

  return (
    <Layout>
      <div className="p-6 max-w-7xl mx-auto">
        <div className="mb-6 flex items-end justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-2xl font-bold text-foreground">Sprint Tracking</h1>
            <p className="text-sm text-muted-foreground mt-0.5">
              {scope === "all"
                ? "Live register of every T-Sprint across the team — update inline as you go."
                : "Sprints aligned to you (host, co-host, or consultant)."}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {/* Scope toggle: Everyone vs Mine */}
            <div className="flex items-center gap-1 bg-card border border-card-border rounded-lg p-0.5">
              <button onClick={() => setScope("all")} title="All consultants"
                className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded transition ${
                  scope === "all" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
                }`}>
                <Users size={13} />Everyone
              </button>
              <button onClick={() => setScope("mine")} title="My sprints only"
                className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded transition ${
                  scope === "mine" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
                }`}>
                <User size={13} />Mine
              </button>
            </div>
            <button
              onClick={() => queryClient.invalidateQueries({ queryKey: ["/api/sprints", scope] })}
              title="Refresh"
              className="p-1.5 bg-card border border-card-border rounded-lg text-muted-foreground hover:text-foreground transition">
              <RefreshCw size={14} className={sprintsQuery.isFetching ? "animate-spin" : ""} />
            </button>
            <button
              onClick={() => exportCsv(sorted)}
              title="Export filtered view as CSV"
              className="flex items-center gap-1.5 px-3 py-1.5 bg-card border border-card-border rounded-lg text-xs font-medium text-muted-foreground hover:text-foreground transition">
              <Download size={13} />Export CSV
            </button>
            <button
              onClick={() => setAddOpen(true)}
              title="Add a startup"
              className="flex items-center gap-1.5 px-3 py-1.5 bg-primary text-primary-foreground rounded-lg text-xs font-medium hover:opacity-90 transition">
              <Plus size={13} />Add Startup
            </button>
            <div className="flex items-center gap-1 bg-card border border-card-border rounded-lg p-0.5">
              <button onClick={() => setView("table")} title="Table view"
                className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded transition ${
                  view === "table" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
                }`}>
                <TableIcon size={13} />Table
              </button>
              <button onClick={() => setView("cards")} title="Card view"
                className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded transition ${
                  view === "cards" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
                }`}>
                <LayoutGrid size={13} />Cards
              </button>
            </div>
          </div>
        </div>

        {isLoading ? (
          <div className="space-y-3">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-24 rounded-xl" />)}</div>
        ) : (
          <>
            {/* ─── Sprint Template Companies (v4.8) ─────────────────────────
                Top section: companies ingested via Google Sheets / Sprint Template,
                grouped by cohort, showing current workflow stage. Each row links
                directly into the company detail page where the consultant can
                change the stage. */}
            {sprintCompanies.length > 0 && (
              <section className="mb-6 bg-card border border-card-border rounded-xl overflow-hidden">
                <header className="flex items-center justify-between border-b border-border px-5 py-3 bg-muted/30">
                  <div>
                    <h2 className="text-sm font-semibold text-foreground">Companies by Cohort</h2>
                    <p className="text-[11px] text-muted-foreground">Workflow stage updates as you send emails / move stages on the company page.</p>
                  </div>
                  <span className="text-[11px] text-muted-foreground tabular-nums">{sprintCompanies.length} total</span>
                </header>
                <div className="divide-y divide-border">
                  {companiesByCohort.map(([cohort, cos]) => (
                    <div key={cohort} className="px-5 py-3">
                      <div className="flex items-center gap-2 mb-2">
                        <h3 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{cohort}</h3>
                        <span className="text-[10px] text-muted-foreground">· {cos.length}</span>
                      </div>
                      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-2">
                        {cos.map(c => (
                          <a key={c.id} href={`/companies/${c.id}`}
                             className="flex items-center justify-between gap-3 rounded-md border border-border bg-background/60 px-3 py-2 text-xs hover:bg-muted/50 transition">
                            <div className="min-w-0">
                              <div className="font-medium text-foreground truncate">{c.companyName}</div>
                              <div className="text-[11px] text-muted-foreground truncate">
                                {c.founderName}{c.sprintHost ? ` · Host: ${c.sprintHost}` : ""}
                              </div>
                            </div>
                            <StageBadge stage={c.stageWorkflow} />
                          </a>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            )}

            <StatsStrip sprints={sorted} />

            {/* ─── Filter bar (matches Sheet Tracking) ─── */}
            <div className="bg-card border border-card-border rounded-xl p-4 mb-5">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <Filter size={14} className="text-primary" />
                  <h3 className="text-sm font-semibold text-foreground">Filters</h3>
                  {activeFilterCount > 0 && (
                    <span className="text-[10px] font-bold bg-primary text-primary-foreground px-1.5 py-0.5 rounded-full">
                      {activeFilterCount}
                    </span>
                  )}
                </div>
                {activeFilterCount > 0 && (
                  <button onClick={resetFilters} className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
                    <RotateCcw size={11} />Reset
                  </button>
                )}
              </div>

              {/* Search */}
              <div className="relative mb-3">
                <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <input
                  value={searchText} onChange={e => setSearchText(e.target.value)}
                  placeholder="Search company, founder, or host…"
                  className="w-full pl-9 pr-9 py-2 bg-background border border-input rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-ring text-foreground placeholder:text-muted-foreground/60"
                />
                {searchText && (
                  <button onClick={() => setSearchText("")} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                    <X size={13} />
                  </button>
                )}
              </div>

              {/* Quick status chips */}
              <div className="flex flex-wrap gap-1.5 mb-3">
                {(["all","scheduled","completed","cancelled"] as const).map(f => (
                  <button key={f} onClick={() => setStatus(f)}
                    className={`px-2.5 py-1 text-xs font-medium rounded-md transition capitalize ${
                      status === f ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:text-foreground"
                    }`}>
                    {f === "all" ? "All statuses" : f}
                  </button>
                ))}
              </div>

              {/* Dropdown filters — match sheet headers */}
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2">
                <FilterDropdown label="Industry"      value={industry}     setValue={setIndustry}     options={opts.industries} />
                <FilterDropdown label="Stage"         value={stage}        setValue={setStage}        options={opts.stages} />
                <FilterDropdown label="Program"       value={program}      setValue={setProgram}      options={opts.programs} />
                <FilterDropdown label="Partner"       value={partner}      setValue={setPartner}      options={opts.partners} />
                <FilterDropdown label="Sprint Host"   value={host}         setValue={setHost}         options={opts.hosts} />
                <FilterDropdown label="Co-Host"       value={coHost}       setValue={setCoHost}       options={opts.coHosts} />
                <FilterDropdown label="Session Type"  value={sessionType}  setValue={setSessionType}  options={opts.sessionTypes} />
                <FilterDropdown label="Payment"       value={payment}      setValue={setPayment}      options={opts.payments} />
                <FilterDropdown label="CY Year"       value={year}         setValue={setYear}         options={opts.years} />
                <FilterDropdown label="Quarter"       value={quarter}      setValue={setQuarter}      options={opts.quarters} />
                <FilterDropdown label="Month"         value={month}        setValue={setMonth}        options={opts.months} renderOption={(m) => format(new Date(2000, Number(m)-1, 1), "MMM")} />
              </div>

              {/* Date range */}
              <div className="grid grid-cols-2 gap-2 mt-2">
                <div>
                  <label className="block text-[10px] font-medium uppercase tracking-wide text-muted-foreground mb-1">From</label>
                  <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)}
                    className="w-full px-2.5 py-1.5 bg-background border border-input rounded-md text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-ring" />
                </div>
                <div>
                  <label className="block text-[10px] font-medium uppercase tracking-wide text-muted-foreground mb-1">To</label>
                  <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)}
                    className="w-full px-2.5 py-1.5 bg-background border border-input rounded-md text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-ring" />
                </div>
              </div>
            </div>

            {/* ─── Results ─── */}
            {sorted.length === 0 ? (
              <div className="text-center py-16 bg-card border border-card-border rounded-xl">
                <Activity size={40} className="mx-auto text-muted-foreground/30 mb-3" />
                <p className="text-muted-foreground font-medium">No sprints match your filters</p>
                <p className="text-xs text-muted-foreground/60 mt-1">Try clearing some filters above</p>
              </div>
            ) : view === "table" ? (
              <>
                <SprintTable sorted={pageRows} sortKey={sortKey} sortDir={sortDir} toggleSort={toggleSort}
                  onRowClick={(id) => setLocation(`/sprints/${id}`)} scopeKey={scope} />
                <Pager page={page} pageCount={pageCount} total={sorted.length} pageSize={PAGE_SIZE} onPage={setPage} />
              </>
            ) : (
              <>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                  {pageRows.map(sprint => (
                    <SprintCard key={sprint.id} sprint={sprint} onClick={() => setLocation(`/sprints/${sprint.id}`)} />
                  ))}
                </div>
                <Pager page={page} pageCount={pageCount} total={sorted.length} pageSize={PAGE_SIZE} onPage={setPage} />
              </>
            )}
          </>
        )}
      </div>
      <AddStartupDialog
        open={addOpen}
        onClose={() => setAddOpen(false)}
        cohorts={(incubators ?? []).map((i: any) => i.name)}
        onAdded={() => {
          queryClient.invalidateQueries({ queryKey: ["/api/companies"] });
          queryClient.invalidateQueries({ queryKey: ["/api/sprints", scope] });
        }}
      />
    </Layout>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────
function FilterDropdown<T extends string>({
  label, value, setValue, options, renderOption,
}: {
  label: string; value: string; setValue: (v: string) => void; options: T[];
  renderOption?: (v: T) => string;
}) {
  if (options.length === 0) return null;
  return (
    <div>
      <label className="block text-[10px] font-medium uppercase tracking-wide text-muted-foreground mb-1">{label}</label>
      <select value={value} onChange={e => setValue(e.target.value)}
        className="w-full px-2.5 py-1.5 bg-background border border-input rounded-md text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-ring">
        <option value="all">All</option>
        {options.map(o => <option key={o} value={o}>{renderOption ? renderOption(o) : o}</option>)}
      </select>
    </div>
  );
}

function SortHeader({ label, k, sortKey, sortDir, toggleSort }: {
  label: string; k: SortKey; sortKey: SortKey; sortDir: SortDir; toggleSort: (k: SortKey) => void;
}) {
  const active = sortKey === k;
  return (
    <button onClick={() => toggleSort(k)} className="flex items-center gap-1 text-left hover:text-foreground transition">
      {label}
      {active ? (sortDir === "asc" ? <ChevronUp size={11} /> : <ChevronDown size={11} />) : <ArrowUpDown size={9} className="opacity-30" />}
    </button>
  );
}

const FIELD_INPUT_CLS = "w-full px-3 py-2 bg-background border border-input rounded-md text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring/30";

/** Simple pager — keeps the rendered DOM light on the team-wide register. */
function Pager({ page, pageCount, total, pageSize, onPage }: {
  page: number; pageCount: number; total: number; pageSize: number; onPage: (p: number) => void;
}) {
  if (total <= pageSize) return null;
  const from = page * pageSize + 1;
  const to = Math.min(total, (page + 1) * pageSize);
  return (
    <div className="mt-3 flex items-center justify-between gap-3 text-xs text-muted-foreground">
      <span>Showing <span className="font-medium text-foreground tabular-nums">{from}–{to}</span> of <span className="font-medium text-foreground tabular-nums">{total}</span></span>
      <div className="flex items-center gap-1">
        <button onClick={() => onPage(0)} disabled={page === 0}
          className="px-2 py-1 rounded border border-border hover:bg-muted disabled:opacity-40">« First</button>
        <button onClick={() => onPage(Math.max(0, page - 1))} disabled={page === 0}
          className="px-2 py-1 rounded border border-border hover:bg-muted disabled:opacity-40">‹ Prev</button>
        <span className="px-2 tabular-nums">Page {page + 1} / {pageCount}</span>
        <button onClick={() => onPage(Math.min(pageCount - 1, page + 1))} disabled={page >= pageCount - 1}
          className="px-2 py-1 rounded border border-border hover:bg-muted disabled:opacity-40">Next ›</button>
        <button onClick={() => onPage(pageCount - 1)} disabled={page >= pageCount - 1}
          className="px-2 py-1 rounded border border-border hover:bg-muted disabled:opacity-40">Last »</button>
      </div>
    </div>
  );
}

function Labeled({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <label className="block text-[10px] font-semibold uppercase tracking-wide text-muted-foreground mb-1">{label}</label>
      {children}
    </div>
  );
}

/** Admin "add a startup" dialog — spreadsheet-style quick add. */
function AddStartupDialog({ open, onClose, cohorts, onAdded }: {
  open: boolean; onClose: () => void; cohorts: string[]; onAdded: () => void;
}) {
  const { toast } = useToast();
  const empty = { companyName: "", founderName: "", founderEmail: "", stage: "", industry: "", cohortName: "" };
  const [form, setForm] = useState(empty);
  const [saving, setSaving] = useState(false);
  if (!open) return null;

  const submit = async () => {
    if (!form.companyName.trim()) { toast({ title: "Company name is required", variant: "destructive" }); return; }
    setSaving(true);
    try {
      const res = await fetch(`${BASE}/api/companies`, {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json" }, body: JSON.stringify(form),
      });
      if (!res.ok) throw new Error(((await res.json().catch(() => ({}))) as any).error || "Failed to add");
      toast({ title: "Startup added", description: form.companyName });
      setForm(empty); onAdded(); onClose();
    } catch (e: any) {
      toast({ title: "Couldn't add startup", description: e.message, variant: "destructive" });
    } finally { setSaving(false); }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-card border border-card-border rounded-2xl shadow-2xl w-full max-w-md" onClick={e => e.stopPropagation()}>
        <div className="px-6 py-4 border-b border-border flex items-center justify-between">
          <h3 className="font-serif text-lg text-foreground">Add Startup</h3>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground"><X size={18} /></button>
        </div>
        <div className="p-6 space-y-3">
          <Labeled label="Company Name *"><input value={form.companyName} onChange={e => setForm({ ...form, companyName: e.target.value })} className={FIELD_INPUT_CLS} placeholder="e.g. Bull AgriTech" /></Labeled>
          <div className="grid grid-cols-2 gap-3">
            <Labeled label="Founder"><input value={form.founderName} onChange={e => setForm({ ...form, founderName: e.target.value })} className={FIELD_INPUT_CLS} /></Labeled>
            <Labeled label="Email"><input value={form.founderEmail} onChange={e => setForm({ ...form, founderEmail: e.target.value })} className={FIELD_INPUT_CLS} /></Labeled>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Labeled label="Stage of business">
              <select value={form.stage} onChange={e => setForm({ ...form, stage: e.target.value })} className={FIELD_INPUT_CLS}>
                <option value="">—</option>
                {STAGE_CHOICES.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </Labeled>
            <Labeled label="Industry"><input value={form.industry} onChange={e => setForm({ ...form, industry: e.target.value })} className={FIELD_INPUT_CLS} /></Labeled>
          </div>
          <Labeled label="Cohort / Program">
            <input list="cohort-datalist" value={form.cohortName} onChange={e => setForm({ ...form, cohortName: e.target.value })} className={FIELD_INPUT_CLS} placeholder="Type or pick an existing cohort" />
            <datalist id="cohort-datalist">{cohorts.map(c => <option key={c} value={c} />)}</datalist>
          </Labeled>
        </div>
        <div className="px-6 py-4 border-t border-border flex justify-end gap-2">
          <button onClick={onClose} className="px-3 py-2 text-sm rounded-md border border-border hover:bg-muted">Cancel</button>
          <button onClick={submit} disabled={saving} className="inline-flex items-center gap-2 px-3 py-2 text-sm rounded-md bg-primary text-primary-foreground hover:opacity-90 disabled:opacity-50">
            {saving ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />} Add Startup
          </button>
        </div>
      </div>
    </div>
  );
}

/** Inline price editor — commits on blur so we don't PATCH on every keystroke. */
function PriceInput({ value, onCommit, disabled }: {
  value?: string | number | null; onCommit: (v: string | null) => void; disabled?: boolean;
}) {
  const initial = value == null ? "" : String(value);
  const [local, setLocal] = useState(initial);
  useEffect(() => { setLocal(value == null ? "" : String(value)); }, [value]);
  return (
    <input
      type="number" inputMode="decimal" value={local} disabled={disabled}
      onChange={e => setLocal(e.target.value)}
      onBlur={() => {
        const v = local.trim() === "" ? null : local.trim();
        if (v !== (value == null ? null : String(value))) onCommit(v);
      }}
      placeholder="—"
      className="w-20 text-right px-1.5 py-0.5 text-[11px] bg-transparent border border-transparent hover:border-input focus:border-input rounded focus:outline-none focus:ring-1 focus:ring-ring tabular-nums"
    />
  );
}

function SprintTable({
  sorted, sortKey, sortDir, toggleSort, onRowClick, scopeKey,
}: {
  sorted: Sprint[]; sortKey: SortKey; sortDir: SortDir;
  toggleSort: (k: SortKey) => void; onRowClick: (id: number) => void;
  scopeKey: "all" | "mine";
}) {
  const updateSprint = useUpdateSprint();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [updatingId, setUpdatingId] = useState<number | null>(null);

  // Generic inline-update helper used by Status / Session Type / Payment Status.
  // Updates one field, invalidates both the scoped list and the legacy listSprints
  // cache (used by the dashboard).
  async function patchField(id: number, patch: Partial<Sprint>) {
    setUpdatingId(id);
    try {
      await updateSprint.mutateAsync({ id, data: patch as any });
      await queryClient.invalidateQueries({ queryKey: ["/api/sprints", scopeKey] });
      await queryClient.invalidateQueries({ queryKey: getListSprintsQueryKey() });
      toast({ title: "Saved" });
    } catch (err: any) {
      toast({ title: "Update failed", description: err?.message, variant: "destructive" });
    } finally {
      setUpdatingId(null);
    }
  }

  // Stage of business lives on the company (founder), not the sprint — patch it
  // there and refresh both lists.
  async function patchCompanyStage(founderId: number, stage: string) {
    setUpdatingId(founderId);
    try {
      const res = await fetch(`${BASE}/api/companies/${founderId}`, {
        method: "PATCH", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stage }),
      });
      if (!res.ok) throw new Error("Failed to update stage");
      await queryClient.invalidateQueries({ queryKey: ["/api/sprints", scopeKey] });
      await queryClient.invalidateQueries({ queryKey: ["/api/companies"] });
      toast({ title: "Stage updated" });
    } catch (err: any) {
      toast({ title: "Update failed", description: err?.message, variant: "destructive" });
    } finally {
      setUpdatingId(null);
    }
  }

  async function removeStartup(founderId: number, name: string) {
    if (!window.confirm(`Remove "${name}" and all its sprint sessions? This can't be undone.`)) return;
    try {
      const res = await fetch(`${BASE}/api/companies/${founderId}`, { method: "DELETE", credentials: "include" });
      if (!res.ok) throw new Error("Delete failed");
      await queryClient.invalidateQueries({ queryKey: ["/api/sprints", scopeKey] });
      await queryClient.invalidateQueries({ queryKey: ["/api/companies"] });
      toast({ title: "Startup removed" });
    } catch (err: any) {
      toast({ title: "Remove failed", description: err?.message, variant: "destructive" });
    }
  }

  return (
    <div className="bg-card border border-card-border rounded-xl overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-muted/40 text-[11px] uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="px-3 py-2.5 text-left font-medium"><SortHeader label="Date" k="date" sortKey={sortKey} sortDir={sortDir} toggleSort={toggleSort} /></th>
              <th className="px-3 py-2.5 text-left font-medium"><SortHeader label="Company" k="company" sortKey={sortKey} sortDir={sortDir} toggleSort={toggleSort} /></th>
              <th className="px-3 py-2.5 text-left font-medium">Founder</th>
              <th className="px-3 py-2.5 text-left font-medium">Industry</th>
              <th className="px-3 py-2.5 text-left font-medium">Stage</th>
              <th className="px-3 py-2.5 text-left font-medium">Program</th>
              <th className="px-3 py-2.5 text-left font-medium"><SortHeader label="Host" k="host" sortKey={sortKey} sortDir={sortDir} toggleSort={toggleSort} /></th>
              <th className="px-3 py-2.5 text-left font-medium">Co-Host</th>
              <th className="px-3 py-2.5 text-center font-medium"><SortHeader label="#" k="sprintNumber" sortKey={sortKey} sortDir={sortDir} toggleSort={toggleSort} /></th>
              <th className="px-3 py-2.5 text-left font-medium">Session Type</th>
              <th className="px-3 py-2.5 text-left font-medium">Payment</th>
              <th className="px-3 py-2.5 text-left font-medium">Billed To</th>
              <th className="px-3 py-2.5 text-right font-medium">Price</th>
              <th className="px-3 py-2.5 text-left font-medium"><SortHeader label="Status" k="status" sortKey={sortKey} sortDir={sortDir} toggleSort={toggleSort} /></th>
              <th className="px-3 py-2.5 w-16 text-center font-medium">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {sorted.map(s => {
              const sc = STATUS_CONFIG[s.status as keyof typeof STATUS_CONFIG] ?? STATUS_CONFIG.scheduled;
              const isUpdating = updatingId === s.id;
              return (
                <tr key={s.id}
                  className="hover:bg-muted/30 transition-colors">
                  <td className="px-3 py-2.5 whitespace-nowrap text-foreground tabular-nums cursor-pointer" onClick={() => onRowClick(s.id)}>
                    {format(parseISO(s.scheduledDate + "T00:00:00"), "d MMM yy")}
                    {s.scheduledTime && <div className="text-[10px] text-muted-foreground">{s.scheduledTime}</div>}
                  </td>
                  <td className="px-3 py-2.5 text-foreground font-medium max-w-[160px] truncate cursor-pointer" title={s.companyName} onClick={() => onRowClick(s.id)}>{s.companyName}</td>
                  <td className="px-3 py-2.5 text-muted-foreground max-w-[120px] truncate cursor-pointer" title={s.founderName} onClick={() => onRowClick(s.id)}>{s.founderName}</td>
                  <td className="px-3 py-2.5 max-w-[110px] truncate">{s.industry ?? "—"}</td>
                  <td className="px-3 py-2.5" onClick={e => e.stopPropagation()}>
                    <select
                      value={s.stage ?? ""}
                      onChange={e => patchCompanyStage(s.founderId, e.target.value)}
                      disabled={isUpdating}
                      className="appearance-none cursor-pointer pl-2 pr-5 py-0.5 text-[10px] bg-indigo-50 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300 border border-transparent rounded focus:outline-none focus:ring-1 focus:ring-ring max-w-[120px]"
                    >
                      <option value="">— Stage —</option>
                      {s.stage && !STAGE_CHOICES.includes(s.stage) && <option value={s.stage}>{s.stage}</option>}
                      {STAGE_CHOICES.map(c => <option key={c} value={c}>{c}</option>)}
                    </select>
                  </td>
                  <td className="px-3 py-2.5 text-muted-foreground max-w-[120px] truncate" title={s.programName ?? undefined}>{programFamily(s.programName) ?? "—"}</td>
                  <td className="px-3 py-2.5 text-foreground">{s.sprintHost ?? s.consultantName}</td>
                  <td className="px-3 py-2.5 text-muted-foreground">{s.coHost ?? "—"}</td>
                  <td className="px-3 py-2.5 text-center tabular-nums text-muted-foreground">{s.sprintNumber ?? "—"}</td>

                  {/* Inline-editable Session Type dropdown */}
                  <td className="px-3 py-2.5" onClick={e => e.stopPropagation()}>
                    <select
                      value={s.sessionType ?? ""}
                      onChange={e => patchField(s.id, { sessionType: e.target.value || null } as any)}
                      disabled={isUpdating}
                      className="appearance-none cursor-pointer pl-2 pr-5 py-0.5 text-[10px] bg-secondary text-secondary-foreground border border-transparent rounded focus:outline-none focus:ring-1 focus:ring-ring max-w-[110px]"
                    >
                      <option value="">—</option>
                      {/* If the existing value isn't in the standard list (e.g. legacy data),
                          render it so we don't blank it out on change. */}
                      {s.sessionType && !SESSION_TYPE_CHOICES.includes(s.sessionType) && (
                        <option value={s.sessionType}>{s.sessionType}</option>
                      )}
                      {SESSION_TYPE_CHOICES.map(c => <option key={c} value={c}>{c}</option>)}
                    </select>
                  </td>

                  {/* Inline-editable Payment Status dropdown */}
                  <td className="px-3 py-2.5" onClick={e => e.stopPropagation()}>
                    <select
                      value={s.paymentStatus ?? ""}
                      onChange={e => patchField(s.id, { paymentStatus: e.target.value || null } as any)}
                      disabled={isUpdating}
                      className="appearance-none cursor-pointer pl-2 pr-5 py-0.5 text-[10px] bg-muted text-muted-foreground border border-transparent rounded focus:outline-none focus:ring-1 focus:ring-ring"
                    >
                      <option value="">—</option>
                      {s.paymentStatus && !PAYMENT_CHOICES.includes(s.paymentStatus) && (
                        <option value={s.paymentStatus}>{s.paymentStatus}</option>
                      )}
                      {PAYMENT_CHOICES.map(c => <option key={c} value={c}>{c}</option>)}
                    </select>
                  </td>

                  {/* Inline-editable Billed To dropdown */}
                  <td className="px-3 py-2.5" onClick={e => e.stopPropagation()}>
                    <select
                      value={s.billedTo ?? ""}
                      onChange={e => patchField(s.id, { billedTo: e.target.value || null } as any)}
                      disabled={isUpdating}
                      className="appearance-none cursor-pointer pl-2 pr-5 py-0.5 text-[10px] bg-muted text-muted-foreground border border-transparent rounded focus:outline-none focus:ring-1 focus:ring-ring max-w-[120px]"
                    >
                      <option value="">—</option>
                      {s.billedTo && !BILLED_TO_CHOICES.includes(s.billedTo) && <option value={s.billedTo}>{s.billedTo}</option>}
                      {BILLED_TO_CHOICES.map(c => <option key={c} value={c}>{c}</option>)}
                    </select>
                  </td>

                  {/* Inline-editable Price (manual) */}
                  <td className="px-3 py-2.5 text-right" onClick={e => e.stopPropagation()}>
                    <PriceInput
                      value={s.price}
                      disabled={isUpdating}
                      onCommit={(v) => patchField(s.id, { price: v } as any)}
                    />
                  </td>

                  {/* Inline-editable Status chip (existing behavior) */}
                  <td className="px-3 py-2.5" onClick={e => e.stopPropagation()}>
                    {isUpdating ? (
                      <span className="flex items-center gap-1 text-[10px] text-muted-foreground">
                        <Loader2 size={9} className="animate-spin" />Saving…
                      </span>
                    ) : (
                      <div className="relative">
                        <select
                          value={s.status}
                          onChange={e => patchField(s.id, { status: e.target.value } as any)}
                          className={`appearance-none cursor-pointer pl-2 pr-5 py-0.5 text-[10px] font-medium rounded-full ${sc.bg} ${sc.color} border border-transparent focus:outline-none focus:ring-1 focus:ring-ring`}
                        >
                          <option value="scheduled">Scheduled</option>
                          <option value="completed">Completed</option>
                          <option value="cancelled">Cancelled</option>
                        </select>
                        <ChevronDown size={8} className={`absolute right-1 top-1/2 -translate-y-1/2 pointer-events-none ${sc.color}`} />
                      </div>
                    )}
                  </td>
                  <td className="px-3 py-2.5" onClick={e => e.stopPropagation()}>
                    <div className="flex items-center justify-center gap-1.5">
                      {s.status !== "completed" && (
                        <button
                          onClick={() => patchField(s.id, { status: "completed" } as any)}
                          disabled={isUpdating}
                          title="Mark this sprint done"
                          className="inline-flex items-center gap-1 rounded-md border border-emerald-200 bg-emerald-50 px-1.5 py-1 text-[10px] font-medium text-emerald-700 hover:bg-emerald-100 dark:border-emerald-900/40 dark:bg-emerald-900/20 dark:text-emerald-300 disabled:opacity-50"
                        >
                          <CheckCircle size={11} /> Done
                        </button>
                      )}
                      <button onClick={() => onRowClick(s.id)} title="Open" className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"><ChevronRight size={14} /></button>
                      <button onClick={() => removeStartup(s.founderId, s.companyName)} title="Remove startup" className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-destructive"><Trash2 size={13} /></button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/** Compact badge for the Companies-by-Cohort section. Maps each workflow
 *  stage to a small color-coded chip. */
function StageBadge({ stage }: { stage: string }) {
  const map: Record<string, { label: string; cls: string }> = {
    pre_sprint:      { label: "Pre-Sprint",   cls: "bg-amber-50 text-amber-800 border-amber-200" },
    scheduled:       { label: "Scheduled",     cls: "bg-sky-50 text-sky-800 border-sky-200" },
    pre_email_sent:  { label: "Pre-Email",     cls: "bg-blue-50 text-blue-800 border-blue-200" },
    sprint_done:     { label: "Sprint Done",   cls: "bg-violet-50 text-violet-800 border-violet-200" },
    post_email_sent: { label: "Completed",     cls: "bg-emerald-50 text-emerald-700 border-emerald-200" },
  };
  const c = map[stage] ?? { label: stage.replace(/_/g, " "), cls: "bg-muted text-muted-foreground border-border" };
  return (
    <span className={`whitespace-nowrap inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium ${c.cls}`}>
      {c.label}
    </span>
  );
}
