import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react";
import { Layout } from "@/components/Layout";
import { useToast } from "@/hooks/use-toast";
import {
  Rocket, Upload, FileText, Wand2, Loader2, Sparkles, Plus, Trash2, Check,
  Link2, Layers, Users, Target, Globe, BarChart3, Waves, Flame, Map,
  ExternalLink, RefreshCw, AlertTriangle,
} from "lucide-react";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");
const api = (p: string) => `${BASE}/api${p}`;

const GOLD = "var(--gold)";

type Company = {
  id: number;
  companyName: string;
  industry?: string | null;
  stage?: string | null;
  specialization?: string | null;
  revenueStage?: string | null;
  description?: string | null;
  websiteUrl?: string | null;
  deckText?: string | null;
};
type Analyses = Record<string, { output: any; updatedAt: string }>;

const PRE_TABS = [
  { key: "overview", label: "Overview", icon: FileText },
  { key: "research", label: "Research Tools", icon: Sparkles },
  { key: "market", label: "Market Potential", icon: Waves },
  { key: "demand", label: "Demand Landscape", icon: Map },
] as const;
type TabKey = (typeof PRE_TABS)[number]["key"];

// intake fields ↔ API keys
type Form = {
  companyName: string; industry: string; businessStage: string;
  specialization: string; revenueStage: string; productDescription: string;
  websiteUrl: string;
};
const emptyForm: Form = {
  companyName: "", industry: "", businessStage: "", specialization: "",
  revenueStage: "", productDescription: "", websiteUrl: "",
};
function formFromCompany(c: Company): Form {
  return {
    companyName: c.companyName ?? "", industry: c.industry ?? "",
    businessStage: c.stage ?? "", specialization: c.specialization ?? "",
    revenueStage: c.revenueStage ?? "", productDescription: c.description ?? "",
    websiteUrl: c.websiteUrl ?? "",
  };
}

export default function PreSprintPage() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [creating, setCreating] = useState(false);
  const [tab, setTab] = useState<TabKey>("overview");

  const companiesQ = useQuery<{ companies: Company[] }>({
    queryKey: ["pre-sprint-companies"],
    queryFn: () => customFetch(api("/pre-sprint/companies"), { credentials: "include" }),
  });

  const detailQ = useQuery<{ company: Company; analyses: Analyses }>({
    queryKey: ["pre-sprint-company", selectedId],
    queryFn: () => customFetch(api(`/pre-sprint/companies/${selectedId}`), { credentials: "include" }),
    enabled: !!selectedId,
  });

  const companies = companiesQ.data?.companies ?? [];
  const detail = detailQ.data;

  return (
    <Layout>
      <div className="p-6 lg:p-8">
        <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
          <div>
            <div className="mb-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
              Sprint lifecycle · Step 1
            </div>
            <h1 className="font-serif text-4xl leading-tight text-foreground">Pre-Sprint</h1>
            <p className="mt-1 max-w-xl text-sm text-muted-foreground">
              Drop the deck once — the AI reads it and powers every analysis below. Everything you fill is saved.
            </p>
          </div>
          <button
            onClick={() => { setSelectedId(null); setCreating(true); }}
            className="inline-flex items-center gap-2 rounded-lg px-4 py-2.5 text-sm font-semibold"
            style={{ background: GOLD, color: "hsl(222 38% 15%)" }}
          >
            <Plus size={15} /> New company
          </button>
        </div>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[260px_1fr]">
          {/* ── saved companies rail ── */}
          <aside>
            <div className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              Saved companies
            </div>
            <div className="space-y-1">
              {companies.length === 0 && !companiesQ.isLoading && (
                <div className="rounded-lg border border-dashed border-border p-4 text-sm text-muted-foreground">
                  No companies yet. Start one with “New company”.
                </div>
              )}
              {companies.map((c) => (
                <button
                  key={c.id}
                  onClick={() => { setSelectedId(c.id); setCreating(false); setTab("overview"); }}
                  className="flex w-full items-center gap-2 rounded-lg border px-3 py-2 text-left text-sm transition-colors"
                  style={{
                    borderColor: selectedId === c.id ? "var(--gold)" : "hsl(var(--border))",
                    background: selectedId === c.id ? "hsl(36 65% 96%)" : "hsl(var(--card))",
                  }}
                >
                  <Rocket size={14} className="shrink-0 text-muted-foreground" />
                  <span className="truncate text-foreground">{c.companyName}</span>
                </button>
              ))}
            </div>
          </aside>

          {/* ── main ── */}
          <div className="min-w-0">
            {creating && (
              <CreateCompany
                onCreated={(c) => {
                  setCreating(false);
                  setSelectedId(c.id);
                  qc.invalidateQueries({ queryKey: ["pre-sprint-companies"] });
                }}
              />
            )}

            {!creating && !selectedId && (
              <div className="rounded-xl border border-dashed border-border p-12 text-center">
                <Rocket size={26} className="mx-auto text-muted-foreground" />
                <p className="mt-2 text-sm text-muted-foreground">
                  Select a company on the left, or start a new one.
                </p>
              </div>
            )}

            {!creating && selectedId && detail && (
              <CompanyWorkspace
                key={selectedId}
                company={detail.company}
                analyses={detail.analyses}
                tab={tab}
                setTab={setTab}
                onDeleted={() => {
                  setSelectedId(null);
                  qc.invalidateQueries({ queryKey: ["pre-sprint-companies"] });
                }}
                refetch={() => qc.invalidateQueries({ queryKey: ["pre-sprint-company", selectedId] })}
              />
            )}
          </div>
        </div>
      </div>
    </Layout>
  );
}

