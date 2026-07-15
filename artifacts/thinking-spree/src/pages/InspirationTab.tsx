/**
 * Research → Inspiration tab.
 *
 * Two views:
 *   • Workbench — setup → pick a comparable (or type your own) → grounded,
 *     sourced roadmap. The session (setup + recommendations + every roadmap
 *     built) is persisted server-side and resumable from "Recent sessions".
 *     The in-progress setup form is also draft-saved to localStorage.
 *   • Comparison — every researched company in one wide, exportable table
 *     (product, journey, funding, revenue, marketing, sales, market potential).
 *
 * Design language matches the app: app-card / app-button-primary / app-input,
 * Instrument Serif headings (font-serif), navy ink, gold accent (var(--gold)).
 */
import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react";
import { useToast } from "@/hooks/use-toast";
import {
  Sparkles, Link2, Loader2, ArrowLeft, ArrowRight, ExternalLink, EyeOff,
  Package, Megaphone, Route, Banknote, TrendingUp, Target, Building2, Save, Pencil,
  History, Table2, Wand2, Download, Plus, RotateCcw,
} from "lucide-react";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");
const DRAFT_KEY = "ts-inspiration-draft-v1";

type Source = { id: number; title: string; url: string };
type SourcedValue = { value: string; disclosed: boolean; sourceId?: number };
type Recommendation = {
  name: string; oneLiner: string; whySimilar: string; matchScore: number;
  industry: string; specialization: string; stage: string; hqCountry: string;
};
type Dimension = {
  key: string; label: string; summary: string;
  dataPoints: Array<{ label: string; value: string; disclosed: boolean; sourceId?: number }>;
};
type Roadmap = {
  company: string; matchScore: number;
  snapshot: { foundedYear: SourcedValue; hq: SourcedValue; totalFunding: SourcedValue; revenue: SourcedValue };
  roadmap: Array<{ phase: string; title: string; body: string }>;
  dimensions: Dimension[];
  sources: Source[];
};
type Form = {
  sheetUrl: string; companyName: string; industry: string; specialization: string;
  stage: string; revenueStage: string; geography: string;
};
type SessionRow = { id: number; title: string; inputs: Form; output: any; createdAt: string; updatedAt: string };
type OutputRow = { id: number; title: string; inputs: any; output: Roadmap; createdAt: string };

const STAGES = ["Ideation", "MVP", "MVP → PMF", "PMF", "PMF → GTM", "Scaling"] as const;
const REVENUE_STAGES = [
  "Pre-revenue", "First revenue", "< ₹1 Cr ARR", "₹1–10 Cr ARR", "₹10–50 Cr ARR", "₹50 Cr+ ARR",
] as const;
const DIM_ICON: Record<string, React.ElementType> = {
  product: Package, marketing: Megaphone, sales: Route,
  funding: Banknote, revenue: TrendingUp, market: Target,
};

const DEFAULT_FORM: Form = {
  sheetUrl: "", companyName: "", industry: "", specialization: "",
  stage: "PMF → GTM", revenueStage: "₹1–10 Cr ARR", geography: "India-first, then global",
};
function loadDraft(): Form {
  try { const s = localStorage.getItem(DRAFT_KEY); if (s) return { ...DEFAULT_FORM, ...JSON.parse(s) }; } catch { /* ignore */ }
  return DEFAULT_FORM;
}

