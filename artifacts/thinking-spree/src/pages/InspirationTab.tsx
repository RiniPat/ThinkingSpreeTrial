/**
 * Research → Inspiration tab.
 *
 * Workbench: setup → pick a comparable from TWO segments (similar peers one
 * level up, and next-level 5–10× companies) → grounded, sourced roadmap laid
 * out as a growth-phase timeline (click any phase to read it in full).
 * Comparison: every researched company in one quantifiable, exportable table;
 * click a row to reopen its roadmap.
 *
 * Sessions persist server-side and are resumable; the setup form is draft-saved
 * to localStorage. Design language matches the app (app-card / app-input /
 * app-button-primary, Instrument Serif headings, navy ink, gold accent).
 */
import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react";
import { useToast } from "@/hooks/use-toast";
import {
  Sparkles, Link2, Loader2, ArrowLeft, ArrowRight, ExternalLink, EyeOff,
  Save, Pencil, History, Table2, Wand2, Download, Plus, RotateCcw,
  ChevronDown, TrendingUp, Users, Banknote, Rocket, Layers,
} from "lucide-react";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");
const DRAFT_KEY = "ts-inspiration-draft-v1";

type Source = { id: number; title: string; url: string };
type SourcedValue = { value: string; disclosed: boolean; sourceId?: number };
type MatchParam = { parameter: string; score: number };
type CompanyMetric = { label: string; value: string; disclosed: boolean };
type Recommendation = {
  name: string; oneLiner: string; hqCountry: string; foundedYear: string;
  segment: "peer" | "next_level";
  metrics: CompanyMetric[]; matchOverall: number; matchBreakdown: MatchParam[];
};
type RoadmapPhase = {
  timeline: string; product: string; marketing: string; funding: string;
  growth: string; customers: string; sourceIds?: number[];
};
type Roadmap = {
  company: string; matchOverall: number; matchBreakdown: MatchParam[];
  snapshot: {
    foundedYear: SourcedValue; hq: SourcedValue; totalFunding: SourcedValue;
    latestRevenue: SourcedValue; teamSize: SourcedValue; growth: SourcedValue;
  };
  phases: RoadmapPhase[]; sources: Source[];
};
type Form = {
  sheetUrl: string; companyName: string; industry: string; specialization: string;
  stage: string; revenueStage: string; geography: string;
};
type SessionRow = { id: number; title: string; inputs: Form; output: any; createdAt: string; updatedAt: string };
type OutputRow = { id: number; title: string; inputs: any; output: Roadmap; createdAt: string };

const STAGES = ["Ideation", "MVP", "MVP → PMF", "PMF", "PMF → GTM", "Scaling"] as const;
const REVENUE_STAGES = ["Pre-revenue", "First revenue", "< ₹1 Cr ARR", "₹1–10 Cr ARR", "₹10–50 Cr ARR", "₹50 Cr+ ARR"] as const;
const METRIC_ICON: Record<string, React.ElementType> = { Revenue: Banknote, "Team size": Users, Funding: Rocket, Growth: TrendingUp };

const DEFAULT_FORM: Form = {
  sheetUrl: "", companyName: "", industry: "", specialization: "",
  stage: "PMF → GTM", revenueStage: "₹1–10 Cr ARR", geography: "India-first, then global",
};
function loadDraft(): Form {
  try { const s = localStorage.getItem(DRAFT_KEY); if (s) return { ...DEFAULT_FORM, ...JSON.parse(s) }; } catch { /* ignore */ }
  return DEFAULT_FORM;
}
const clamp = (n: number) => Math.max(0, Math.min(100, Math.round(n || 0)));

