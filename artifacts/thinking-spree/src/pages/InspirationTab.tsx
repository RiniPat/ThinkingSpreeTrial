/**
 * Research → Inspiration tab.
 *
 * Flow: setup (paste Thinking-Sheet link + client details) → pick a
 * recommended comparable (or type your own) → grounded roadmap with a
 * fully-sourced breakdown. Renders straight off the typed AI output.
 *
 * Design language matches the rest of the app: app-card / app-button-primary /
 * app-input, Instrument Serif headings (font-serif), navy ink, gold accent
 * (var(--gold)).
 */
import { useState } from "react";
import { customFetch } from "@workspace/api-client-react";
import { useToast } from "@/hooks/use-toast";
import {
  Sparkles, Link2, Loader2, ArrowLeft, ArrowRight, ExternalLink, EyeOff,
  Package, Megaphone, Route, Banknote, TrendingUp, Target, Building2, Save, Pencil,
} from "lucide-react";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

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

const STAGES = ["Ideation", "MVP", "MVP → PMF", "PMF", "PMF → GTM", "Scaling"] as const;
const REVENUE_STAGES = [
  "Pre-revenue", "First revenue", "< ₹1 Cr ARR", "₹1–10 Cr ARR", "₹10–50 Cr ARR", "₹50 Cr+ ARR",
] as const;
const DIM_ICON: Record<string, React.ElementType> = {
  product: Package, marketing: Megaphone, sales: Route,
  funding: Banknote, revenue: TrendingUp, market: Target,
};

export default function InspirationTab() {
  const { toast } = useToast();
  const [step, setStep] = useState<"setup" | "pick" | "roadmap">("setup");

  const [form, setForm] = useState({
    sheetUrl: "", companyName: "", industry: "", specialization: "",
    stage: "PMF → GTM", revenueStage: "₹1–10 Cr ARR", geography: "India-first, then global",
  });
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  const [recs, setRecs] = useState<Recommendation[]>([]);
  const [recSources, setRecSources] = useState<Source[]>([]);
  const [customCompany, setCustomCompany] = useState("");
  const [roadmap, setRoadmap] = useState<Roadmap | null>(null);

  const [findingRecs, setFindingRecs] = useState(false);
  const [buildingFor, setBuildingFor] = useState<string | null>(null);

  async function findComparables() {
    if (!form.companyName || !form.industry) {
      toast({ title: "Add the basics", description: "Company name and industry are required.", variant: "destructive" });
      return;
    }
    setFindingRecs(true);
    try {
      const res = await customFetch<{ recommendations: Recommendation[]; sources: Source[]; sheetWarning: string | null }>(
        `${BASE}/api/research/inspiration/recommend`,
        { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify(form) },
      );
      setRecs(res.recommendations ?? []);
      setRecSources(res.sources ?? []);
      if (res.sheetWarning) toast({ title: "Sheet skipped", description: res.sheetWarning });
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
          body: JSON.stringify({ ...form, clientCompany: form.companyName, inspirationCompany: company }),
        },
      );
      setRoadmap(res.output.output);
      setStep("roadmap");
    } catch (err: any) {
      toast({ title: "Roadmap failed", description: err?.message ?? "Try again.", variant: "destructive" });
    } finally {
      setBuildingFor(null);
    }
  }

  return (
    <div>
      {/* Intro */}
      <div className="mb-5 flex items-start gap-3">
        <div className="mt-0.5 rounded-lg p-2" style={{ background: "var(--gold)", color: "hsl(222 38% 15%)" }}>
          <Sparkles className="h-5 w-5" />
        </div>
        <div>
          <h2 className="font-serif text-2xl text-foreground">Inspiration</h2>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Find the closest real-world playbook for a client and turn it into a sourced, actionable roadmap.
          </p>
        </div>
      </div>

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
        <RoadmapView data={roadmap} clientName={form.companyName} onBack={() => setStep("pick")} saved />
      )}
    </div>
  );
}