/* ─────────────────────── create new company ────────────────────────────── */
function CreateCompany({ onCreated }: { onCreated: (c: Company) => void }) {
  const { toast } = useToast();
  const [name, setName] = useState("");
  const [website, setWebsite] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);

  async function create() {
    if (!name.trim()) { toast({ title: "Company name is required", variant: "destructive" }); return; }
    setBusy(true);
    try {
      const res = await fetch(api("/pre-sprint/companies"), {
        method: "POST", credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ companyName: name.trim(), websiteUrl: website.trim() || undefined }),
      });
      if (!res.ok) throw new Error((await res.json()).error || "Failed to create");
      const { company } = await res.json();

      if (file) {
        const fd = new FormData();
        fd.append("file", file);
        if (website.trim()) fd.append("websiteUrl", website.trim());
        fd.append("companyId", String(company.id));
        const ex = await fetch(api("/pre-sprint/extract"), { method: "POST", credentials: "include", body: fd });
        if (!ex.ok) toast({ title: "Company created — deck couldn’t be read", description: (await ex.json()).error, variant: "destructive" });
        else toast({ title: "Deck read", description: "Profile pre-filled from the deck." });
      }
      onCreated(company);
    } catch (e: any) {
      toast({ title: "Couldn’t create company", description: e.message, variant: "destructive" });
    } finally { setBusy(false); }
  }

  return (
    <div className="rounded-xl border border-border bg-card p-5">
      <div className="mb-3 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">New company</div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <FieldLabel>Company name *</FieldLabel>
          <input value={name} onChange={(e) => setName(e.target.value)} className="ts-input" placeholder="e.g. Gofitzen" />
        </div>
        <div className="sm:col-span-2">
          <FieldLabel>Website (optional)</FieldLabel>
          <div className="relative">
            <Link2 size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <input value={website} onChange={(e) => setWebsite(e.target.value)} className="ts-input pl-8" placeholder="gofitzen.com" />
          </div>
        </div>
        <div className="sm:col-span-2">
          <FieldLabel>Pitch deck (PDF)</FieldLabel>
          <label className="flex cursor-pointer items-center gap-3 rounded-lg border border-dashed border-border px-4 py-4"
            style={{ background: file ? "hsl(36 65% 96%)" : undefined }}>
            <input type="file" accept=".pdf,.docx,.txt,.md" className="hidden" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
            {file ? <FileText size={20} style={{ color: GOLD }} /> : <Upload size={20} className="text-muted-foreground" />}
            <span className="text-sm text-foreground">{file ? file.name : "Choose a deck — the AI will read it"}</span>
          </label>
        </div>
      </div>
      <button onClick={create} disabled={busy}
        className="mt-4 inline-flex items-center gap-2 rounded-lg px-4 py-2.5 text-sm font-semibold"
        style={{ background: GOLD, color: "hsl(222 38% 15%)" }}>
        {busy ? <Loader2 size={15} className="animate-spin" /> : <Wand2 size={15} />}
        {busy ? "Creating & reading deck…" : "Create & read deck"}
      </button>
      <FieldStyles />
    </div>
  );
}

