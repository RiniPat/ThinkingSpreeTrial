import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react";
import { Layout } from "@/components/Layout";
import { useToast } from "@/hooks/use-toast";
import {
  Rocket, Upload, FileText, Wand2, Loader2, Sparkles, Plus, Trash2, Check,
  Link2, Layers, Users, Target, Globe, BarChart3, Waves, Flame, Map,
  ExternalLink, RefreshCw, AlertTriangle, TrendingUp, Share2, Handshake,
} from "lucide-react";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");
const api = (p: string) => `${BASE}/api${p}`;
const GOLD = "var(--gold)";
const NAVY = "hsl(221 39% 13%)";

type Company = {
  id: number; companyName: string; industry?: string | null; stage?: string | null;
  specialization?: string | null; revenueStage?: string | null; description?: string | null;
  websiteUrl?: string | null; deckText?: string | null;
};
type Analyses = Record<string, { output: any; updatedAt: string }>;

const PRE_TABS = [
  { key: "overview", label: "Overview", icon: FileText },
  { key: "research", label: "Research Tools", icon: Sparkles },
  { key: "market", label: "Market Potential", icon: Waves },
  { key: "demand", label: "Demand Landscape", icon: Map },
] as const;
type TabKey = (typeof PRE_TABS)[number]["key"];

type Form = {
  companyName: string; industry: string; businessStage: string;
  specialization: string; revenueStage: string; productDescription: string; websiteUrl: string;
};
const emptyForm: Form = { companyName: "", industry: "", businessStage: "", specialization: "", revenueStage: "", productDescription: "", websiteUrl: "" };
function formFromCompany(c: Company): Form {
  return {
    companyName: c.companyName ?? "", industry: c.industry ?? "", businessStage: c.stage ?? "",
    specialization: c.specialization ?? "", revenueStage: c.revenueStage ?? "",
    productDescription: c.description ?? "", websiteUrl: c.websiteUrl ?? "",
  };
}

export default function PreSprintPage() {
  const qc = useQueryClient();
  const [selectedId, setSelectedId] = useState<number | null>(null);
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
              Drop the deck once — the AI reads it and powers every analysis below. Everything is saved as you go.
            </p>
          </div>
          <button onClick={() => { setSelectedId(null); setTab("overview"); }}
            className="inline-flex items-center gap-2 rounded-lg px-4 py-2.5 text-sm font-semibold"
            style={{ background: GOLD, color: "hsl(222 38% 15%)" }}>
            <Plus size={15} /> New company
          </button>
        </div>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[248px_1fr]">
          <aside>
            <div className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Saved companies</div>
            <div className="space-y-1">
              {companies.length === 0 && !companiesQ.isLoading && (
                <div className="rounded-lg border border-dashed border-border p-3 text-xs text-muted-foreground">Fill the form → it saves here automatically.</div>
              )}
              {companies.map((c) => (
                <button key={c.id} onClick={() => { setSelectedId(c.id); setTab("overview"); }}
                  className="flex w-full items-center gap-2 rounded-lg border px-3 py-2 text-left text-sm"
                  style={{ borderColor: selectedId === c.id ? "var(--gold)" : "hsl(var(--border))", background: selectedId === c.id ? "hsl(36 65% 96%)" : "hsl(var(--card))" }}>
                  <Rocket size={14} className="shrink-0 text-muted-foreground" />
                  <span className="truncate text-foreground">{c.companyName}</span>
                </button>
              ))}
            </div>
          </aside>

          <div className="min-w-0">
            <CompanyWorkspace
              key={selectedId ?? "draft"}
              company={selectedId ? detailQ.data?.company ?? null : null}
              analyses={selectedId ? detailQ.data?.analyses ?? {} : {}}
              tab={tab} setTab={setTab}
              onSaved={(c) => { setSelectedId(c.id); qc.invalidateQueries({ queryKey: ["pre-sprint-companies"] }); }}
              onDeleted={() => { setSelectedId(null); qc.invalidateQueries({ queryKey: ["pre-sprint-companies"] }); }}
              refetch={() => qc.invalidateQueries({ queryKey: ["pre-sprint-company", selectedId] })}
            />
          </div>
        </div>
      </div>
    </Layout>
  );
}