export default function InspirationTab() {
  const { toast } = useToast();
  const qc = useQueryClient();

  const [tab, setTab] = useState<"workbench" | "comparison">("workbench");
  const [step, setStep] = useState<"setup" | "pick" | "roadmap">("setup");
  const [sessionId, setSessionId] = useState<number | null>(null);

  const [form, setForm] = useState<Form>(loadDraft);
  const set = (k: keyof Form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  const [peers, setPeers] = useState<Recommendation[]>([]);
  const [nextLevel, setNextLevel] = useState<Recommendation[]>([]);
  const [recSources, setRecSources] = useState<Source[]>([]);
  const [customCompany, setCustomCompany] = useState("");
  const [roadmap, setRoadmap] = useState<Roadmap | null>(null);
  const [roadmapClient, setRoadmapClient] = useState("");
  const [findingRecs, setFindingRecs] = useState(false);
  const [buildingFor, setBuildingFor] = useState<string | null>(null);

  useEffect(() => { try { localStorage.setItem(DRAFT_KEY, JSON.stringify(form)); } catch { /* ignore */ } }, [form]);

  const { data: sessionsData } = useQuery<{ sessions: SessionRow[] }>({
    queryKey: ["insp-sessions"],
    queryFn: () => customFetch(`${BASE}/api/research/inspiration/sessions`, { credentials: "include" }),
    staleTime: 10_000,
  });
  const sessions = sessionsData?.sessions ?? [];

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
      const res = await customFetch<{ peers: Recommendation[]; nextLevel: Recommendation[]; sources: Source[]; sessionId: number; sheetWarning: string | null }>(
        `${BASE}/api/research/inspiration/recommend`,
        { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...form, sessionId }) },
      );
      setPeers(res.peers ?? []); setNextLevel(res.nextLevel ?? []); setRecSources(res.sources ?? []);
      setSessionId(res.sessionId ?? null);
      if (res.sheetWarning) toast({ title: "Sheet skipped", description: res.sheetWarning });
      qc.invalidateQueries({ queryKey: ["insp-sessions"] });
      setStep("pick");
    } catch (err: any) {
      toast({ title: "Couldn't fetch comparables", description: err?.message ?? "Try again.", variant: "destructive" });
    } finally { setFindingRecs(false); }
  }

  async function buildRoadmap(company: string) {
    if (!company.trim()) return;
    setBuildingFor(company);
    try {
      const res = await customFetch<{ output: { output: Roadmap } }>(
        `${BASE}/api/research/inspiration/roadmap`,
        { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...form, clientCompany: form.companyName, inspirationCompany: company, sessionId }) },
      );
      setRoadmap(res.output.output); setRoadmapClient(form.companyName); setStep("roadmap");
      qc.invalidateQueries({ queryKey: ["insp-roadmaps"] });
      qc.invalidateQueries({ queryKey: ["insp-sessions"] });
    } catch (err: any) {
      toast({ title: "Roadmap failed", description: err?.message ?? "Try again.", variant: "destructive" });
    } finally { setBuildingFor(null); }
  }

  function openRoadmap(row: OutputRow) {
    setRoadmap(row.output); setRoadmapClient(row.inputs?.clientCompany ?? ""); setStep("roadmap"); setTab("workbench");
  }
  function resumeSession(s: SessionRow) {
    setForm({ ...DEFAULT_FORM, ...s.inputs }); setSessionId(s.id);
    setPeers(s.output?.peers ?? []); setNextLevel(s.output?.nextLevel ?? []); setRecSources(s.output?.sources ?? []);
    setRoadmap(null);
    setStep(((s.output?.peers?.length ?? 0) + (s.output?.nextLevel?.length ?? 0)) > 0 ? "pick" : "setup");
    setTab("workbench");
  }
  function newSession() {
    setSessionId(null); setPeers([]); setNextLevel([]); setRecSources([]); setRoadmap(null);
    setCustomCompany(""); setStep("setup"); setTab("workbench");
  }

  return (
    <div>
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <div className="mt-0.5 rounded-lg p-2" style={{ background: "var(--gold)", color: "hsl(222 38% 15%)" }}>
            <Sparkles className="h-5 w-5" />
          </div>
          <div>
            <h2 className="font-serif text-2xl text-foreground">Inspiration</h2>
            <p className="mt-0.5 text-sm text-muted-foreground">Find the closest real-world playbooks for a client, then compare every company you research in one sheet.</p>
          </div>
        </div>
        <div className="inline-flex rounded-lg border border-border bg-card p-1">
          {([{ id: "workbench", label: "Workbench", Icon: Wand2 }, { id: "comparison", label: "Comparison", Icon: Table2, badge: roadmaps.length }] as const).map((v) => (
            <button key={v.id} onClick={() => setTab(v.id)}
              className={"inline-flex items-center gap-2 rounded-md px-3.5 py-1.5 text-sm font-medium transition-colors " + (tab === v.id ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground")}>
              <v.Icon className="h-3.5 w-3.5" />{v.label}
              {"badge" in v && (v as any).badge > 0 && <span className={"rounded-full px-1.5 text-[10px] " + (tab === v.id ? "bg-primary-foreground/20" : "bg-muted")}>{(v as any).badge}</span>}
            </button>
          ))}
        </div>
      </div>

      {tab === "comparison" ? (
        <ComparisonTable roadmaps={roadmaps} loading={roadmapsLoading} onOpen={openRoadmap} onStart={newSession} />
      ) : (
        <>
          {sessions.length > 0 && step === "setup" && (
            <div className="mb-6">
              <div className="mb-2 flex items-center justify-between">
                <div className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wider text-muted-foreground"><History className="h-3.5 w-3.5" /> Recent sessions</div>
              </div>
              <div className="flex gap-2 overflow-x-auto pb-1">
                {sessions.slice(0, 8).map((s) => (
                  <button key={s.id} onClick={() => resumeSession(s)} className="app-card app-card-hover w-56 shrink-0 rounded-lg p-3 text-left">
                    <div className="truncate text-sm font-medium text-foreground">{s.inputs?.companyName || s.title}</div>
                    <div className="mt-0.5 truncate text-xs text-muted-foreground">{s.inputs?.industry}{s.inputs?.stage ? ` · ${s.inputs.stage}` : ""}</div>
                    <div className="mt-2 flex items-center gap-2 text-[11px] text-muted-foreground">
                      <span>{(s.output?.peers?.length ?? 0) + (s.output?.nextLevel?.length ?? 0)} comparables</span><span>·</span>
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
              <button onClick={newSession} className="ml-2 inline-flex items-center gap-1 hover:text-foreground"><RotateCcw className="h-3 w-3" /> Start a new one</button>
            </div>
          )}

          <Stepper step={step} />

          {step === "setup" && (
            <SetupCard form={form} set={set}
              onStageChange={(v: string) => setForm((f) => ({ ...f, stage: v }))}
              onRevenueChange={(v: string) => setForm((f) => ({ ...f, revenueStage: v }))}
              loading={findingRecs} onSubmit={findComparables} />
          )}
          {step === "pick" && (
            <PickStep client={form.companyName} peers={peers} nextLevel={nextLevel} sources={recSources}
              buildingFor={buildingFor} customCompany={customCompany} setCustomCompany={setCustomCompany}
              onBack={() => setStep("setup")} onChoose={buildRoadmap} />
          )}
          {step === "roadmap" && roadmap && (
            <RoadmapView data={roadmap} clientName={roadmapClient} onBack={() => setStep("pick")} onCompare={() => setTab("comparison")} />
          )}
        </>
      )}
    </div>
  );
}

// ── Match visuals ──────────────────────────────────────────────────────────
function MatchRing({ score, size = 54 }: { score: number; size?: number }) {
  const r = (size - 8) / 2, c = 2 * Math.PI * r, s = clamp(score);
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="shrink-0">
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="hsl(var(--muted))" strokeWidth={5} />
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--gold)" strokeWidth={5} strokeLinecap="round"
        strokeDasharray={c} strokeDashoffset={c * (1 - s / 100)} transform={`rotate(-90 ${size / 2} ${size / 2})`} />
      <text x="50%" y="52%" dominantBaseline="middle" textAnchor="middle" style={{ fill: "hsl(var(--foreground))", fontSize: size * 0.28, fontWeight: 600 }}>{s}</text>
    </svg>
  );
}
function MatchBars({ items }: { items: MatchParam[] }) {
  return (
    <div className="space-y-1">
      {(items ?? []).map((m) => (
        <div key={m.parameter} className="flex items-center gap-2">
          <span className="w-[104px] shrink-0 text-[10px] text-muted-foreground">{m.parameter}</span>
          <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
            <div className="h-full rounded-full" style={{ width: `${clamp(m.score)}%`, background: "var(--gold)" }} />
          </div>
          <span className="w-6 text-right text-[10px] tabular-nums text-muted-foreground">{clamp(m.score)}</span>
        </div>
      ))}
    </div>
  );
}
function MetricChip({ label, value, disclosed }: CompanyMetric) {
  const Icon = METRIC_ICON[label] ?? Layers;
  return (
    <div className="rounded-lg border border-border bg-background px-2.5 py-1.5">
      <div className="flex items-center gap-1 text-[10px] uppercase tracking-wide text-muted-foreground"><Icon className="h-3 w-3" />{label}</div>
      {disclosed ? <div className="mt-0.5 text-sm font-semibold text-foreground">{value}</div> : <div className="mt-0.5 text-xs italic text-muted-foreground">N/D</div>}
    </div>
  );
}

// ── Pick comparables (two segments) ────────────────────────────────────────
function RecCard({ r, busy, disabled, onChoose }: { r: Recommendation; busy: boolean; disabled: boolean; onChoose: () => void }) {
  return (
    <div className="app-card app-card-hover flex flex-col rounded-xl p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h4 className="truncate font-serif text-lg text-foreground">{r.name}</h4>
          <p className="text-[11px] text-muted-foreground">{r.hqCountry}{r.foundedYear ? ` · founded ${r.foundedYear}` : ""}</p>
          <p className="mt-1 line-clamp-2 text-xs text-foreground/70">{r.oneLiner}</p>
        </div>
        <div className="text-center">
          <MatchRing score={r.matchOverall} />
          <div className="mt-0.5 text-[9px] uppercase tracking-wide text-muted-foreground">match</div>
        </div>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2">
        {(r.metrics ?? []).map((m) => <MetricChip key={m.label} {...m} />)}
      </div>
      <div className="mt-3 rounded-lg bg-muted/40 p-2.5"><MatchBars items={r.matchBreakdown} /></div>
      <button onClick={onChoose} disabled={disabled}
        className="app-button-primary mt-3 inline-flex w-full items-center justify-center gap-2 rounded-md py-2 text-sm font-semibold text-primary-foreground transition disabled:opacity-60">
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowRight className="h-4 w-4" />}{busy ? "Researching…" : "Build roadmap"}
      </button>
    </div>
  );
}

function Segment({ title, subtitle, items, buildingFor, onChoose }: { title: string; subtitle: string; items: Recommendation[]; buildingFor: string | null; onChoose: (n: string) => void }) {
  if (!items?.length) return null;
  return (
    <div className="mb-6">
      <div className="mb-3">
        <h3 className="font-serif text-xl text-foreground">{title}</h3>
        <p className="text-sm text-muted-foreground">{subtitle}</p>
      </div>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        {items.map((r) => <RecCard key={r.name} r={r} busy={buildingFor === r.name} disabled={!!buildingFor} onChoose={() => onChoose(r.name)} />)}
      </div>
    </div>
  );
}

function PickStep({ client, peers, nextLevel, sources, buildingFor, customCompany, setCustomCompany, onBack, onChoose }: any) {
  return (
    <div>
      <button onClick={onBack} className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="h-4 w-4" /> Change inputs</button>
      <Segment title="Similar peers — one level up" subtitle={`Same problem, target and revenue band as ${client || "the client"}, a step ahead.`} items={peers} buildingFor={buildingFor} onChoose={onChoose} />
      <Segment title="Next level — scaled 5–10×" subtitle="Same space, but well ahead — the journey to aspire to." items={nextLevel} buildingFor={buildingFor} onChoose={onChoose} />
      <div className="app-card mt-1 rounded-xl p-5 max-w-3xl">
        <div className="mb-2 flex items-center gap-2 text-sm font-medium text-foreground"><Pencil className="h-4 w-4 text-muted-foreground" /> Prefer a company of your own choice?</div>
        <div className="flex flex-col gap-2 sm:flex-row">
          <input value={customCompany} onChange={(e) => setCustomCompany(e.target.value)} placeholder="Type any company name — e.g. Ninjacart"
            className="app-input flex-1 rounded-md border px-3 py-2.5 text-sm focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring/20" />
          <button onClick={() => onChoose(customCompany)} disabled={!customCompany.trim() || !!buildingFor}
            className="inline-flex items-center justify-center gap-2 rounded-md border border-border bg-card px-5 py-2.5 text-sm font-semibold text-foreground transition hover:bg-muted disabled:opacity-50">
            {buildingFor === customCompany ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />} Research this one
          </button>
        </div>
      </div>
      {sources?.length > 0 && <SourceChips sources={sources} className="mt-4" />}
    </div>
  );
}

// ── Roadmap (growth-phase timeline) ────────────────────────────────────────
const PHASE_COLS: { key: keyof RoadmapPhase; label: string }[] = [
  { key: "product", label: "Product & capability" },
  { key: "marketing", label: "Marketing & positioning" },
  { key: "funding", label: "Funding & investment" },
  { key: "growth", label: "Quantified growth" },
  { key: "customers", label: "Key customers / partners" },
];

function RoadmapView({ data, clientName, onBack, onCompare }: { data: Roadmap; clientName: string; onBack: () => void; onCompare: () => void }) {
  const [open, setOpen] = useState<number>(0); // first phase open by default
  const srcById = (id?: number) => data.sources?.find((s) => s.id === id);
  const snap = [
    { label: "Founded", v: data.snapshot?.foundedYear },
    { label: "HQ", v: data.snapshot?.hq },
    { label: "Total funding", v: data.snapshot?.totalFunding },
    { label: "Latest revenue", v: data.snapshot?.latestRevenue },
    { label: "Team size", v: data.snapshot?.teamSize },
    { label: "Growth", v: data.snapshot?.growth },
  ];

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <button onClick={onBack} className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="h-4 w-4" /> Comparables</button>
        <div className="flex items-center gap-2">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-muted px-3 py-1 text-xs text-muted-foreground"><Save className="h-3.5 w-3.5" /> Saved</span>
          <button onClick={onCompare} className="inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-3 py-1.5 text-xs font-medium text-foreground hover:bg-muted"><Table2 className="h-3.5 w-3.5" /> Compare all</button>
        </div>
      </div>

      {/* Header: identity + match + snapshot */}
      <div className="app-card rounded-xl p-6">
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-[1.4fr_1fr]">
          <div>
            <div className="text-xs text-muted-foreground">Inspiration company for <span className="font-medium text-foreground">{clientName || "your client"}</span></div>
            <h2 className="font-serif text-4xl text-foreground">{data.company}</h2>
            <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3">
              {snap.map((s) => (
                <div key={s.label} className="rounded-lg border border-border bg-background p-2.5">
                  <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
                    {s.label}{s.v?.disclosed && s.v?.sourceId ? <sup className="ml-0.5 font-semibold" style={{ color: "var(--gold)" }}>{s.v.sourceId}</sup> : null}
                  </div>
                  {s.v?.disclosed ? <div className="mt-0.5 text-sm font-semibold text-foreground">{s.v.value}</div> : <NotDisclosed className="mt-0.5" />}
                </div>
              ))}
            </div>
          </div>
          <div className="rounded-lg border border-border bg-muted/30 p-4">
            <div className="mb-2 flex items-center gap-3">
              <MatchRing score={data.matchOverall} size={64} />
              <div>
                <div className="text-sm font-semibold text-foreground">Match to {clientName || "client"}</div>
                <div className="text-xs text-muted-foreground">across five parameters</div>
              </div>
            </div>
            <MatchBars items={data.matchBreakdown} />
          </div>
        </div>
      </div>

      {/* Timeline table — click any phase to read it in full */}
      <div className="mt-8 flex items-center justify-between">
        <h3 className="font-serif text-2xl text-foreground">Growth-phase journey</h3>
        <span className="text-xs text-muted-foreground">Click a phase to expand</span>
      </div>
      <div className="app-card mt-3 overflow-x-auto rounded-xl">
        <table className="w-full border-collapse text-sm" style={{ minWidth: 980 }}>
          <thead>
            <tr className="bg-primary text-left text-[11px] uppercase tracking-wider text-primary-foreground">
              <th className="px-3 py-2.5 font-semibold" style={{ minWidth: 150 }}>Timeline</th>
              {PHASE_COLS.map((c) => <th key={c.key} className="px-3 py-2.5 font-semibold" style={{ minWidth: 160 }}>{c.label}</th>)}
            </tr>
          </thead>
          <tbody>
            {(data.phases ?? []).map((p, i) => {
              const isOpen = open === i;
              return (
                <PhaseRows key={i} p={p} i={i} isOpen={isOpen} onToggle={() => setOpen(isOpen ? -1 : i)} srcById={srcById} />
              );
            })}
          </tbody>
        </table>
      </div>

      <SourceChips sources={data.sources ?? []} className="mt-5" numbered />
    </div>
  );
}