/* ─────────────────────── company workspace ─────────────────────────────── */
function CompanyWorkspace({
  company, analyses, tab, setTab, onDeleted, refetch,
}: {
  company: Company; analyses: Analyses; tab: TabKey; setTab: (t: TabKey) => void;
  onDeleted: () => void; refetch: () => void;
}) {
  const { toast } = useToast();
  const [form, setForm] = useState<Form>(formFromCompany(company));
  const [extracting, setExtracting] = useState(false);
  const [deckFile, setDeckFile] = useState<File | null>(null);
  const dirty = useRef(false);

  // autosave (debounced) whenever a field changes
  useEffect(() => {
    if (!dirty.current) return;
    const t = setTimeout(() => { void saveDraft(); }, 900);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form]);

  async function saveDraft() {
    dirty.current = false;
    await fetch(api(`/pre-sprint/companies/${company.id}`), {
      method: "PATCH", credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(form),
    }).catch(() => {});
  }
  function set<K extends keyof Form>(k: K, v: string) { dirty.current = true; setForm((f) => ({ ...f, [k]: v })); }

  async function switchTab(t: TabKey) { if (dirty.current) await saveDraft(); setTab(t); }

  async function autofill() {
    if (!deckFile) { toast({ title: "Attach a deck to auto-fill", variant: "destructive" }); return; }
    setExtracting(true);
    try {
      const fd = new FormData();
      fd.append("file", deckFile);
      if (form.websiteUrl) fd.append("websiteUrl", form.websiteUrl);
      fd.append("companyId", String(company.id));
      const res = await fetch(api("/pre-sprint/extract"), { method: "POST", credentials: "include", body: fd });
      if (!res.ok) throw new Error((await res.json()).error || "Extraction failed");
      const { profile } = await res.json();
      setForm((f) => ({
        ...f,
        companyName: profile.companyName || f.companyName,
        industry: profile.industry || f.industry,
        businessStage: profile.businessStage || f.businessStage,
        specialization: profile.specialization || f.specialization,
        revenueStage: profile.revenueStage || f.revenueStage,
        productDescription: profile.productDescription || f.productDescription,
      }));
      dirty.current = true;
      toast({ title: "Deck read", description: "Fields pre-filled — review and correct." });
    } catch (e: any) {
      toast({ title: "Couldn’t read the deck", description: e.message, variant: "destructive" });
    } finally { setExtracting(false); }
  }

  async function remove() {
    if (!confirm(`Delete ${company.companyName} and all its analyses? This can’t be undone.`)) return;
    await fetch(api(`/pre-sprint/companies/${company.id}`), { method: "DELETE", credentials: "include" });
    onDeleted();
  }

  return (
    <div>
      <div className="mb-4 flex items-center justify-between gap-3">
        <h2 className="font-serif text-2xl text-foreground">{form.companyName || company.companyName}</h2>
        <button onClick={remove} className="inline-flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 text-xs text-muted-foreground hover:text-destructive">
          <Trash2 size={13} /> Delete
        </button>
      </div>

      {/* intake */}
      <div className="rounded-xl border border-border bg-card p-5">
        <div className="mb-3 flex items-center justify-between">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Company profile</div>
          <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground"><Check size={12} style={{ color: GOLD }} /> Autosaves</span>
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <F label="Company name"><input className="ts-input" value={form.companyName} onChange={(e) => set("companyName", e.target.value)} onBlur={saveDraft} /></F>
          <F label="Industry"><input className="ts-input" value={form.industry} onChange={(e) => set("industry", e.target.value)} onBlur={saveDraft} /></F>
          <F label="Business stage"><input className="ts-input" value={form.businessStage} onChange={(e) => set("businessStage", e.target.value)} onBlur={saveDraft} /></F>
          <F label="Revenue stage"><input className="ts-input" value={form.revenueStage} onChange={(e) => set("revenueStage", e.target.value)} onBlur={saveDraft} /></F>
          <F label="Specialization" full><input className="ts-input" value={form.specialization} onChange={(e) => set("specialization", e.target.value)} onBlur={saveDraft} /></F>
          <F label="Website" full>
            <div className="relative">
              <Link2 size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <input className="ts-input pl-8" value={form.websiteUrl} onChange={(e) => set("websiteUrl", e.target.value)} onBlur={saveDraft} />
            </div>
          </F>
          <F label="Product description" full>
            <textarea rows={3} className="ts-input" value={form.productDescription} onChange={(e) => set("productDescription", e.target.value)} onBlur={saveDraft} />
          </F>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-3">
          <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm text-foreground">
            <input type="file" accept=".pdf,.docx,.txt,.md" className="hidden" onChange={(e) => setDeckFile(e.target.files?.[0] ?? null)} />
            {deckFile ? <FileText size={15} style={{ color: GOLD }} /> : <Upload size={15} className="text-muted-foreground" />}
            {deckFile ? deckFile.name : "Attach deck"}
          </label>
          <button onClick={autofill} disabled={extracting}
            className="inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-sm font-medium"
            style={{ borderColor: "hsl(var(--primary))", color: "hsl(var(--primary))" }}>
            {extracting ? <Loader2 size={15} className="animate-spin" /> : <Wand2 size={15} />}
            {extracting ? "Reading…" : "Auto-fill from deck + website"}
          </button>
        </div>
      </div>

      {/* tabs */}
      <div className="mt-6 flex flex-wrap gap-1 rounded-xl border border-border p-1" style={{ background: "hsl(220 18% 94%)" }}>
        {PRE_TABS.map(({ key, label, icon: Icon }) => {
          const on = tab === key;
          return (
            <button key={key} onClick={() => switchTab(key)}
              className="flex items-center gap-2 rounded-lg px-3.5 py-2 text-sm font-medium transition-colors"
              style={{ background: on ? "hsl(var(--card))" : "transparent", color: on ? "hsl(var(--primary))" : "hsl(var(--muted-foreground))" }}>
              <Icon size={14} style={{ color: on ? GOLD : "currentColor" }} /> {label}
            </button>
          );
        })}
      </div>

      <div className="mt-5">
        {tab === "overview" && <ToolPanel companyId={company.id} tool="company_overview" cached={analyses.company_overview} refetch={refetch} render={renderOverview} label="Overview" desc="A crisp read of the company from its own deck & website." />}
        {tab === "research" && <ResearchTools companyId={company.id} analyses={analyses} refetch={refetch} />}
        {tab === "market" && <ToolPanel companyId={company.id} tool="blue_red_ocean" cached={analyses.blue_red_ocean} refetch={refetch} render={renderOcean} label="Blue / Red Ocean" desc="Grounded industry-concentration analysis on the main offering, with sources." grounded />}
        {tab === "demand" && <ToolPanel companyId={company.id} tool="demand_landscape" cached={analyses.demand_landscape} refetch={refetch} render={renderDemand} label="Demand Landscape" desc="Where demand concentrates across India (and abroad), with sources." grounded />}
      </div>
      <FieldStyles />
    </div>
  );
}