export default function InspirationTab() {
  const { toast } = useToast();
  const qc = useQueryClient();

  const [view, setView] = useState<"workbench" | "comparison">("workbench");
  const [step, setStep] = useState<"setup" | "pick" | "roadmap">("setup");
  const [sessionId, setSessionId] = useState<number | null>(null);

  const [form, setForm] = useState<Form>(loadDraft);
  const set = (k: keyof Form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  const [recs, setRecs] = useState<Recommendation[]>([]);
  const [recSources, setRecSources] = useState<Source[]>([]);
  const [customCompany, setCustomCompany] = useState("");
  const [roadmap, setRoadmap] = useState<Roadmap | null>(null);
  const [findingRecs, setFindingRecs] = useState(false);
  const [buildingFor, setBuildingFor] = useState<string | null>(null);

  // Draft autosave — never lose a half-typed setup.
  useEffect(() => { try { localStorage.setItem(DRAFT_KEY, JSON.stringify(form)); } catch { /* ignore */ } }, [form]);

  // Saved, resumable sessions.
  const { data: sessionsData } = useQuery<{ sessions: SessionRow[] }>({
    queryKey: ["insp-sessions"],
    queryFn: () => customFetch(`${BASE}/api/research/inspiration/sessions`, { credentials: "include" }),
    staleTime: 10_000,
  });
  const sessions = sessionsData?.sessions ?? [];

  // All researched companies (for the comparison table).
  const { data: roadmapsData, isLoading: roadmapsLoading } = useQuery<{ outputs: OutputRow[] }>({
    queryKey: ["insp-roadmaps"],
    queryFn: () => customFetch(`${BASE}/api/research/outputs?tool=inspiration_roadmap`, { credentials: "include" }),
    staleTime: 10_000,
  });
  const roadmaps = roadmapsData?.outputs ?? [];

  async function findComparables() {
    if (!form.companyName || !form.industry) {
      toast({ title: "Add the basics", description: "Company name and industry are required.", variant: "destructive" });
      return;
    }
    setFindingRecs(true);
    try {
      const res = await customFetch<{ recommendations: Recommendation[]; sources: Source[]; sessionId: number; sheetWarning: string | null }>(
        `${BASE}/api/research/inspiration/recommend`,
        { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...form, sessionId }) },
      );
      setRecs(res.recommendations ?? []);
      setRecSources(res.sources ?? []);
      setSessionId(res.sessionId ?? null);
      if (res.sheetWarning) toast({ title: "Sheet skipped", description: res.sheetWarning });
      qc.invalidateQueries({ queryKey: ["insp-sessions"] });
      setStep("pick");
    } catch (err: any) {
      toast({ title: "Couldn't fetch comparables", description: err?.message ?? "Try again.", variant: "destructive" });
    } finally {
      setFindingRecs(false);
    }
  }

  async function buildRoadmap(company: string) {
    if (!company.trim()) return;
    setBuildingFor(company);
    try {
      const res = await customFetch<{ output: { output: Roadmap } }>(
        `${BASE}/api/research/inspiration/roadmap`,
        {
          method: "POST", credentials: "include", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...form, clientCompany: form.companyName, inspirationCompany: company, sessionId }),
        },
      );
      setRoadmap(res.output.output);
      setStep("roadmap");
      qc.invalidateQueries({ queryKey: ["insp-roadmaps"] });
      qc.invalidateQueries({ queryKey: ["insp-sessions"] });
    } catch (err: any) {
      toast({ title: "Roadmap failed", description: err?.message ?? "Try again.", variant: "destructive" });
    } finally {
      setBuildingFor(null);
    }
  }

  function resumeSession(s: SessionRow) {
    setForm({ ...DEFAULT_FORM, ...s.inputs });
    setSessionId(s.id);
    setRecs(s.output?.recommendations ?? []);
    setRecSources(s.output?.sources ?? []);
    setRoadmap(null);
    setStep((s.output?.recommendations?.length ?? 0) > 0 ? "pick" : "setup");
    setView("workbench");
  }
  function newSession() {
    setSessionId(null); setRecs([]); setRecSources([]); setRoadmap(null);
    setCustomCompany(""); setStep("setup"); setView("workbench");
  }

  return (
    <div>
      {/* Intro + view switch */}
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <div className="mt-0.5 rounded-lg p-2" style={{ background: "var(--gold)", color: "hsl(222 38% 15%)" }}>
            <Sparkles className="h-5 w-5" />
          </div>
          <div>
            <h2 className="font-serif text-2xl text-foreground">Inspiration</h2>
            <p className="mt-0.5 text-sm text-muted-foreground">
              Find the closest real-world playbook for a client, then compare every company you research in one sheet.
            </p>
          </div>
        </div>
        <div className="inline-flex rounded-lg border border-border bg-card p-1">
          {([
            { id: "workbench", label: "Workbench", Icon: Wand2 },
            { id: "comparison", label: "Comparison", Icon: Table2, badge: roadmaps.length },
          ] as const).map((v) => (
            <button
              key={v.id}
              onClick={() => setView(v.id)}
              className={
                "inline-flex items-center gap-2 rounded-md px-3.5 py-1.5 text-sm font-medium transition-colors " +
                (view === v.id ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground")
              }
            >
              <v.Icon className="h-3.5 w-3.5" />
              {v.label}
              {"badge" in v && (v as any).badge > 0 && (
                <span className={"rounded-full px-1.5 text-[10px] " + (view === v.id ? "bg-primary-foreground/20" : "bg-muted")}>{(v as any).badge}</span>
              )}
            </button>
          ))}
        </div>
      </div>

      {view === "comparison" ? (
        <ComparisonTable roadmaps={roadmaps} loading={roadmapsLoading} onStart={newSession} />
      ) : (
        <>
          {/* Recent sessions */}
          {sessions.length > 0 && step === "setup" && (
            <div className="mb-6">
              <div className="mb-2 flex items-center justify-between">
                <div className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  <History className="h-3.5 w-3.5" /> Recent sessions
                </div>
                {sessionId !== null && (
                  <button onClick={newSession} className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
                    <Plus className="h-3.5 w-3.5" /> New session
                  </button>
                )}
              </div>
              <div className="flex gap-2 overflow-x-auto pb-1">
                {sessions.slice(0, 8).map((s) => (
                  <button
                    key={s.id}
                    onClick={() => resumeSession(s)}
                    className="app-card app-card-hover shrink-0 rounded-lg p-3 text-left w-56"
                  >
                    <div className="truncate text-sm font-medium text-foreground">{s.inputs?.companyName || s.title}</div>
                    <div className="mt-0.5 truncate text-xs text-muted-foreground">{s.inputs?.industry}{s.inputs?.stage ? ` · ${s.inputs.stage}` : ""}</div>
                    <div className="mt-2 flex items-center gap-2 text-[11px] text-muted-foreground">
                      <span>{s.output?.recommendations?.length ?? 0} comparables</span>
                      <span>·</span>
                      <span>{s.output?.researchedCompanies?.length ?? 0} researched</span>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )}

          {sessionId !== null && step !== "setup" && (
            <div className="mb-4 flex items-center gap-2 text-xs text-muted-foreground">
              <Save className="h-3.5 w-3.5" /> Session saved automatically
              <button onClick={newSession} className="ml-2 inline-flex items-center gap-1 hover:text-foreground">
                <RotateCcw className="h-3 w-3" /> Start a new one
              </button>
            </div>
          )}

          <Stepper step={step} />

          {step === "setup" && (
            <SetupCard
              form={form} set={set}
              onStageChange={(v: string) => setForm((f) => ({ ...f, stage: v }))}
              onRevenueChange={(v: string) => setForm((f) => ({ ...f, revenueStage: v }))}
              loading={findingRecs} onSubmit={findComparables}
            />
          )}
          {step === "pick" && (
            <PickStep
              recs={recs} sources={recSources} buildingFor={buildingFor}
              customCompany={customCompany} setCustomCompany={setCustomCompany}
              onBack={() => setStep("setup")} onChoose={buildRoadmap}
            />
          )}
          {step === "roadmap" && roadmap && (
            <RoadmapView data={roadmap} clientName={form.companyName}
              onBack={() => setStep("pick")}
              onCompare={() => setView("comparison")} saved />
          )}
        </>
      )}
    </div>
  );
}

// ── Comparison table ───────────────────────────────────────────────────────
function dimSummary(r: Roadmap, key: string): string {
  return r.dimensions?.find((d) => d.key === key)?.summary ?? "—";
}
function csvEscape(v: string): string {
  const s = (v ?? "").replace(/\s+/g, " ").trim();
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function ComparisonTable({ roadmaps, loading, onStart }: { roadmaps: OutputRow[]; loading: boolean; onStart: () => void }) {
  const [clientFilter, setClientFilter] = useState("all");
  const [q, setQ] = useState("");

  const clients = useMemo(() => {
    const set = new Set<string>();
    roadmaps.forEach((r) => { const c = r.inputs?.clientCompany; if (c) set.add(c); });
    return Array.from(set);
  }, [roadmaps]);

  const rows = useMemo(() => {
    return roadmaps
      .filter((r) => clientFilter === "all" || r.inputs?.clientCompany === clientFilter)
      .filter((r) => !q.trim() || (r.output?.company ?? "").toLowerCase().includes(q.toLowerCase()))
      .sort((a, b) => (b.output?.matchScore ?? 0) - (a.output?.matchScore ?? 0));
  }, [roadmaps, clientFilter, q]);

  function exportCsv() {
    const header = ["Company", "Researched for", "Match %", "Founded", "HQ", "Total funding", "Revenue", "Product", "Marketing", "Sales channels", "Market potential", "Sources", "Date"];
    const lines = rows.map((r) => {
      const o = r.output;
      return [
        o.company, r.inputs?.clientCompany ?? "", String(o.matchScore ?? ""),
        o.snapshot?.foundedYear?.disclosed ? o.snapshot.foundedYear.value : "N/D",
        o.snapshot?.hq?.disclosed ? o.snapshot.hq.value : "N/D",
        o.snapshot?.totalFunding?.disclosed ? o.snapshot.totalFunding.value : "N/D",
        o.snapshot?.revenue?.disclosed ? o.snapshot.revenue.value : "N/D",
        dimSummary(o, "product"), dimSummary(o, "marketing"), dimSummary(o, "sales"), dimSummary(o, "market"),
        (o.sources ?? []).map((s) => s.url).join(" "),
        new Date(r.createdAt).toLocaleDateString("en-IN"),
      ].map(csvEscape).join(",");
    });
    const blob = new Blob([[header.join(","), ...lines].join("\n")], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `inspiration-comparison-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click(); URL.revokeObjectURL(url);
  }

  if (loading) return <div className="app-card rounded-xl p-8 text-center text-sm text-muted-foreground"><Loader2 className="mx-auto mb-2 h-5 w-5 animate-spin" /> Loading researched companies…</div>;

  if (roadmaps.length === 0) {
    return (
      <div className="app-card rounded-xl p-10 text-center">
        <Table2 className="mx-auto h-8 w-8 text-muted-foreground" />
        <p className="mt-3 font-serif text-lg text-foreground">No companies researched yet</p>
        <p className="mx-auto mt-1 max-w-sm text-sm text-muted-foreground">
          Build an inspiration roadmap in the Workbench and every company you research will line up here for side-by-side comparison.
        </p>
        <button onClick={onStart} className="app-button-primary mt-4 inline-flex items-center gap-2 rounded-md px-4 py-2 text-sm font-semibold text-primary-foreground">
          <Wand2 className="h-4 w-4" /> Go to Workbench
        </button>
      </div>
    );
  }

  const Cell = ({ text }: { text: string }) => (
    <td className="border-t border-border px-3 py-3 align-top">
      <p className="line-clamp-4 text-xs leading-relaxed text-foreground/80">{text}</p>
    </td>
  );
  const Snap = ({ v }: { v?: SourcedValue }) => (
    <td className="border-t border-border px-3 py-3 align-top text-xs">
      {v?.disclosed ? <span className="font-medium text-foreground">{v.value}</span>
        : <span className="italic text-muted-foreground">N/D</span>}
    </td>
  );

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <select value={clientFilter} onChange={(e) => setClientFilter(e.target.value)}
            className="app-input rounded-md border px-3 py-1.5 text-xs">
            <option value="all">All clients ({roadmaps.length})</option>
            {clients.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search company…"
            className="app-input rounded-md border px-3 py-1.5 text-xs w-44" />
        </div>
        <button onClick={exportCsv} className="inline-flex items-center gap-2 rounded-md border border-border bg-card px-3 py-1.5 text-xs font-medium text-foreground hover:bg-muted">
          <Download className="h-3.5 w-3.5" /> Export CSV
        </button>
      </div>

      <div className="app-card overflow-x-auto rounded-xl">
        <table className="w-full border-collapse text-sm" style={{ minWidth: 1180 }}>
          <thead>
            <tr className="bg-muted/60 text-left text-[11px] uppercase tracking-wider text-muted-foreground">
              <th className="sticky left-0 z-10 bg-muted/60 px-3 py-2.5 font-medium">Company</th>
              <th className="px-3 py-2.5 font-medium">Match</th>
              <th className="px-3 py-2.5 font-medium">Founded</th>
              <th className="px-3 py-2.5 font-medium">HQ</th>
              <th className="px-3 py-2.5 font-medium">Funding</th>
              <th className="px-3 py-2.5 font-medium">Revenue</th>
              <th className="px-3 py-2.5 font-medium min-w-[180px]">Product</th>
              <th className="px-3 py-2.5 font-medium min-w-[180px]">Marketing</th>
              <th className="px-3 py-2.5 font-medium min-w-[180px]">Sales channels</th>
              <th className="px-3 py-2.5 font-medium min-w-[180px]">Market &amp; potential</th>
              <th className="px-3 py-2.5 font-medium">Sources</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const o = r.output;
              return (
                <tr key={r.id} className="hover:bg-muted/30">
                  <td className="sticky left-0 z-10 border-t border-border bg-card px-3 py-3 align-top">
                    <div className="font-serif text-base text-foreground">{o.company}</div>
                    <div className="mt-0.5 text-[11px] text-muted-foreground">for {r.inputs?.clientCompany ?? "—"}</div>
                    <div className="mt-0.5 text-[11px] text-muted-foreground">{new Date(r.createdAt).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}</div>
                  </td>
                  <td className="border-t border-border px-3 py-3 align-top">
                    <span className="rounded-full px-2 py-0.5 text-xs font-semibold" style={{ background: "#faf3e2", color: "#8a6a1f" }}>{Math.round(o.matchScore ?? 0)}%</span>
                  </td>
                  <Snap v={o.snapshot?.foundedYear} />
                  <Snap v={o.snapshot?.hq} />
                  <Snap v={o.snapshot?.totalFunding} />
                  <Snap v={o.snapshot?.revenue} />
                  <Cell text={dimSummary(o, "product")} />
                  <Cell text={dimSummary(o, "marketing")} />
                  <Cell text={dimSummary(o, "sales")} />
                  <Cell text={dimSummary(o, "market")} />
                  <td className="border-t border-border px-3 py-3 align-top">
                    <div className="flex flex-col gap-1">
                      {(o.sources ?? []).slice(0, 3).map((s) => {
                        let host = s.title; try { host = new URL(s.url).hostname.replace(/^www\./, ""); } catch { /* keep */ }
                        return <a key={s.id} href={s.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-[11px] text-primary hover:underline"><span className="truncate max-w-[90px]">{host}</span><ExternalLink className="h-2.5 w-2.5 shrink-0" /></a>;
                      })}
                      {(o.sources?.length ?? 0) > 3 && <span className="text-[11px] text-muted-foreground">+{(o.sources!.length - 3)} more</span>}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-xs text-muted-foreground">Cells summarise each roadmap. Open a company in the Workbench for the full sourced breakdown. “N/D” = not publicly disclosed.</p>
    </div>
  );
}

// ── Stepper ─────────────────────────────────────────────────────────────────
function Stepper({ step }: { step: "setup" | "pick" | "roadmap" }) {
  const items = [
    { id: "setup", label: "Setup" }, { id: "pick", label: "Comparables" }, { id: "roadmap", label: "Roadmap" },
  ] as const;
  const idx = items.findIndex((i) => i.id === step);
  return (
    <div className="mb-6 flex items-center gap-2">
      {items.map((it, i) => (
        <div key={it.id} className="flex items-center gap-2">
          <span className="flex h-6 w-6 items-center justify-center rounded-full text-xs font-semibold"
            style={i <= idx ? { background: "var(--gold)", color: "hsl(222 38% 15%)" } : { background: "hsl(var(--muted))", color: "hsl(var(--muted-foreground))" }}>
            {i + 1}
          </span>
          <span className={`text-sm ${i <= idx ? "text-foreground font-medium" : "text-muted-foreground"}`}>{it.label}</span>
          {i < items.length - 1 && <span className="mx-1 h-px w-8 bg-border" />}
        </div>
      ))}
    </div>
  );
}

// ── Setup ─────────────────────────────────────────────────────────────────
function SetupCard({ form, set, onStageChange, onRevenueChange, loading, onSubmit }: any) {
  return (
    <div className="app-card rounded-xl p-6 max-w-3xl">
      <div className="mb-5">
        <label className="mb-1.5 block text-xs font-medium uppercase tracking-wider text-muted-foreground">Thinking Sheet link</label>
        <div className="relative">
          <Link2 className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <input value={form.sheetUrl} onChange={set("sheetUrl")} placeholder="https://docs.google.com/spreadsheets/d/…"
            className="app-input w-full rounded-md border py-2.5 pl-9 pr-4 text-sm focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring/20" />
        </div>
        <p className="mt-1 text-xs text-muted-foreground">Optional. We read it (Viewer access) to tailor the match to your client.</p>
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <TextField label="Client company" value={form.companyName} onChange={set("companyName")} placeholder="e.g. Kisan Kart" required />
        <TextField label="Industry" value={form.industry} onChange={set("industry")} placeholder="e.g. AgriTech" required />
        <TextField label="Specialization" value={form.specialization} onChange={set("specialization")} placeholder="e.g. Full-stack farmer platform" />
        <TextField label="Geography focus" value={form.geography} onChange={set("geography")} placeholder="e.g. India-first" />
        <SelectField label="Business stage" value={form.stage} onChange={(e: any) => onStageChange(e.target.value)} options={STAGES as any} />
        <SelectField label="Revenue stage" value={form.revenueStage} onChange={(e: any) => onRevenueChange(e.target.value)} options={REVENUE_STAGES as any} />
      </div>
      <div className="mt-6 flex justify-end">
        <button onClick={onSubmit} disabled={loading}
          className="app-button-primary inline-flex items-center gap-2 rounded-md px-5 py-2.5 text-sm font-semibold text-primary-foreground transition disabled:opacity-60">
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
          {loading ? "Finding comparables…" : "Find comparables"}
        </button>
      </div>
    </div>
  );
}
function TextField({ label, required, ...props }: any) {
  return (
    <div>
      <label className="mb-1.5 block text-xs font-medium uppercase tracking-wider text-muted-foreground">
        {label}{required && <span className="ml-0.5 text-destructive">*</span>}
      </label>
      <input {...props} className="app-input w-full rounded-md border px-3 py-2.5 text-sm focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring/20" />
    </div>
  );
}
function SelectField({ label, options, ...props }: any) {
  return (
    <div>
      <label className="mb-1.5 block text-xs font-medium uppercase tracking-wider text-muted-foreground">{label}</label>
      <select {...props} className="app-input w-full rounded-md border px-3 py-2.5 text-sm focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring/20">
        {options.map((o: string) => <option key={o} value={o}>{o}</option>)}
      </select>
    </div>
  );
}

// ── Pick comparables ─────────────────────────────────────────────────────
function PickStep({ recs, sources, buildingFor, customCompany, setCustomCompany, onBack, onChoose }: any) {
  return (
    <div>
      <button onClick={onBack} className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4" /> Change inputs
      </button>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {recs.map((r: Recommendation) => {
          const busy = buildingFor === r.name;
          return (
            <div key={r.name} className="app-card app-card-hover rounded-xl p-5">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h3 className="font-serif text-xl text-foreground">{r.name}</h3>
                  <p className="mt-0.5 text-sm text-muted-foreground">{r.oneLiner}</p>
                </div>
                <MatchBadge score={r.matchScore} />
              </div>
              <p className="mt-3 text-sm leading-relaxed text-foreground/80">{r.whySimilar}</p>
              <div className="mt-3 flex flex-wrap gap-1.5">
                {[r.industry, r.specialization, r.stage, r.hqCountry].filter(Boolean).map((t) => (
                  <span key={t} className="rounded-full border border-border bg-card px-2.5 py-0.5 text-[11px] text-muted-foreground">{t}</span>
                ))}
              </div>
              <button onClick={() => onChoose(r.name)} disabled={!!buildingFor}
                className="app-button-primary mt-4 inline-flex w-full items-center justify-center gap-2 rounded-md py-2.5 text-sm font-semibold text-primary-foreground transition disabled:opacity-60">
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowRight className="h-4 w-4" />}
                {busy ? "Researching…" : "Build inspiration roadmap"}
              </button>
            </div>
          );
        })}
      </div>
      <div className="app-card mt-5 rounded-xl p-5 max-w-3xl">
        <div className="mb-2 flex items-center gap-2 text-sm font-medium text-foreground">
          <Pencil className="h-4 w-4 text-muted-foreground" /> Prefer a company of your own choice?
        </div>
        <div className="flex flex-col gap-2 sm:flex-row">
          <input value={customCompany} onChange={(e) => setCustomCompany(e.target.value)} placeholder="Type any company name — e.g. Ninjacart"
            className="app-input flex-1 rounded-md border px-3 py-2.5 text-sm focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring/20" />
          <button onClick={() => onChoose(customCompany)} disabled={!customCompany.trim() || !!buildingFor}
            className="inline-flex items-center justify-center gap-2 rounded-md border border-border bg-card px-5 py-2.5 text-sm font-semibold text-foreground transition hover:bg-muted disabled:opacity-50">
            {buildingFor === customCompany ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
            Research this one
          </button>
        </div>
      </div>
      {sources?.length > 0 && <SourceChips sources={sources} className="mt-4" />}
    </div>
  );
}

function MatchBadge({ score }: { score: number }) {
  return (
    <div className="shrink-0 rounded-lg border px-3 py-1.5 text-center" style={{ background: "#faf3e2", borderColor: "#eeddb6" }}>
      <div className="font-serif text-2xl leading-none" style={{ color: "#8a6a1f" }}>{Math.round(score)}%</div>
      <div className="mt-0.5 text-[10px]" style={{ color: "#9a7b32" }}>match</div>
    </div>
  );
}

// ── Roadmap view ─────────────────────────────────────────────────────────
function RoadmapView({ data, clientName, onBack, onCompare, saved }: { data: Roadmap; clientName: string; onBack: () => void; onCompare: () => void; saved?: boolean }) {
  const srcById = (id?: number) => data.sources.find((s) => s.id === id);
  const snap = [
    { label: "Total funding", v: data.snapshot.totalFunding },
    { label: "Revenue", v: data.snapshot.revenue },
    { label: "Founded", v: data.snapshot.foundedYear },
    { label: "HQ", v: data.snapshot.hq },
  ];
  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <button onClick={onBack} className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-4 w-4" /> Comparables
        </button>
        <div className="flex items-center gap-2">
          {saved && (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-muted px-3 py-1 text-xs text-muted-foreground">
              <Save className="h-3.5 w-3.5" /> Saved
            </span>
          )}
          <button onClick={onCompare} className="inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-3 py-1.5 text-xs font-medium text-foreground hover:bg-muted">
            <Table2 className="h-3.5 w-3.5" /> Compare all
          </button>
        </div>
      </div>

      <div className="app-card rounded-xl p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="text-xs text-muted-foreground">Inspiration company for <span className="font-medium text-foreground">{clientName}</span></div>
            <h2 className="font-serif text-4xl text-foreground">{data.company}</h2>
          </div>
          <MatchBadge score={data.matchScore} />
        </div>
        <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {snap.map((s) => (
            <div key={s.label} className="rounded-lg border border-border bg-card p-3">
              <div className="text-[11px] text-muted-foreground">
                {s.label}{s.v.disclosed && s.v.sourceId ? <sup className="ml-0.5 font-semibold" style={{ color: "var(--gold)" }}>{s.v.sourceId}</sup> : null}
              </div>
              {s.v.disclosed ? <div className="mt-1 text-lg font-medium text-foreground">{s.v.value}</div> : <NotDisclosed className="mt-1" />}
            </div>
          ))}
        </div>
      </div>

      <h3 className="mt-8 font-serif text-2xl text-foreground">Inspiration roadmap</h3>
      <div className="relative mt-4 pl-7">
        <div className="absolute bottom-1.5 left-2 top-1.5 w-0.5 bg-border" />
        {data.roadmap.map((p, i) => (
          <div key={i} className="relative mb-5 last:mb-0">
            <span className="absolute -left-[22px] top-1 h-4 w-4 rounded-full border-[3px]"
              style={{ background: i === 0 ? "var(--gold)" : "hsl(var(--primary))", borderColor: "hsl(var(--background))" }} />
            <div className="text-sm font-semibold text-foreground">{p.phase} · {p.title}</div>
            <p className="mt-0.5 text-sm leading-relaxed text-muted-foreground">{p.body}</p>
          </div>
        ))}
      </div>

      <h3 className="mt-8 font-serif text-2xl text-foreground">Researched breakdown</h3>
      <div className="app-card mt-4 overflow-hidden rounded-xl">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="bg-muted/60 text-left text-muted-foreground">
              <th className="w-[26%] px-4 py-2.5 font-medium">Dimension</th>
              <th className="px-4 py-2.5 font-medium">What they did</th>
              <th className="w-[18%] px-4 py-2.5 font-medium">Source</th>
            </tr>
          </thead>
          <tbody>
            {data.dimensions.flatMap((dim) => {
              const Icon = DIM_ICON[dim.key] ?? Building2;
              return dim.dataPoints.map((dp, j) => (
                <tr key={`${dim.key}-${j}`} className="border-t border-border align-top">
                  {j === 0 && (
                    <td rowSpan={dim.dataPoints.length} className="px-4 py-3">
                      <div className="flex items-center gap-2 font-medium text-foreground">
                        <Icon className="h-4 w-4" style={{ color: "var(--gold)" }} /> {dim.label}
                      </div>
                      <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{dim.summary}</p>
                    </td>
                  )}
                  <td className="px-4 py-3">
                    <span className="text-xs font-medium text-muted-foreground">{dp.label}: </span>
                    {dp.disclosed ? <span className="text-sm text-foreground/85">{dp.value}</span> : <NotDisclosed />}
                  </td>
                  <td className="px-4 py-3">
                    {dp.disclosed && dp.sourceId ? <SourceLink src={srcById(dp.sourceId)} /> : <span className="text-xs text-muted-foreground">—</span>}
                  </td>
                </tr>
              ));
            })}
          </tbody>
        </table>
      </div>
      <SourceChips sources={data.sources} className="mt-5" numbered />
    </div>
  );
}

function NotDisclosed({ className = "" }: { className?: string }) {
  return (
    <span className={`inline-flex items-center gap-1 rounded-full border border-dashed border-border bg-muted/60 px-2 py-0.5 text-[11px] text-muted-foreground ${className}`}>
      <EyeOff className="h-3 w-3" /> Not publicly disclosed
    </span>
  );
}
function SourceLink({ src }: { src?: Source }) {
  if (!src) return <span className="text-xs text-muted-foreground">—</span>;
  let host = src.title; try { host = new URL(src.url).hostname.replace(/^www\./, ""); } catch { /* keep */ }
  return (
    <a href={src.url} target="_blank" rel="noopener noreferrer" className="inline-flex max-w-full items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[11px] text-primary hover:underline">
      <span className="truncate">{host}</span><ExternalLink className="h-3 w-3 shrink-0" />
    </a>
  );
}
function SourceChips({ sources, className = "", numbered }: { sources: Source[]; className?: string; numbered?: boolean }) {
  if (!sources?.length) return null;
  return (
    <div className={`flex flex-wrap items-center gap-2 ${className}`}>
      <span className="text-[11px] uppercase tracking-[0.1em] text-muted-foreground">Sources</span>
      {sources.map((s) => {
        let host = s.title; try { host = new URL(s.url).hostname.replace(/^www\./, ""); } catch { /* keep */ }
        return (
          <a key={s.id} href={s.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 rounded-full border border-border bg-card px-2.5 py-0.5 text-[11px] text-primary hover:bg-muted">
            {numbered && <span className="font-semibold" style={{ color: "var(--gold)" }}>{s.id}</span>}
            {host}<ExternalLink className="h-2.5 w-2.5" />
          </a>
        );
      })}
    </div>
  );
}