function PhaseRows({ p, i, isOpen, onToggle, srcById }: { p: RoadmapPhase; i: number; isOpen: boolean; onToggle: () => void; srcById: (id?: number) => Source | undefined }) {
  const zebra = i % 2 === 1;
  return (
    <>
      <tr onClick={onToggle} className={"cursor-pointer border-t border-border transition-colors hover:bg-muted/40 " + (zebra ? "bg-muted/20" : "")}>
        <td className="px-3 py-3 align-top">
          <div className="flex items-start gap-1.5">
            <ChevronDown className={"mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform " + (isOpen ? "rotate-180" : "")} />
            <span className="text-sm font-semibold text-foreground">{p.timeline}</span>
          </div>
        </td>
        {PHASE_COLS.map((c) => (
          <td key={c.key} className="px-3 py-3 align-top">
            <p className={"text-xs leading-relaxed " + (c.key === "growth" ? "font-medium text-foreground" : "text-foreground/80") + (isOpen ? "" : " line-clamp-4")}>{(p as any)[c.key] || "—"}</p>
          </td>
        ))}
      </tr>
      {isOpen && (
        <tr className="border-t border-border bg-background">
          <td colSpan={PHASE_COLS.length + 1} className="px-4 py-4">
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
              {PHASE_COLS.map((c) => (
                <div key={c.key} className="rounded-lg border border-border bg-card p-3">
                  <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{c.label}</div>
                  <p className="mt-1 text-sm leading-relaxed text-foreground/85">{(p as any)[c.key] || "—"}</p>
                </div>
              ))}
            </div>
            {(p.sourceIds?.length ?? 0) > 0 && (
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <span className="text-[10px] uppercase tracking-wide text-muted-foreground">Phase sources</span>
                {p.sourceIds!.map((id) => { const s = srcById(id); if (!s) return null; let host = s.title; try { host = new URL(s.url).hostname.replace(/^www\./, ""); } catch { /* keep */ }
                  return <a key={id} href={s.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 rounded-full border border-border bg-card px-2 py-0.5 text-[11px] text-primary hover:bg-muted"><span className="font-semibold" style={{ color: "var(--gold)" }}>{id}</span>{host}<ExternalLink className="h-2.5 w-2.5" /></a>; })}
              </div>
            )}
          </td>
        </tr>
      )}
    </>
  );
}

// ── Comparison (quantifiable) ──────────────────────────────────────────────
function snapVal(v?: SourcedValue) { return v?.disclosed ? v.value : "N/D"; }
function csvEscape(s: string) { const t = (s ?? "").replace(/\s+/g, " ").trim(); return /[",\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t; }

function ComparisonTable({ roadmaps, loading, onOpen, onStart }: { roadmaps: OutputRow[]; loading: boolean; onOpen: (r: OutputRow) => void; onStart: () => void }) {
  const [clientFilter, setClientFilter] = useState("all");
  const [q, setQ] = useState("");
  const clients = useMemo(() => Array.from(new Set(roadmaps.map((r) => r.inputs?.clientCompany).filter(Boolean))), [roadmaps]);
  const rows = useMemo(() => roadmaps
    .filter((r) => clientFilter === "all" || r.inputs?.clientCompany === clientFilter)
    .filter((r) => !q.trim() || (r.output?.company ?? "").toLowerCase().includes(q.toLowerCase()))
    .sort((a, b) => (b.output?.matchOverall ?? 0) - (a.output?.matchOverall ?? 0)), [roadmaps, clientFilter, q]);

  function exportCsv() {
    const header = ["Company", "Researched for", "Match", "Founded", "HQ", "Latest revenue", "Team size", "Total funding", "Growth", "Date"];
    const lines = rows.map((r) => { const o = r.output; return [
      o.company, r.inputs?.clientCompany ?? "", String(clamp(o.matchOverall)),
      snapVal(o.snapshot?.foundedYear), snapVal(o.snapshot?.hq), snapVal(o.snapshot?.latestRevenue),
      snapVal(o.snapshot?.teamSize), snapVal(o.snapshot?.totalFunding), snapVal(o.snapshot?.growth),
      new Date(r.createdAt).toLocaleDateString("en-IN"),
    ].map(csvEscape).join(","); });
    const blob = new Blob([[header.join(","), ...lines].join("\n")], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob); const a = document.createElement("a");
    a.href = url; a.download = `inspiration-comparison-${new Date().toISOString().slice(0, 10)}.csv`; a.click(); URL.revokeObjectURL(url);
  }

  if (loading) return <div className="app-card rounded-xl p-8 text-center text-sm text-muted-foreground"><Loader2 className="mx-auto mb-2 h-5 w-5 animate-spin" /> Loading researched companies…</div>;
  if (roadmaps.length === 0) return (
    <div className="app-card rounded-xl p-10 text-center">
      <Table2 className="mx-auto h-8 w-8 text-muted-foreground" />
      <p className="mt-3 font-serif text-lg text-foreground">No companies researched yet</p>
      <p className="mx-auto mt-1 max-w-sm text-sm text-muted-foreground">Build a roadmap in the Workbench and every company lines up here for side-by-side comparison.</p>
      <button onClick={onStart} className="app-button-primary mt-4 inline-flex items-center gap-2 rounded-md px-4 py-2 text-sm font-semibold text-primary-foreground"><Wand2 className="h-4 w-4" /> Go to Workbench</button>
    </div>
  );

  const Snap = ({ v }: { v?: SourcedValue }) => (
    <td className="border-t border-border px-3 py-3 text-xs">{v?.disclosed ? <span className="font-medium text-foreground">{v.value}</span> : <span className="italic text-muted-foreground">N/D</span>}</td>
  );

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <select value={clientFilter} onChange={(e) => setClientFilter(e.target.value)} className="app-input rounded-md border px-3 py-1.5 text-xs">
            <option value="all">All clients ({roadmaps.length})</option>
            {clients.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search company…" className="app-input w-44 rounded-md border px-3 py-1.5 text-xs" />
        </div>
        <button onClick={exportCsv} className="inline-flex items-center gap-2 rounded-md border border-border bg-card px-3 py-1.5 text-xs font-medium text-foreground hover:bg-muted"><Download className="h-3.5 w-3.5" /> Export CSV</button>
      </div>
      <div className="app-card overflow-x-auto rounded-xl">
        <table className="w-full border-collapse text-sm" style={{ minWidth: 900 }}>
          <thead>
            <tr className="bg-muted/60 text-left text-[11px] uppercase tracking-wider text-muted-foreground">
              <th className="sticky left-0 z-10 bg-muted/60 px-3 py-2.5 font-medium">Company</th>
              <th className="px-3 py-2.5 font-medium">Match</th>
              <th className="px-3 py-2.5 font-medium">Founded</th>
              <th className="px-3 py-2.5 font-medium">HQ</th>
              <th className="px-3 py-2.5 font-medium">Latest revenue</th>
              <th className="px-3 py-2.5 font-medium">Team size</th>
              <th className="px-3 py-2.5 font-medium">Total funding</th>
              <th className="px-3 py-2.5 font-medium">Growth</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const o = r.output;
              return (
                <tr key={r.id} onClick={() => onOpen(r)} className="cursor-pointer hover:bg-muted/30">
                  <td className="sticky left-0 z-10 border-t border-border bg-card px-3 py-3">
                    <div className="font-serif text-base text-foreground">{o.company}</div>
                    <div className="text-[11px] text-muted-foreground">for {r.inputs?.clientCompany ?? "—"} · {new Date(r.createdAt).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}</div>
                  </td>
                  <td className="border-t border-border px-3 py-3"><span className="rounded-full px-2 py-0.5 text-xs font-semibold" style={{ background: "#faf3e2", color: "#8a6a1f" }}>{clamp(o.matchOverall)}</span></td>
                  <Snap v={o.snapshot?.foundedYear} /><Snap v={o.snapshot?.hq} /><Snap v={o.snapshot?.latestRevenue} />
                  <Snap v={o.snapshot?.teamSize} /><Snap v={o.snapshot?.totalFunding} /><Snap v={o.snapshot?.growth} />
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-xs text-muted-foreground">Click any row to open its full growth-phase roadmap. “N/D” = not publicly disclosed.</p>
    </div>
  );
}

// ── Shared bits ──────────────────────────────────────────────────────────
function Stepper({ step }: { step: "setup" | "pick" | "roadmap" }) {
  const items = [{ id: "setup", label: "Setup" }, { id: "pick", label: "Comparables" }, { id: "roadmap", label: "Roadmap" }] as const;
  const idx = items.findIndex((i) => i.id === step);
  return (
    <div className="mb-6 flex items-center gap-2">
      {items.map((it, i) => (
        <div key={it.id} className="flex items-center gap-2">
          <span className="flex h-6 w-6 items-center justify-center rounded-full text-xs font-semibold" style={i <= idx ? { background: "var(--gold)", color: "hsl(222 38% 15%)" } : { background: "hsl(var(--muted))", color: "hsl(var(--muted-foreground))" }}>{i + 1}</span>
          <span className={`text-sm ${i <= idx ? "font-medium text-foreground" : "text-muted-foreground"}`}>{it.label}</span>
          {i < items.length - 1 && <span className="mx-1 h-px w-8 bg-border" />}
        </div>
      ))}
    </div>
  );
}
function SetupCard({ form, set, onStageChange, onRevenueChange, loading, onSubmit }: any) {
  return (
    <div className="app-card max-w-3xl rounded-xl p-6">
      <div className="mb-5">
        <label className="mb-1.5 block text-xs font-medium uppercase tracking-wider text-muted-foreground">Thinking Sheet link</label>
        <div className="relative">
          <Link2 className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <input value={form.sheetUrl} onChange={set("sheetUrl")} placeholder="https://docs.google.com/spreadsheets/d/…" className="app-input w-full rounded-md border py-2.5 pl-9 pr-4 text-sm focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring/20" />
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
        <button onClick={onSubmit} disabled={loading} className="app-button-primary inline-flex items-center gap-2 rounded-md px-5 py-2.5 text-sm font-semibold text-primary-foreground transition disabled:opacity-60">
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}{loading ? "Finding comparables…" : "Find comparables"}
        </button>
      </div>
    </div>
  );
}
function TextField({ label, required, ...props }: any) {
  return (
    <div>
      <label className="mb-1.5 block text-xs font-medium uppercase tracking-wider text-muted-foreground">{label}{required && <span className="ml-0.5 text-destructive">*</span>}</label>
      <input {...props} className="app-input w-full rounded-md border px-3 py-2.5 text-sm focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring/20" />
    </div>
  );
}
function SelectField({ label, options, ...props }: any) {
  return (
    <div>
      <label className="mb-1.5 block text-xs font-medium uppercase tracking-wider text-muted-foreground">{label}</label>
      <select {...props} className="app-input w-full rounded-md border px-3 py-2.5 text-sm focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring/20">{options.map((o: string) => <option key={o} value={o}>{o}</option>)}</select>
    </div>
  );
}
function NotDisclosed({ className = "" }: { className?: string }) {
  return <span className={`inline-flex items-center gap-1 rounded-full border border-dashed border-border bg-muted/60 px-2 py-0.5 text-[11px] text-muted-foreground ${className}`}><EyeOff className="h-3 w-3" /> Not disclosed</span>;
}
function SourceChips({ sources, className = "", numbered }: { sources: Source[]; className?: string; numbered?: boolean }) {
  if (!sources?.length) return null;
  return (
    <div className={`flex flex-wrap items-center gap-2 ${className}`}>
      <span className="text-[11px] uppercase tracking-[0.1em] text-muted-foreground">Sources</span>
      {sources.map((s) => { let host = s.title; try { host = new URL(s.url).hostname.replace(/^www\./, ""); } catch { /* keep */ }
        return <a key={s.id} href={s.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 rounded-full border border-border bg-card px-2.5 py-0.5 text-[11px] text-primary hover:bg-muted">{numbered && <span className="font-semibold" style={{ color: "var(--gold)" }}>{s.id}</span>}{host}<ExternalLink className="h-2.5 w-2.5" /></a>; })}
    </div>
  );
}