/* ─────────────────────── generic tool panel (cache-aware) ──────────────── */
function ToolPanel({
  companyId, tool, cached, refetch, render, label, desc, grounded,
}: {
  companyId: number; tool: string; cached?: { output: any; updatedAt: string };
  refetch: () => void; render: (o: any) => React.ReactNode; label: string; desc: string; grounded?: boolean;
}) {
  const { toast } = useToast();
  const gen = useMutation({
    mutationFn: async () => {
      const res = await fetch(api(`/pre-sprint/companies/${companyId}/generate`), {
        method: "POST", credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ tool }),
      });
      if (!res.ok) throw new Error((await res.json()).error || "Generation failed");
      return res.json();
    },
    onSuccess: () => { refetch(); toast({ title: `${label} ready` }); },
    onError: (e: any) => toast({ title: "Generation failed", description: e.message, variant: "destructive" }),
  });

  if (!cached?.output) {
    return (
      <div className="rounded-xl border border-border bg-card p-8 text-center">
        <Sparkles size={22} className="mx-auto" style={{ color: GOLD }} />
        <div className="mt-2 font-medium text-foreground">{label}</div>
        <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">{desc}</p>
        {grounded && <p className="mt-1 text-xs text-muted-foreground">Uses live web sources — takes ~10–20s.</p>}
        <button onClick={() => gen.mutate()} disabled={gen.isPending}
          className="mt-4 inline-flex items-center gap-2 rounded-lg px-4 py-2.5 text-sm font-semibold"
          style={{ background: GOLD, color: "hsl(222 38% 15%)" }}>
          {gen.isPending ? <Loader2 size={15} className="animate-spin" /> : <Sparkles size={15} />}
          {gen.isPending ? "Generating…" : "Generate"}
        </button>
      </div>
    );
  }
  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
          <Check size={13} style={{ color: GOLD }} /> Generated {new Date(cached.updatedAt).toLocaleDateString()}
        </span>
        <button onClick={() => gen.mutate()} disabled={gen.isPending}
          className="inline-flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 text-xs text-muted-foreground hover:text-foreground">
          {gen.isPending ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />} Regenerate
        </button>
      </div>
      {render(cached.output)}
    </div>
  );
}