function Stepper({ step }: { step: "setup" | "pick" | "roadmap" }) {
  const items = [
    { id: "setup", label: "Setup" },
    { id: "pick", label: "Comparables" },
    { id: "roadmap", label: "Roadmap" },
  ] as const;
  const idx = items.findIndex((i) => i.id === step);
  return (
    <div className="mb-6 flex items-center gap-2">
      {items.map((it, i) => (
        <div key={it.id} className="flex items-center gap-2">
          <span
            className="flex h-6 w-6 items-center justify-center rounded-full text-xs font-semibold"
            style={i <= idx
              ? { background: "var(--gold)", color: "hsl(222 38% 15%)" }
              : { background: "hsl(var(--muted))", color: "hsl(var(--muted-foreground))" }}
          >
            {i + 1}
          </span>
          <span className={`text-sm ${i <= idx ? "text-foreground font-medium" : "text-muted-foreground"}`}>{it.label}</span>
          {i < items.length - 1 && <span className="mx-1 h-px w-8 bg-border" />}
        </div>
      ))}
    </div>
  );
}

function SetupCard({ form, set, onStageChange, onRevenueChange, loading, onSubmit }: any) {
  return (
    <div className="app-card rounded-xl p-6 max-w-3xl">
      <div className="mb-5">
        <label className="mb-1.5 block text-xs font-medium uppercase tracking-wider text-muted-foreground">Thinking Sheet link</label>
        <div className="relative">
          <Link2 className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <input
            value={form.sheetUrl} onChange={set("sheetUrl")}
            placeholder="https://docs.google.com/spreadsheets/d/…"
            className="app-input w-full rounded-md border py-2.5 pl-9 pr-4 text-sm focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring/20"
          />
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
        <button
          onClick={onSubmit} disabled={loading}
          className="app-button-primary inline-flex items-center gap-2 rounded-md px-5 py-2.5 text-sm font-semibold text-primary-foreground transition disabled:opacity-60"
        >
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
              <button
                onClick={() => onChoose(r.name)} disabled={!!buildingFor}
                className="app-button-primary mt-4 inline-flex w-full items-center justify-center gap-2 rounded-md py-2.5 text-sm font-semibold text-primary-foreground transition disabled:opacity-60"
              >
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
          <input
            value={customCompany} onChange={(e) => setCustomCompany(e.target.value)}
            placeholder="Type any company name — e.g. Ninjacart"
            className="app-input flex-1 rounded-md border px-3 py-2.5 text-sm focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring/20"
          />
          <button
            onClick={() => onChoose(customCompany)} disabled={!customCompany.trim() || !!buildingFor}
            className="inline-flex items-center justify-center gap-2 rounded-md border border-border bg-card px-5 py-2.5 text-sm font-semibold text-foreground transition hover:bg-muted disabled:opacity-50"
          >
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

function RoadmapView({ data, clientName, onBack, saved }: { data: Roadmap; clientName: string; onBack: () => void; saved?: boolean }) {
  const srcById = (id?: number) => data.sources.find((s) => s.id === id);
  const snap = [
    { label: "Total funding", v: data.snapshot.totalFunding },
    { label: "Revenue", v: data.snapshot.revenue },
    { label: "Founded", v: data.snapshot.foundedYear },
    { label: "HQ", v: data.snapshot.hq },
  ];

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <button onClick={onBack} className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-4 w-4" /> Comparables
        </button>
        {saved && (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-muted px-3 py-1 text-xs text-muted-foreground">
            <Save className="h-3.5 w-3.5" /> Saved to Research library
          </span>
        )}
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
              {s.v.disclosed
                ? <div className="mt-1 text-lg font-medium text-foreground">{s.v.value}</div>
                : <NotDisclosed className="mt-1" />}
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
                    {dp.disclosed && dp.sourceId
                      ? <SourceLink src={srcById(dp.sourceId)} />
                      : <span className="text-xs text-muted-foreground">—</span>}
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
  let host = src.title;
  try { host = new URL(src.url).hostname.replace(/^www\./, ""); } catch { /* keep title */ }
  return (
    <a href={src.url} target="_blank" rel="noopener noreferrer"
      className="inline-flex max-w-full items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[11px] text-primary hover:underline">
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
        let host = s.title;
        try { host = new URL(s.url).hostname.replace(/^www\./, ""); } catch { /* keep */ }
        return (
          <a key={s.id} href={s.url} target="_blank" rel="noopener noreferrer"
            className="inline-flex items-center gap-1 rounded-full border border-border bg-card px-2.5 py-0.5 text-[11px] text-primary hover:bg-muted">
            {numbered && <span className="font-semibold" style={{ color: "var(--gold)" }}>{s.id}</span>}
            {host}<ExternalLink className="h-2.5 w-2.5" />
          </a>
        );
      })}
    </div>
  );
}