/* ─────────────────────── workspace (draft or saved) ────────────────────── */
function CompanyWorkspace({
  company, analyses, tab, setTab, onSaved, onDeleted, refetch,
}: {
  company: Company | null; analyses: Analyses; tab: TabKey; setTab: (t: TabKey) => void;
  onSaved: (c: Company) => void; onDeleted: () => void; refetch: () => void;
}) {
  const { toast } = useToast();
  const [id, setId] = useState<number | null>(company?.id ?? null);
  const [form, setForm] = useState<Form>(company ? formFromCompany(company) : emptyForm);
  const [deckFile, setDeckFile] = useState<File | null>(null);
  const [extracting, setExtracting] = useState(false);
  const [saving, setSaving] = useState(false);
  const dirty = useRef(false);

  useEffect(() => { setId(company?.id ?? null); if (company) setForm(formFromCompany(company)); }, [company?.id]);

  // debounced autosave once a company exists
  useEffect(() => {
    if (!id || !dirty.current) return;
    const t = setTimeout(() => { void saveDraft(); }, 900);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form, id]);

  async function ensureCompany(): Promise<number | null> {
    if (id) return id;
    if (!form.companyName.trim()) return null;
    setSaving(true);
    try {
      const res = await fetch(api("/pre-sprint/companies"), {
        method: "POST", credentials: "include", headers: { "content-type": "application/json" },
        body: JSON.stringify(form),
      });
      if (!res.ok) throw new Error((await res.json()).error || "Failed to save");
      const { company: c } = await res.json();
      setId(c.id); onSaved(c);
      return c.id;
    } catch (e: any) { toast({ title: "Couldn’t save", description: e.message, variant: "destructive" }); return null; }
    finally { setSaving(false); }
  }

  async function saveDraft() {
    const cid = id; if (!cid) return; dirty.current = false;
    await fetch(api(`/pre-sprint/companies/${cid}`), {
      method: "PATCH", credentials: "include", headers: { "content-type": "application/json" }, body: JSON.stringify(form),
    }).catch(() => {});
  }
  function set<K extends keyof Form>(k: K, v: string) { dirty.current = true; setForm((f) => ({ ...f, [k]: v })); }
  async function onNameBlur() { if (!id && form.companyName.trim()) await ensureCompany(); else await saveDraft(); }
  async function switchTab(t: TabKey) { if (id && dirty.current) await saveDraft(); setTab(t); }

  async function autofill() {
    if (!deckFile) { toast({ title: "Attach a deck to auto-fill", variant: "destructive" }); return; }
    setExtracting(true);
    try {
      const cid = await ensureCompanyIfNamed();
      const fd = new FormData();
      fd.append("file", deckFile);
      if (form.websiteUrl) fd.append("websiteUrl", form.websiteUrl);
      if (cid) fd.append("companyId", String(cid));
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
      if (!cid && profile.companyName) { /* create now that we have a name */ setTimeout(() => { void ensureCompany(); }, 0); }
      toast({ title: "Deck read", description: "Fields pre-filled — review & correct." });
    } catch (e: any) { toast({ title: "Couldn’t read the deck", description: e.message, variant: "destructive" }); }
    finally { setExtracting(false); }
  }
  // extract can run before a name exists; only create if we already have one
  async function ensureCompanyIfNamed() { return id ?? (form.companyName.trim() ? await ensureCompany() : null); }

  async function remove() {
    if (!id) { onDeleted(); return; }
    if (!confirm(`Delete ${form.companyName || "this company"} and all its analyses?`)) return;
    await fetch(api(`/pre-sprint/companies/${id}`), { method: "DELETE", credentials: "include" });
    onDeleted();
  }

  return (
    <div>
      <div className="mb-4 flex items-center justify-between gap-3">
        <h2 className="font-serif text-2xl text-foreground">{form.companyName || "New company"}</h2>
        <div className="flex items-center gap-2">
          {id ? <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground"><Check size={12} style={{ color: GOLD }} /> Saved</span>
              : <span className="text-[11px] text-muted-foreground">Not saved yet</span>}
          <button onClick={remove} className="inline-flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 text-xs text-muted-foreground hover:text-destructive"><Trash2 size={13} /> {id ? "Delete" : "Clear"}</button>
        </div>
      </div>

      {/* intake */}
      <div className="rounded-xl border border-border bg-card p-5">
        <div className="mb-3 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Company profile</div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <F label="Company name *"><input className="ts-input" value={form.companyName} onChange={(e) => set("companyName", e.target.value)} onBlur={onNameBlur} placeholder="e.g. Gofitzen" /></F>
          <F label="Industry"><input className="ts-input" value={form.industry} onChange={(e) => set("industry", e.target.value)} onBlur={saveDraft} /></F>
          <F label="Business stage"><input className="ts-input" value={form.businessStage} onChange={(e) => set("businessStage", e.target.value)} onBlur={saveDraft} /></F>
          <F label="Revenue stage"><input className="ts-input" value={form.revenueStage} onChange={(e) => set("revenueStage", e.target.value)} onBlur={saveDraft} /></F>
          <F label="Specialization" full><input className="ts-input" value={form.specialization} onChange={(e) => set("specialization", e.target.value)} onBlur={saveDraft} /></F>
          <F label="Website" full>
            <div className="relative"><Link2 size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <input className="ts-input pl-8" value={form.websiteUrl} onChange={(e) => set("websiteUrl", e.target.value)} onBlur={saveDraft} placeholder="company.com" /></div>
          </F>
          <F label="Product description" full><textarea rows={3} className="ts-input" value={form.productDescription} onChange={(e) => set("productDescription", e.target.value)} onBlur={saveDraft} /></F>
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm text-foreground">
            <input type="file" accept=".pdf,.docx,.txt,.md" className="hidden" onChange={(e) => setDeckFile(e.target.files?.[0] ?? null)} />
            {deckFile ? <FileText size={15} style={{ color: GOLD }} /> : <Upload size={15} className="text-muted-foreground" />}
            {deckFile ? deckFile.name : "Attach pitch deck (PDF)"}
          </label>
          <button onClick={autofill} disabled={extracting}
            className="inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-sm font-medium"
            style={{ borderColor: "hsl(var(--primary))", color: "hsl(var(--primary))" }}>
            {extracting ? <Loader2 size={15} className="animate-spin" /> : <Wand2 size={15} />}
            {extracting ? "Reading…" : "Auto-fill from deck + website"}
          </button>
          {!id && <span className="text-xs text-muted-foreground">{saving ? "Saving…" : "Saves automatically once named"}</span>}
        </div>
      </div>

      {/* tabs only after a company exists */}
      {id ? (
        <>
          <div className="mt-6 flex flex-wrap gap-1 rounded-xl border border-border p-1" style={{ background: "hsl(220 18% 94%)" }}>
            {PRE_TABS.map(({ key, label, icon: Icon }) => {
              const on = tab === key;
              return (
                <button key={key} onClick={() => switchTab(key)} className="flex items-center gap-2 rounded-lg px-3.5 py-2 text-sm font-medium"
                  style={{ background: on ? "hsl(var(--card))" : "transparent", color: on ? "hsl(var(--primary))" : "hsl(var(--muted-foreground))" }}>
                  <Icon size={14} style={{ color: on ? GOLD : "currentColor" }} /> {label}
                </button>
              );
            })}
          </div>
          <div className="mt-5">
            {tab === "overview" && <ToolPanel companyId={id} tool="company_overview" cached={analyses.company_overview} refetch={refetch} render={renderOverview} label="Overview" desc="A scannable read of the company from its own deck & website." />}
            {tab === "research" && <ResearchTools companyId={id} analyses={analyses} refetch={refetch} />}
            {tab === "market" && <ToolPanel companyId={id} tool="blue_red_ocean" cached={analyses.blue_red_ocean} refetch={refetch} render={renderOcean} label="Blue / Red Ocean" desc="Industry-concentration on the main offering, with sources." grounded />}
            {tab === "demand" && <ToolPanel companyId={id} tool="demand_landscape" cached={analyses.demand_landscape} refetch={refetch} render={renderDemand} label="Demand Landscape" desc="Where demand concentrates — with the reason for each hotspot." grounded />}
          </div>
        </>
      ) : (
        <div className="mt-6 rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
          Name the company (or auto-fill the deck) to unlock Overview, Research, Market & Demand.
        </div>
      )}
      <FieldStyles />
    </div>
  );
}