/* ─────────────────────── Research Tools (4 cards) ──────────────────────── */
function ResearchTools({ companyId, analyses, refetch }: { companyId: number; analyses: Analyses; refetch: () => void }) {
  const tools = [
    { tool: "icp_mapping", label: "ICP Mapping", icon: Target },
    { tool: "tam_sam_som", label: "TAM / SAM / SOM", icon: BarChart3 },
    { tool: "industry_landscape", label: "Industry Landscape", icon: Globe },
    { tool: "business_model_canvas", label: "Business Model Canvas", icon: Layers },
  ] as const;
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm" style={{ background: "hsl(36 65% 96%)", color: "hsl(30 60% 30%)" }}>
        <Wand2 size={15} /> Inputs come from the profile above — no retyping. Each result is saved and shown here.
      </div>
      {tools.map(({ tool, label, icon: Icon }) => (
        <div key={tool} className="rounded-xl border border-border bg-card p-5">
          <div className="mb-2 flex items-center gap-2">
            <Icon size={16} style={{ color: GOLD }} />
            <span className="font-medium text-foreground">{label}</span>
          </div>
          <ToolPanel companyId={companyId} tool={tool} cached={analyses[tool]} refetch={refetch}
            render={tool === "tam_sam_som" ? renderTam : renderGeneric} label={label} desc={`Generate ${label} from the profile.`} />
        </div>
      ))}
    </div>
  );
}

/* ─────────────────────── renderers ─────────────────────────────────────── */
function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mb-3">
      <div className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{title}</div>
      {children}
    </div>
  );
}
function Chips({ items }: { items: string[] }) {
  return <div className="flex flex-wrap gap-1.5">{(items ?? []).map((x, i) => (
    <span key={i} className="rounded-full border border-border bg-card px-2.5 py-1 text-[11px] text-foreground">{x}</span>
  ))}</div>;
}
function Sources({ sources }: { sources?: { id: number; title: string; url: string }[] }) {
  if (!sources?.length) return (
    <p className="mt-3 flex items-center gap-1.5 text-xs text-muted-foreground"><AlertTriangle size={12} /> No live sources returned — verify figures independently.</p>
  );
  return (
    <div className="mt-4 rounded-lg border border-border p-3">
      <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Sources</div>
      <ol className="space-y-1 text-xs">
        {sources.map((s) => (
          <li key={s.id} className="flex gap-1.5">
            <span className="text-muted-foreground">[{s.id}]</span>
            <a href={s.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-foreground underline decoration-dotted">
              {s.title} <ExternalLink size={11} />
            </a>
          </li>
        ))}
      </ol>
    </div>
  );
}

function renderOverview(o: any) {
  return (
    <div className="rounded-xl border border-border bg-card p-5">
      {o.snapshot && <p className="mb-4 text-[15px] leading-relaxed text-foreground">{o.snapshot}</p>}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {o.offerings && <Section title="Products / offerings"><Chips items={o.offerings} /></Section>}
        {o.targetAudience && <Section title="Target audience"><Chips items={o.targetAudience} /></Section>}
        {o.customerSegments && <Section title="Customer segments"><Chips items={o.customerSegments} /></Section>}
        {o.geography && <Section title="Geography"><Chips items={o.geography} /></Section>}
        {o.pricing && <Section title="Pricing"><p className="text-sm text-foreground">{o.pricing}</p></Section>}
        {o.revenue && <Section title="Revenue"><p className="text-sm text-foreground">{o.revenue}</p></Section>}
      </div>
      {o.edge && <div className="mt-2 rounded-lg p-4" style={{ background: "hsl(221 39% 13%)" }}>
        <div className="mb-1 text-[10px] font-semibold uppercase tracking-[0.18em]" style={{ color: "rgba(255,255,255,.6)" }}>Edge</div>
        <p className="text-sm text-white">{o.edge}</p>
      </div>}
      {o.gaps?.length > 0 && <div className="mt-3">
        <Section title="Confirm with the founder"><ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">{o.gaps.map((g: string, i: number) => <li key={i}>{g}</li>)}</ul></Section>
      </div>}
    </div>
  );
}

function renderTam(o: any) {
  // Best-effort: pull tam/sam/som strings from any shape.
  const get = (k: string) => o?.[k] ?? o?.[k.toUpperCase()] ?? o?.[k.toLowerCase()];
  const rows = [["TAM", get("tam")], ["SAM", get("sam")], ["SOM", get("som")]].filter((r) => r[1]);
  return (
    <div className="rounded-xl border border-border bg-card p-5">
      {rows.length > 0 ? (
        <div className="space-y-3">
          {rows.map(([l, v]: any, i) => (
            <div key={l}>
              <div className="mb-1 flex justify-between text-xs"><span className="text-muted-foreground">{l}</span><span className="text-foreground">{typeof v === "string" ? v : v?.value ?? JSON.stringify(v)}</span></div>
              <div className="h-2 rounded-full" style={{ background: "hsl(220 18% 94%)" }}>
                <div className="h-2 rounded-full" style={{ width: `${100 - i * 40}%`, background: "linear-gradient(90deg, hsl(221 39% 13%), var(--gold))" }} />
              </div>
            </div>
          ))}
        </div>
      ) : renderGeneric(o)}
      {(o.assumptions || o.method || o.reasoning) && (
        <p className="mt-3 text-xs text-muted-foreground">{o.assumptions ?? o.method ?? o.reasoning}</p>
      )}
      <p className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground"><AlertTriangle size={12} /> Estimates — verify against primary sources before using in a deck.</p>
    </div>
  );
}

function renderOcean(o: any) {
  const segs = o.segments ?? [];
  const W = 560, H = 340, P = 44;
  const X = (v: number) => P + (v / 100) * (W - P * 2);
  const Y = (v: number) => H - P - (v / 100) * (H - P * 2);
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
      <div className="rounded-xl border border-border bg-card p-5 lg:col-span-2">
        <svg viewBox={`0 0 ${W} ${H}`} className="w-full">
          <rect x={P} y={P} width={(W - P * 2) / 2} height={(H - P * 2) / 2} fill="hsl(205 70% 95%)" />
          <rect x={W / 2} y={H / 2} width={(W - P * 2) / 2} height={(H - P * 2) / 2} fill="hsl(8 70% 96%)" />
          <line x1={P} y1={H - P} x2={W - P} y2={H - P} stroke="hsl(var(--border))" />
          <line x1={P} y1={P} x2={P} y2={H - P} stroke="hsl(var(--border))" />
          <text x={W / 2} y={H - 12} textAnchor="middle" fontSize="11" fill="hsl(var(--muted-foreground))">Market saturation →</text>
          <text x={-H / 2} y={16} transform="rotate(-90)" textAnchor="middle" fontSize="11" fill="hsl(var(--muted-foreground))">Growth potential →</text>
          <text x={P + 6} y={P + 16} fontSize="11" fontWeight="700" fill="hsl(205 60% 40%)">BLUE OCEAN</text>
          <text x={W - P - 6} y={H - P - 8} textAnchor="end" fontSize="11" fontWeight="700" fill="hsl(8 60% 48%)">RED OCEAN</text>
          {segs.map((s: any, i: number) => {
            const blue = s.ocean === "blue";
            const r = 14 + (s.growthPotential ?? 40) / 6;
            return (
              <g key={i}>
                <circle cx={X(s.saturation ?? 50)} cy={Y(s.growthPotential ?? 50)} r={r}
                  fill={blue ? "hsl(205 75% 55% / .5)" : "hsl(8 70% 58% / .5)"}
                  stroke={blue ? "hsl(205 75% 42%)" : "hsl(8 70% 48%)"} strokeWidth="1.5" />
                <text x={X(s.saturation ?? 50)} y={Y(s.growthPotential ?? 50) + r + 11} textAnchor="middle" fontSize="9" fill="hsl(var(--foreground))">{s.name}</text>
              </g>
            );
          })}
        </svg>
      </div>
      <div className="space-y-4">
        <div className="rounded-xl border border-border bg-card p-4" style={{ borderLeft: "3px solid hsl(205 75% 55%)" }}>
          <div className="mb-1 flex items-center gap-1.5 font-medium text-foreground"><Waves size={15} style={{ color: "hsl(205 70% 45%)" }} /> Blue ocean</div>
          <ul className="space-y-1 text-sm text-muted-foreground">{(o.blueOcean ?? []).map((t: string, i: number) => <li key={i}>• {t}</li>)}</ul>
        </div>
        <div className="rounded-xl border border-border bg-card p-4" style={{ borderLeft: "3px solid hsl(8 70% 58%)" }}>
          <div className="mb-1 flex items-center gap-1.5 font-medium text-foreground"><Flame size={15} style={{ color: "hsl(8 65% 50%)" }} /> Red ocean</div>
          <ul className="space-y-1 text-sm text-muted-foreground">{(o.redOcean ?? []).map((t: string, i: number) => <li key={i}>• {t}</li>)}</ul>
        </div>
      </div>
      <div className="lg:col-span-3"><Sources sources={o.sources} /></div>
    </div>
  );
}