/* ─────────────────────── cache-aware tool panel ────────────────────────── */
function ToolPanel({ companyId, tool, cached, refetch, render, label, desc, grounded }: {
  companyId: number; tool: string; cached?: { output: any; updatedAt: string };
  refetch: () => void; render: (o: any) => React.ReactNode; label: string; desc: string; grounded?: boolean;
}) {
  const { toast } = useToast();
  const gen = useMutation({
    mutationFn: async () => {
      const res = await fetch(api(`/pre-sprint/companies/${companyId}/generate`), {
        method: "POST", credentials: "include", headers: { "content-type": "application/json" }, body: JSON.stringify({ tool }),
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
        {grounded && <p className="mt-1 text-xs text-muted-foreground">Uses live web sources — ~10–20s.</p>}
        <button onClick={() => gen.mutate()} disabled={gen.isPending}
          className="mt-4 inline-flex items-center gap-2 rounded-lg px-4 py-2.5 text-sm font-semibold" style={{ background: GOLD, color: "hsl(222 38% 15%)" }}>
          {gen.isPending ? <Loader2 size={15} className="animate-spin" /> : <Sparkles size={15} />} {gen.isPending ? "Generating…" : "Generate"}
        </button>
      </div>
    );
  }
  let body: React.ReactNode;
  try { body = render(cached.output); }
  catch (e: any) {
    body = (
      <div className="rounded-xl border border-border bg-card p-5 text-sm">
        <div className="mb-1 flex items-center gap-1.5 font-medium text-foreground"><AlertTriangle size={14} style={{ color: "hsl(30 60% 45%)" }} /> Couldn’t display this result</div>
        <p className="text-muted-foreground">The saved output had an unexpected shape. Hit Regenerate to rebuild it.</p>
        <pre className="mt-2 max-h-40 overflow-auto rounded bg-muted/40 p-2 text-[11px] text-muted-foreground">{String(e?.message ?? e)}</pre>
      </div>
    );
  }
  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground"><Check size={13} style={{ color: GOLD }} /> Generated {new Date(cached.updatedAt).toLocaleDateString()}</span>
        <button onClick={() => gen.mutate()} disabled={gen.isPending} className="inline-flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 text-xs text-muted-foreground hover:text-foreground">
          {gen.isPending ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />} Regenerate
        </button>
      </div>
      {body}
    </div>
  );
}

/* ─────────────────────── Research Tools (4 cards) ──────────────────────── */
function ResearchTools({ companyId, analyses, refetch }: { companyId: number; analyses: Analyses; refetch: () => void }) {
  const tools = [
    { tool: "icp_mapping", label: "ICP Mapping", icon: Target, render: renderIcp },
    { tool: "tam_sam_som", label: "TAM / SAM / SOM", icon: BarChart3, render: renderTam },
    { tool: "industry_landscape", label: "Industry Landscape", icon: Globe, render: renderGeneric },
    { tool: "business_model_canvas", label: "Business Model Canvas", icon: Layers, render: renderGeneric },
  ] as const;
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm" style={{ background: "hsl(36 65% 96%)", color: "hsl(30 60% 30%)" }}>
        <Wand2 size={15} /> Inputs come from the profile above — no retyping. Each result is saved & shown here.
      </div>
      {tools.map(({ tool, label, icon: Icon, render }) => (
        <div key={tool} className="rounded-xl border border-border bg-card p-5">
          <div className="mb-2 flex items-center gap-2"><Icon size={16} style={{ color: GOLD }} /><span className="font-medium text-foreground">{label}</span></div>
          <ToolPanel companyId={companyId} tool={tool} cached={analyses[tool]} refetch={refetch} render={render} label={label} desc={`Generate ${label} from the profile.`} grounded={tool === "icp_mapping"} />
        </div>
      ))}
    </div>
  );
}

/* ─────────────────────── shared bits ───────────────────────────────────── */
function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return <div className="mb-3"><div className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{title}</div>{children}</div>;
}
function Chips({ items }: { items?: string[] }) {
  return <div className="flex flex-wrap gap-1.5">{(items ?? []).map((x, i) => <span key={i} className="rounded-full border border-border bg-card px-2.5 py-1 text-[11px] text-foreground">{x}</span>)}</div>;
}
function Sources({ sources }: { sources?: { id: number; title: string; url: string }[] }) {
  if (!sources?.length) return <p className="mt-3 flex items-center gap-1.5 text-xs text-muted-foreground"><AlertTriangle size={12} /> No live sources returned — verify independently.</p>;
  return (
    <div className="mt-4 rounded-lg border border-border p-3">
      <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Sources</div>
      <ol className="space-y-1 text-xs">
        {sources.map((s) => <li key={s.id} className="flex gap-1.5"><span className="text-muted-foreground">[{s.id}]</span>
          <a href={s.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-foreground underline decoration-dotted">{s.title} <ExternalLink size={11} /></a></li>)}
      </ol>
    </div>
  );
}

/* ─────────────────────── Overview: funnel + traction ───────────────────── */
function renderOverview(o: any) {
  const funnel: any[] = o.audienceFunnel ?? [];
  const n = Math.max(funnel.length, 1);
  const tr = o.traction ?? {};
  const has = (v: any) => v && v !== "Not stated";
  return (
    <div className="space-y-4">
      {o.snapshot && <div className="rounded-xl border border-border bg-card p-5"><p className="text-[15px] leading-relaxed text-foreground">{o.snapshot}</p></div>}

      {/* audience funnel — top-down */}
      {funnel.length > 0 && (
        <div className="rounded-xl border border-border bg-card p-5">
          <Section title="Target audience — top-down"><div /></Section>
          <div className="space-y-1.5">
            {funnel.map((lvl, i) => {
              const w = 100 - (i * (58 / Math.max(n - 1, 1)));
              const light = 22 + (i * (40 / Math.max(n - 1, 1)));
              return (
                <div key={i} className="mx-auto flex flex-col items-center justify-center rounded-md px-4 py-2 text-center"
                  style={{ width: `${w}%`, minWidth: 180, background: `hsl(221 39% ${light}%)`, color: "white" }}>
                  <div className="text-[10px] uppercase tracking-wider" style={{ color: "rgba(255,255,255,.65)" }}>{lvl.level}{lvl.size ? ` · ${lvl.size}` : ""}</div>
                  <div className="text-sm font-semibold">{lvl.who}</div>
                  {lvl.detail && <div className="text-[11px]" style={{ color: "rgba(255,255,255,.8)" }}>{lvl.detail}</div>}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* traction buckets */}
      <div className="rounded-xl border border-border bg-card p-5">
        <Section title="Traction"><div /></Section>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat icon={Users} label="Customers" value={has(tr.customers) ? tr.customers : "—"} />
          <Stat icon={TrendingUp} label="Growth" value={has(tr.growth) ? tr.growth : "—"} />
          <Stat icon={Share2} label="Social" value={(tr.social ?? []).length ? tr.social.map((s: any) => `${s.platform}: ${s.metric}`).join(" · ") : "—"} />
          <Stat icon={Handshake} label="Partnerships" value={(tr.partnerships ?? []).length ? tr.partnerships.join(", ") : "—"} />
        </div>
        {(tr.highlights ?? []).length > 0 && <div className="mt-3"><Chips items={tr.highlights} /></div>}
      </div>

      {/* quick facts grid */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="rounded-xl border border-border bg-card p-5">
          {o.offerings && <Section title="Offerings"><Chips items={o.offerings} /></Section>}
          {o.customerSegments && <Section title="Segments"><Chips items={o.customerSegments} /></Section>}
          {o.geography && <Section title="Geography"><Chips items={o.geography} /></Section>}
        </div>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="rounded-xl border border-border bg-card p-4"><Section title="Pricing"><p className="text-sm text-foreground">{o.pricing || "—"}</p></Section></div>
            <div className="rounded-xl border border-border bg-card p-4"><Section title="Revenue"><p className="text-sm text-foreground">{o.revenue || "—"}</p></Section></div>
          </div>
          {o.edge && <div className="rounded-xl p-4" style={{ background: NAVY }}>
            <div className="mb-1 text-[10px] font-semibold uppercase tracking-[0.18em]" style={{ color: "rgba(255,255,255,.6)" }}>Edge</div>
            <p className="text-sm text-white">{o.edge}</p></div>}
        </div>
      </div>

      {o.gaps?.length > 0 && (
        <div className="rounded-xl border border-border bg-card p-5">
          <Section title="Confirm with the founder"><Chips items={o.gaps} /></Section>
        </div>
      )}
    </div>
  );
}
function Stat({ icon: Icon, label, value }: { icon: any; label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border p-3">
      <div className="mb-1 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground"><Icon size={12} style={{ color: GOLD }} /> {label}</div>
      <div className="text-sm text-foreground">{value}</div>
    </div>
  );
}

/* ─────────────────────── ICP: personas + real accounts ─────────────────── */
function renderIcp(o: any) {
  const personas = o.personas ?? [];
  const accounts = o.targetAccounts ?? [];
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
        {personas.map((p: any, i: number) => (
          <div key={i} className="rounded-xl border border-border bg-card p-4">
            <div className="flex h-9 w-9 items-center justify-center rounded-full text-sm font-semibold" style={{ background: "hsl(36 65% 94%)", color: "hsl(30 55% 38%)" }}><Users size={16} /></div>
            <div className="mt-2 font-medium text-foreground">{p.title}</div>
            <div className="text-[11px] text-muted-foreground">{[p.seniority, p.segment].filter(Boolean).join(" · ")}</div>
            {p.painPoints?.length > 0 && <div className="mt-2"><div className="text-[10px] uppercase tracking-wider text-muted-foreground">Pains</div><Chips items={p.painPoints} /></div>}
            {p.goals?.length > 0 && <div className="mt-2"><div className="text-[10px] uppercase tracking-wider text-muted-foreground">Goals</div><Chips items={p.goals} /></div>}
            {p.channels?.length > 0 && <div className="mt-2"><div className="text-[10px] uppercase tracking-wider text-muted-foreground">Reach via</div><Chips items={p.channels} /></div>}
          </div>
        ))}
      </div>

      {accounts.length > 0 && (
        <div className="rounded-xl border border-border bg-card p-5">
          <Section title="Example target accounts (public info)"><div /></Section>
          <div className="space-y-2">
            {accounts.map((a: any, i: number) => (
              <div key={i} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border p-3">
                <div className="min-w-0">
                  <div className="font-medium text-foreground">{a.company}</div>
                  {a.whyFit && <div className="text-xs text-muted-foreground">{a.whyFit}</div>}
                </div>
                <div className="flex items-center gap-2">
                  {a.website && <a href={a.website.startsWith("http") ? a.website : `https://${a.website}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs text-foreground"><Globe size={12} /> Site</a>}
                  {a.linkedinUrl && <a href={a.linkedinUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs text-foreground"><Link2 size={12} /> LinkedIn</a>}
                </div>
              </div>
            ))}
          </div>
          <p className="mt-2 flex items-center gap-1.5 text-[11px] text-muted-foreground"><AlertTriangle size={11} /> Public info from web sources — confirm before outreach.</p>
        </div>
      )}
      <Sources sources={o.sources} />
    </div>
  );
}

/* ─────────────────────── TAM / SAM / SOM ───────────────────────────────── */
function renderTam(o: any) {
  const get = (k: string) => o?.[k] ?? o?.[k.toUpperCase()] ?? o?.[k.toLowerCase()];
  const rows = [["TAM", get("tam")], ["SAM", get("sam")], ["SOM", get("som")]].filter((r) => r[1]);
  return (
    <div className="rounded-xl border border-border bg-card p-5">
      {rows.length > 0 ? (
        <div className="space-y-3">
          {rows.map(([l, v]: any, i) => (
            <div key={l}>
              <div className="mb-1 flex justify-between text-xs"><span className="text-muted-foreground">{l}</span><span className="text-foreground">{typeof v === "string" ? v : v?.value ?? JSON.stringify(v)}</span></div>
              <div className="h-2 rounded-full" style={{ background: "hsl(220 18% 94%)" }}><div className="h-2 rounded-full" style={{ width: `${100 - i * 40}%`, background: `linear-gradient(90deg, ${NAVY}, ${GOLD})` }} /></div>
            </div>
          ))}
        </div>
      ) : renderGeneric(o)}
      {(o.assumptions || o.method) && <p className="mt-3 text-xs text-muted-foreground">{o.assumptions ?? o.method}</p>}
      <p className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground"><AlertTriangle size={12} /> Estimates — verify against primary sources.</p>
    </div>
  );
}

/* ─────────────────────── Blue / Red Ocean (de-cluttered) ───────────────── */
function renderOcean(o: any) {
  const segs: any[] = o.segments ?? [];
  const W = 520, H = 320, P = 40;
  const X = (v: number) => P + (v / 100) * (W - P * 2);
  const Y = (v: number) => H - P - (v / 100) * (H - P * 2);
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-5">
      <div className="rounded-xl border border-border bg-card p-4 lg:col-span-3">
        <svg viewBox={`0 0 ${W} ${H}`} className="w-full">
          <rect x={P} y={P} width={(W - P * 2) / 2} height={(H - P * 2) / 2} fill="hsl(205 65% 96%)" />
          <rect x={W / 2} y={H / 2} width={(W - P * 2) / 2} height={(H - P * 2) / 2} fill="hsl(8 65% 97%)" />
          <line x1={P} y1={H - P} x2={W - P} y2={H - P} stroke="hsl(var(--border))" />
          <line x1={P} y1={P} x2={P} y2={H - P} stroke="hsl(var(--border))" />
          <text x={W / 2} y={H - 12} textAnchor="middle" fontSize="10" fill="hsl(var(--muted-foreground))">Market saturation →</text>
          <text x={-H / 2} y={14} transform="rotate(-90)" textAnchor="middle" fontSize="10" fill="hsl(var(--muted-foreground))">Growth potential →</text>
          <text x={P + 6} y={P + 15} fontSize="10" fontWeight="700" fill="hsl(205 55% 42%)">BLUE OCEAN</text>
          <text x={W - P - 6} y={H - P - 8} textAnchor="end" fontSize="10" fontWeight="700" fill="hsl(8 55% 50%)">RED OCEAN</text>
          {segs.map((s, i) => {
            const blue = s.ocean === "blue";
            return (
              <g key={i}>
                <circle cx={X(s.saturation ?? 50)} cy={Y(s.growthPotential ?? 50)} r={13}
                  fill={blue ? "hsl(205 78% 48%)" : "hsl(8 68% 55%)"} stroke="white" strokeWidth="2" />
                <text x={X(s.saturation ?? 50)} y={Y(s.growthPotential ?? 50) + 4} textAnchor="middle" fontSize="11" fontWeight="700" fill="white">{i + 1}</text>
              </g>
            );
          })}
        </svg>
      </div>
      <div className="lg:col-span-2">
        <ol className="space-y-1.5">
          {segs.map((s, i) => {
            const blue = s.ocean === "blue";
            return (
              <li key={i} className="flex items-start gap-2 rounded-lg border border-border p-2">
                <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-bold text-white" style={{ background: blue ? "hsl(205 78% 48%)" : "hsl(8 68% 55%)" }}>{i + 1}</span>
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5 text-sm font-medium text-foreground">{s.name}
                    <span className="rounded px-1.5 py-0.5 text-[9px] font-semibold uppercase" style={{ background: blue ? "hsl(205 65% 92%)" : "hsl(8 65% 94%)", color: blue ? "hsl(205 55% 35%)" : "hsl(8 55% 42%)" }}>{blue ? "blue" : "red"}</span>
                  </div>
                  {s.rationale && <div className="text-[11px] text-muted-foreground">{s.rationale}</div>}
                </div>
              </li>
            );
          })}
        </ol>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:col-span-5">
        <div className="rounded-lg border border-border bg-card p-4" style={{ borderLeft: "3px solid hsl(205 78% 48%)" }}>
          <div className="mb-1 flex items-center gap-1.5 text-sm font-medium text-foreground"><Waves size={15} style={{ color: "hsl(205 70% 45%)" }} /> Go here</div>
          <ul className="space-y-1 text-sm text-muted-foreground">{(o.blueOcean ?? []).map((t: string, i: number) => <li key={i}>• {t}</li>)}</ul>
        </div>
        <div className="rounded-lg border border-border bg-card p-4" style={{ borderLeft: "3px solid hsl(8 68% 55%)" }}>
          <div className="mb-1 flex items-center gap-1.5 text-sm font-medium text-foreground"><Flame size={15} style={{ color: "hsl(8 65% 50%)" }} /> Avoid / differentiate</div>
          <ul className="space-y-1 text-sm text-muted-foreground">{(o.redOcean ?? []).map((t: string, i: number) => <li key={i}>• {t}</li>)}</ul>
        </div>
      </div>
      <div className="lg:col-span-5"><Sources sources={o.sources} /></div>
    </div>
  );
}

/* ─────────────────────── Demand Landscape (with reasoning) ──────────────── */
function renderDemand(o: any) {
  const india = (o.india ?? []).slice().sort((a: any, b: any) => (b.demand ?? 0) - (a.demand ?? 0));
  const top = india.slice(0, 8);
  return (
    <div className="rounded-xl border border-border bg-card p-5">
      {o.summary && <p className="mb-4 text-sm leading-relaxed text-foreground">{o.summary}</p>}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div>
          <div className="mb-2 flex items-center gap-2 text-sm font-medium text-foreground"><Map size={14} style={{ color: GOLD }} /> India</div>
          <IndiaChoropleth india={o.india ?? []} />
        </div>
        <div>
          <div className="mb-2 flex items-center gap-2 text-sm font-medium text-foreground"><Target size={14} style={{ color: GOLD }} /> Why these states</div>
          <div className="space-y-1.5">
            {top.map((s: any, i: number) => (
              <div key={i} className="flex items-start gap-2 rounded-lg border border-border p-2">
                <span className="mt-0.5 inline-flex h-6 min-w-[2.2rem] items-center justify-center rounded px-1 text-[11px] font-bold text-white" style={{ background: `hsl(36 72% ${72 - (s.demand / 100) * 34}%)` }}>{s.demand}</span>
                <div className="min-w-0"><div className="text-sm font-medium text-foreground">{s.state}</div>{s.note && <div className="text-[11px] text-muted-foreground">{s.note}</div>}</div>
              </div>
            ))}
          </div>
          {(o.global ?? []).length > 0 && (
            <div className="mt-4">
              <div className="mb-2 flex items-center gap-2 text-sm font-medium text-foreground"><Globe size={14} style={{ color: GOLD }} /> Global</div>
              <div className="space-y-1.5">
                {(o.global ?? []).map((g: any, i: number) => (
                  <div key={i} className="flex items-start gap-2 rounded-lg border border-border p-2">
                    <span className="mt-0.5 inline-flex h-6 min-w-[2.2rem] items-center justify-center rounded px-1 text-[11px] font-bold text-white" style={{ background: `hsl(36 72% ${72 - (g.demand / 100) * 34}%)` }}>{g.demand}</span>
                    <div className="min-w-0"><div className="text-sm font-medium text-foreground">{g.region}</div>{g.note && <div className="text-[11px] text-muted-foreground">{g.note}</div>}</div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
      <Sources sources={o.sources} />
    </div>
  );
}

function IndiaChoropleth({ india }: { india: { state: string; demand: number; note?: string }[] }) {
  const [geo, setGeo] = useState<any>(null);
  const [hover, setHover] = useState<string | null>(null);
  useEffect(() => { let alive = true; fetch(`${BASE}/india-states.geojson`).then((r) => r.json()).then((g) => { if (alive) setGeo(g); }).catch(() => {}); return () => { alive = false; }; }, []);
  const demandBy = useMemo(() => { const m: Record<string, number> = {}; for (const d of india) m[d.state] = d.demand; return m; }, [india]);
  const W = 420, H = 480, PAD = 10;
  const { paths, ok } = useMemo(() => {
    if (!geo) return { paths: [] as any[], ok: false };
    let minLon = 180, maxLon = -180, minLat = 90, maxLat = -90;
    const rings: { name: string; polys: number[][][] }[] = [];
    for (const f of geo.features) {
      const name = f.properties?.NAME_1 ?? f.properties?.name ?? "";
      const geom = f.geometry; if (!geom) continue;
      const polys = geom.type === "Polygon" ? geom.coordinates : geom.type === "MultiPolygon" ? geom.coordinates.flat() : [];
      for (const ring of polys) for (const pt of ring) { const lon = pt[0], lat = pt[1]; if (lon < minLon) minLon = lon; if (lon > maxLon) maxLon = lon; if (lat < minLat) minLat = lat; if (lat > maxLat) maxLat = lat; }
      rings.push({ name, polys });
    }
    const s = Math.min((W - PAD * 2) / (maxLon - minLon), (H - PAD * 2) / (maxLat - minLat));
    const ox = PAD + ((W - PAD * 2) - s * (maxLon - minLon)) / 2;
    const oy = PAD + ((H - PAD * 2) - s * (maxLat - minLat)) / 2;
    const px = (lon: number) => ox + (lon - minLon) * s;
    const py = (lat: number) => oy + (maxLat - lat) * s;
    const paths = rings.map((r) => ({ name: r.name, d: r.polys.map((ring) => "M" + ring.map((pt) => `${px(pt[0]).toFixed(1)},${py(pt[1]).toFixed(1)}`).join("L") + "Z").join(" ") }));
    return { paths, ok: true };
  }, [geo]);
  const color = (v: number) => v ? `hsl(36 72% ${78 - (Math.min(v, 100) / 100) * 40}%)` : "hsl(220 18% 92%)";
  if (!ok) return <div className="flex h-64 items-center justify-center rounded-lg border border-border text-sm text-muted-foreground"><Loader2 size={16} className="mr-2 animate-spin" /> Loading map…</div>;
  return (
    <div className="relative">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full">
        {paths.map((p) => { const v = demandBy[p.name] ?? 0; const on = hover === p.name;
          return <path key={p.name} d={p.d} fill={color(v)} stroke={on ? NAVY : "white"} strokeWidth={on ? 1.4 : 0.5} onMouseEnter={() => setHover(p.name)} onMouseLeave={() => setHover(null)} style={{ cursor: "pointer" }} />; })}
      </svg>
      {hover && <div className="pointer-events-none absolute right-2 top-2 rounded-lg px-3 py-2 text-white" style={{ background: NAVY }}>
        <div className="text-sm font-medium">{hover}</div><div className="text-[11px]" style={{ color: "rgba(255,255,255,.7)" }}>Demand {demandBy[hover] ?? 0}</div></div>}
      <div className="mt-2 flex items-center gap-2 text-[10px] text-muted-foreground"><span>Low</span>
        <div className="h-2 flex-1 rounded-full" style={{ background: `linear-gradient(90deg, ${color(8)}, ${color(50)}, ${color(100)})` }} /><span>High</span></div>
    </div>
  );
}

/* ─────────────────────── generic fallback renderer ─────────────────────── */
function renderGeneric(o: any): React.ReactNode {
  if (o == null) return null;
  if (typeof o === "string" || typeof o === "number") return <p className="text-sm text-foreground">{String(o)}</p>;
  if (Array.isArray(o)) {
    if (o.every((x) => typeof x === "string" || typeof x === "number")) return <ul className="list-disc space-y-1 pl-5 text-sm text-foreground">{o.map((x, i) => <li key={i}>{String(x)}</li>)}</ul>;
    return <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">{o.map((x, i) => <div key={i} className="rounded-lg border border-border p-3">{renderGeneric(x)}</div>)}</div>;
  }
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      {Object.entries(o).map(([k, v]) => (
        <div key={k} className="rounded-lg border border-border p-3">
          <div className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{k.replace(/([A-Z])/g, " $1").replace(/_/g, " ")}</div>
          {renderGeneric(v)}
        </div>
      ))}
    </div>
  );
}

/* ─────────────────────── small helpers ─────────────────────────────────── */
function FieldLabel({ children }: { children: React.ReactNode }) { return <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{children}</label>; }
function F({ label, children, full }: { label: string; children: React.ReactNode; full?: boolean }) { return <div className={full ? "sm:col-span-2" : ""}><FieldLabel>{label}</FieldLabel>{children}</div>; }
function FieldStyles() {
  return <style>{`.ts-input{width:100%;border:1px solid hsl(var(--border));border-radius:.5rem;padding:.5rem .625rem;font-size:.875rem;background:hsl(var(--card));color:hsl(var(--foreground));outline:none}.ts-input:focus{border-color:var(--gold)}`}</style>;
}