function renderDemand(o: any) {
  return (
    <div className="rounded-xl border border-border bg-card p-5">
      {o.summary && <p className="mb-4 text-sm leading-relaxed text-foreground">{o.summary}</p>}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-5">
        <div className="lg:col-span-3">
          <div className="mb-2 flex items-center gap-2 text-sm font-medium text-foreground"><Map size={14} style={{ color: GOLD }} /> India</div>
          <IndiaChoropleth india={o.india ?? []} />
        </div>
        <div className="lg:col-span-2">
          <div className="mb-2 flex items-center gap-2 text-sm font-medium text-foreground"><Globe size={14} style={{ color: GOLD }} /> Global</div>
          <div className="space-y-2">
            {(o.global ?? []).length === 0 && <p className="text-sm text-muted-foreground">No overseas markets identified.</p>}
            {(o.global ?? []).map((g: any, i: number) => (
              <div key={i} className="rounded-lg border border-border p-2.5">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-foreground">{g.region}</span>
                  <span className="text-xs text-muted-foreground">{g.demand}</span>
                </div>
                <div className="mt-1 h-1.5 rounded-full" style={{ background: "hsl(220 18% 94%)" }}>
                  <div className="h-1.5 rounded-full" style={{ width: `${g.demand}%`, background: GOLD }} />
                </div>
                {g.note && <p className="mt-1 text-[11px] text-muted-foreground">{g.note}</p>}
              </div>
            ))}
          </div>
        </div>
      </div>
      <Sources sources={o.sources} />
    </div>
  );
}

// Dependency-free choropleth: equirectangular projection of the states GeoJSON.
function IndiaChoropleth({ india }: { india: { state: string; demand: number; note?: string }[] }) {
  const [geo, setGeo] = useState<any>(null);
  const [hover, setHover] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    fetch(`${BASE}/india-states.geojson`).then((r) => r.json()).then((g) => { if (alive) setGeo(g); }).catch(() => {});
    return () => { alive = false; };
  }, []);
  const demandBy = useMemo(() => {
    const m: Record<string, number> = {};
    for (const d of india) m[d.state] = d.demand;
    return m;
  }, [india]);

  const W = 460, H = 520, PAD = 12;
  const { paths, ok } = useMemo(() => {
    if (!geo) return { paths: [] as any[], ok: false };
    let minLon = 180, maxLon = -180, minLat = 90, maxLat = -90;
    const rings: { name: string; polys: number[][][] }[] = [];
    for (const f of geo.features) {
      const name = f.properties?.NAME_1 ?? f.properties?.name ?? "";
      const geom = f.geometry; if (!geom) continue;
      const polys = geom.type === "Polygon" ? geom.coordinates : geom.type === "MultiPolygon" ? geom.coordinates.flat() : [];
      for (const ring of polys) for (const [lon, lat] of ring) {
        if (lon < minLon) minLon = lon; if (lon > maxLon) maxLon = lon;
        if (lat < minLat) minLat = lat; if (lat > maxLat) maxLat = lat;
      }
      rings.push({ name, polys });
    }
    const sx = (W - PAD * 2) / (maxLon - minLon);
    const sy = (H - PAD * 2) / (maxLat - minLat);
    const s = Math.min(sx, sy);
    const ox = PAD + ((W - PAD * 2) - s * (maxLon - minLon)) / 2;
    const oy = PAD + ((H - PAD * 2) - s * (maxLat - minLat)) / 2;
    const px = (lon: number) => ox + (lon - minLon) * s;
    const py = (lat: number) => oy + (maxLat - lat) * s;
    const paths = rings.map((r) => ({
      name: r.name,
      d: r.polys.map((ring) => "M" + ring.map(([lon, lat]) => `${px(lon).toFixed(1)},${py(lat).toFixed(1)}`).join("L") + "Z").join(" "),
    }));
    return { paths, ok: true };
  }, [geo]);

  const color = (v: number) => {
    if (!v) return "hsl(220 18% 92%)";
    const l = 78 - (Math.min(v, 100) / 100) * 40; // 78% → 38%
    return `hsl(36 72% ${l}%)`;
  };
  if (!ok) return <div className="flex h-64 items-center justify-center rounded-lg border border-border text-sm text-muted-foreground"><Loader2 size={16} className="mr-2 animate-spin" /> Loading map…</div>;

  return (
    <div className="relative">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full">
        {paths.map((p) => {
          const v = demandBy[p.name] ?? 0;
          const on = hover === p.name;
          return <path key={p.name} d={p.d} fill={color(v)} stroke={on ? "hsl(221 39% 13%)" : "white"} strokeWidth={on ? 1.4 : 0.5}
            onMouseEnter={() => setHover(p.name)} onMouseLeave={() => setHover(null)} style={{ cursor: "pointer" }} />;
        })}
      </svg>
      {hover && (
        <div className="pointer-events-none absolute right-2 top-2 rounded-lg px-3 py-2 text-white" style={{ background: "hsl(221 39% 13%)" }}>
          <div className="text-sm font-medium">{hover}</div>
          <div className="text-[11px]" style={{ color: "rgba(255,255,255,.7)" }}>Demand {demandBy[hover] ?? 0}</div>
        </div>
      )}
      <div className="mt-2 flex items-center gap-2 text-[10px] text-muted-foreground">
        <span>Low</span>
        <div className="h-2 flex-1 rounded-full" style={{ background: `linear-gradient(90deg, ${color(8)}, ${color(50)}, ${color(100)})` }} />
        <span>High</span>
      </div>
    </div>
  );
}

// Fallback renderer for arbitrary structured output (ICP, BMC, landscape…).
function renderGeneric(o: any): React.ReactNode {
  if (o == null) return null;
  if (typeof o === "string" || typeof o === "number") return <p className="text-sm text-foreground">{String(o)}</p>;
  if (Array.isArray(o)) {
    if (o.every((x) => typeof x === "string" || typeof x === "number"))
      return <ul className="list-disc space-y-1 pl-5 text-sm text-foreground">{o.map((x, i) => <li key={i}>{String(x)}</li>)}</ul>;
    return <div className="space-y-3">{o.map((x, i) => <div key={i} className="rounded-lg border border-border p-3">{renderGeneric(x)}</div>)}</div>;
  }
  return (
    <div className="rounded-xl border border-border bg-card p-5">
      {Object.entries(o).map(([k, v]) => (
        <div key={k} className="mb-3 last:mb-0">
          <div className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{k.replace(/([A-Z])/g, " $1").replace(/_/g, " ")}</div>
          {renderGeneric(v)}
        </div>
      ))}
    </div>
  );
}

/* ─────────────────────── small helpers ─────────────────────────────────── */
function FieldLabel({ children }: { children: React.ReactNode }) {
  return <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{children}</label>;
}
function F({ label, children, full }: { label: string; children: React.ReactNode; full?: boolean }) {
  return <div className={full ? "sm:col-span-2" : ""}><FieldLabel>{label}</FieldLabel>{children}</div>;
}
function FieldStyles() {
  return (
    <style>{`
      .ts-input {
        width: 100%; border: 1px solid hsl(var(--border)); border-radius: 0.5rem;
        padding: 0.5rem 0.625rem; font-size: 0.875rem; background: hsl(var(--card));
        color: hsl(var(--foreground)); outline: none;
      }
      .ts-input:focus { border-color: var(--gold); }
    `}</style>
  );
}
