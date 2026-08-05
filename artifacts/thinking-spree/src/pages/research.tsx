import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react";
import { Layout } from "@/components/Layout";
import { SavedRunsDrawer } from "@/components/SavedRunsDrawer";
import { useToast } from "@/hooks/use-toast";
import {
  Sparkles, Users, Target, BarChart3, Globe, Layers,
  Loader2, Lightbulb, Wrench,
} from "lucide-react";
import InspirationTab from "./InspirationTab";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

// ───────────────── Tool registry ─────────────────────────────────────────
type ToolKey =
  | "customer_segmentation" | "icp_mapping" | "tam_sam_som"
  | "industry_landscape" | "business_model_canvas";

type ToolDef = {
  key: ToolKey;
  label: string;
  description: string;
  Icon: React.ElementType;
  accent: string;          // tailwind classes for icon bg
  inputs: { name: string; label: string; type: "text" | "textarea"; required: boolean; placeholder?: string }[];
};

const TOOLS: ToolDef[] = [
  {
    key: "customer_segmentation",
    label: "Customer Segmentation",
    description: "3-5 distinct customer segments with demographics, pain points, and willingness to pay.",
    Icon: Users,
    accent: "bg-emerald-50 text-emerald-700",
    inputs: [
      { name: "companyName", label: "Company Name", type: "text", required: true, placeholder: "e.g. Gofitzen" },
      { name: "industry", label: "Industry", type: "text", required: true, placeholder: "e.g. wellness-tech" },
      { name: "productDescription", label: "Product Description", type: "textarea", required: true, placeholder: "What does the product do?" },
      { name: "geography", label: "Geography", type: "text", required: false, placeholder: "Default: India" },
    ],
  },
  {
    key: "icp_mapping",
    label: "ICP Mapping",
    description: "Ideal Customer Profile + secondary ICPs with buying triggers and prospecting channels.",
    Icon: Target,
    accent: "bg-violet-50 text-violet-700",
    inputs: [
      { name: "companyName", label: "Company Name", type: "text", required: true },
      { name: "productDescription", label: "Product Description", type: "textarea", required: true },
      { name: "currentCustomers", label: "Current Customers (if any)", type: "textarea", required: false, placeholder: "Describe who's buying today" },
    ],
  },
  {
    key: "tam_sam_som",
    label: "TAM / SAM / SOM",
    description: "Market size estimates with reasoning and assumptions called out.",
    Icon: BarChart3,
    accent: "bg-indigo-50 text-indigo-700",
    inputs: [
      { name: "companyName", label: "Company Name", type: "text", required: true },
      { name: "productDescription", label: "Product Description", type: "textarea", required: true },
      { name: "geography", label: "Geography", type: "text", required: true, placeholder: "e.g. India, Tier-1 cities" },
      { name: "pricingNotes", label: "Pricing Notes", type: "textarea", required: false, placeholder: "Pricing model + ARPU if known" },
    ],
  },
  {
    key: "industry_landscape",
    label: "Industry Landscape",
    description: "Market size, growth, key players, trends, challenges, regulatory context.",
    Icon: Globe,
    accent: "bg-rose-50 text-rose-700",
    inputs: [
      { name: "industry", label: "Industry", type: "text", required: true, placeholder: "e.g. D2C wellness in India" },
      { name: "geography", label: "Geography", type: "text", required: false, placeholder: "Default: India" },
    ],
  },
  {
    key: "business_model_canvas",
    label: "Business Model Canvas",
    description: "All 9 BMC blocks filled — customer segments, value props, channels, revenue streams, etc.",
    Icon: Layers,
    accent: "bg-amber-50 text-amber-700",
    inputs: [
      { name: "companyName", label: "Company Name", type: "text", required: true },
      { name: "productDescription", label: "Product Description", type: "textarea", required: true },
      { name: "currentRevenueModel", label: "Current Revenue Model", type: "text", required: false, placeholder: "e.g. Subscription, ad-supported" },
    ],
  },
];

// ───────────────── Output renderers ──────────────────────────────────────
/**
 * Each tool's output JSON has a different shape. We render a different
 * layout per tool but they all share a "card with sections" container.
 */
function renderOutput(tool: ToolKey, output: any): React.ReactNode {
  if (!output) return null;
  switch (tool) {
    case "customer_segmentation":
      return <CustomerSegmentationView data={output} />;
    case "icp_mapping":
      return <IcpMappingView data={output} />;
    case "tam_sam_som":
      return <TamSamSomView data={output} />;
    case "industry_landscape":
      return <IndustryLandscapeView data={output} />;
    case "business_model_canvas":
      return <BusinessModelCanvasView data={output} />;
  }
}

function FieldLabel({ children }: { children: React.ReactNode }) {
  return <h4 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{children}</h4>;
}

function CustomerSegmentationView({ data }: { data: any }) {
  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4">
        <FieldLabel>Primary Segment</FieldLabel>
        <p className="mt-1 font-serif text-lg text-foreground">{data.primarySegment}</p>
        <p className="mt-1 text-sm text-muted-foreground">{data.rationale}</p>
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        {(data.segments ?? []).map((s: any, i: number) => (
          <div key={i} className="rounded-lg border border-border bg-card p-4">
            <h3 className="font-serif text-lg text-foreground">{s.name}</h3>
            <p className="mt-1 text-xs text-muted-foreground">{s.demographics}</p>
            <p className="mt-2 text-sm">{s.psychographics}</p>
            {s.painPoints?.length > 0 && (
              <ul className="mt-3 list-disc pl-5 text-sm text-foreground space-y-0.5">
                {s.painPoints.map((p: string, j: number) => <li key={j}>{p}</li>)}
              </ul>
            )}
            <div className="mt-3 flex flex-wrap gap-3 text-xs">
              <span><strong>Pays:</strong> {s.willingnessToPay}</span>
              <span><strong>Size:</strong> {s.sizeEstimate}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function IcpMappingView({ data }: { data: any }) {
  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-violet-200 bg-violet-50 p-5">
        <FieldLabel>Ideal Customer</FieldLabel>
        <p className="mt-1 font-serif text-lg text-foreground">{data.ideal?.companyType}</p>
        <p className="mt-1 text-sm"><strong>Persona:</strong> {data.ideal?.persona}</p>
        <div className="mt-3 grid grid-cols-1 md:grid-cols-3 gap-3 text-sm">
          <div><FieldLabel>Buying Triggers</FieldLabel>
            <ul className="mt-1 list-disc pl-5 space-y-0.5">{(data.ideal?.triggers ?? []).map((t: string, i: number) => <li key={i}>{t}</li>)}</ul></div>
          <div><FieldLabel>Red Flags</FieldLabel>
            <ul className="mt-1 list-disc pl-5 space-y-0.5">{(data.ideal?.redFlags ?? []).map((t: string, i: number) => <li key={i}>{t}</li>)}</ul></div>
          <div><FieldLabel>Channels</FieldLabel>
            <ul className="mt-1 list-disc pl-5 space-y-0.5">{(data.ideal?.channels ?? []).map((t: string, i: number) => <li key={i}>{t}</li>)}</ul></div>
        </div>
      </div>
      {(data.secondary ?? []).length > 0 && (
        <div>
          <FieldLabel>Secondary ICPs</FieldLabel>
          <div className="mt-2 grid grid-cols-1 md:grid-cols-2 gap-3">
            {data.secondary.map((s: any, i: number) => (
              <div key={i} className="rounded-lg border border-border bg-card p-4">
                <p className="font-medium">{s.companyType}</p>
                <p className="mt-1 text-sm text-muted-foreground">{s.rationale}</p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function TamSamSomView({ data }: { data: any }) {
  const tiers = [
    { key: "tam", label: "TAM", color: "border-indigo-200 bg-indigo-50" },
    { key: "sam", label: "SAM", color: "border-violet-200 bg-violet-50" },
    { key: "som", label: "SOM", color: "border-emerald-200 bg-emerald-50" },
  ];
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        {tiers.map(t => (
          <div key={t.key} className={`rounded-lg border p-5 ${t.color}`}>
            <FieldLabel>{t.label}</FieldLabel>
            <p className="mt-1 font-serif text-2xl text-foreground tabular-nums">{data[t.key]?.value ?? "—"}</p>
            <p className="mt-2 text-xs text-muted-foreground leading-relaxed">{data[t.key]?.reasoning}</p>
          </div>
        ))}
      </div>
      {(data.assumptions ?? []).length > 0 && (
        <div className="rounded-lg border border-border bg-card p-4">
          <FieldLabel>Assumptions</FieldLabel>
          <ul className="mt-2 list-disc pl-5 text-sm space-y-1">
            {data.assumptions.map((a: string, i: number) => <li key={i}>{a}</li>)}
          </ul>
        </div>
      )}
      {(data.sources ?? []).length > 0 && (
        <div className="rounded-lg border border-border bg-card p-4">
          <FieldLabel>Sources / References</FieldLabel>
          <ul className="mt-2 list-disc pl-5 text-sm space-y-1 text-muted-foreground">
            {data.sources.map((s: string, i: number) => <li key={i}>{s}</li>)}
          </ul>
        </div>
      )}
    </div>
  );
}

function IndustryLandscapeView({ data }: { data: any }) {
  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-rose-200 bg-rose-50 p-5">
        <FieldLabel>Overview</FieldLabel>
        <p className="mt-1 text-sm leading-relaxed">{data.overview}</p>
        <div className="mt-3 grid grid-cols-2 gap-4 text-xs">
          <div><strong>Market size:</strong> {data.marketSize}</div>
          <div><strong>Growth:</strong> {data.growthRate}</div>
        </div>
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <div className="rounded-lg border border-border bg-card p-4">
          <FieldLabel>Key Players</FieldLabel>
          <ul className="mt-2 space-y-2">
            {(data.keyPlayers ?? []).map((p: any, i: number) => (
              <li key={i} className="text-sm"><strong>{p.name}</strong> — <span className="text-muted-foreground">{p.positioning}</span></li>
            ))}
          </ul>
        </div>
        <div className="space-y-3">
          <div className="rounded-lg border border-border bg-card p-4">
            <FieldLabel>Trends</FieldLabel>
            <ul className="mt-2 list-disc pl-5 text-sm space-y-1">{(data.trends ?? []).map((t: string, i: number) => <li key={i}>{t}</li>)}</ul>
          </div>
          <div className="rounded-lg border border-border bg-card p-4">
            <FieldLabel>Opportunities</FieldLabel>
            <ul className="mt-2 list-disc pl-5 text-sm space-y-1">{(data.opportunities ?? []).map((t: string, i: number) => <li key={i}>{t}</li>)}</ul>
          </div>
        </div>
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <div className="rounded-lg border border-border bg-card p-4">
          <FieldLabel>Challenges</FieldLabel>
          <ul className="mt-2 list-disc pl-5 text-sm space-y-1">{(data.challenges ?? []).map((t: string, i: number) => <li key={i}>{t}</li>)}</ul>
        </div>
        <div className="rounded-lg border border-border bg-card p-4">
          <FieldLabel>Regulatory</FieldLabel>
          <p className="mt-2 text-sm">{data.regulatory}</p>
        </div>
      </div>
    </div>
  );
}

function BusinessModelCanvasView({ data }: { data: any }) {
  // BMC is rendered as a 3x3 grid mirroring the Strategyzer layout.
  const blocks: { key: keyof typeof data; label: string; span?: string }[] = [
    { key: "keyPartners",          label: "Key Partners" },
    { key: "keyActivities",        label: "Key Activities" },
    { key: "valuePropositions",    label: "Value Propositions" },
    { key: "customerRelationships",label: "Customer Relationships" },
    { key: "customerSegments",     label: "Customer Segments" },
    { key: "keyResources",         label: "Key Resources" },
    { key: "channels",             label: "Channels" },
    { key: "costStructure",        label: "Cost Structure", span: "md:col-span-2" },
    { key: "revenueStreams",       label: "Revenue Streams", span: "md:col-span-3" },
  ];
  return (
    <div className="grid grid-cols-1 md:grid-cols-5 gap-3">
      {blocks.map(b => (
        <div key={b.key as string} className={`rounded-lg border border-border bg-card p-4 ${b.span ?? ""}`}>
          <FieldLabel>{b.label}</FieldLabel>
          <ul className="mt-2 list-disc pl-5 text-sm space-y-0.5">
            {(data[b.key] ?? []).map((s: string, i: number) => <li key={i}>{s}</li>)}
          </ul>
        </div>
      ))}
    </div>
  );
}

// ───────────────── Main page ─────────────────────────────────────────────
export default function ResearchPage() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [section, setSection] = useState<"inspiration" | "tools">("inspiration");
  const [activeTool, setActiveTool] = useState<ToolKey>("customer_segmentation");
  const [title, setTitle] = useState("");
  const [inputs, setInputs] = useState<Record<string, string>>({});
  const [viewing, setViewing] = useState<any | null>(null);

  const tool = TOOLS.find(t => t.key === activeTool)!;

  const { data: listData, isLoading } = useQuery<{ outputs: any[] }>({
    queryKey: ["/api/research/outputs", activeTool],
    queryFn: () => customFetch(`${BASE}/api/research/outputs?tool=${activeTool}`, { credentials: "include" }),
    staleTime: 10_000,
  });

  const generateMutation = useMutation({
    mutationFn: async () => {
      // Validate required inputs client-side.
      for (const i of tool.inputs) {
        if (i.required && !(inputs[i.name] ?? "").trim()) {
          throw new Error(`${i.label} is required`);
        }
      }
      const res = await fetch(`${BASE}/api/research/generate`, {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tool: activeTool, title: title.trim() || `${tool.label} - ${new Date().toISOString().slice(0,10)}`, inputs }),
      });
      if (!res.ok) {
        const e = await res.json().catch(() => ({}));
        throw new Error(e?.error || `Generation failed (${res.status})`);
      }
      return (await res.json()).output;
    },
    onSuccess: (saved) => {
      toast({ title: "Generated", description: `"${saved.title}" saved to library.` });
      qc.invalidateQueries({ queryKey: ["/api/research/outputs", activeTool] });
      setViewing(saved);
    },
    onError: (err: any) => toast({ title: "Generation failed", description: err.message, variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      const res = await fetch(`${BASE}/api/research/outputs/${id}`, { method: "DELETE", credentials: "include" });
      if (!res.ok) throw new Error("Delete failed");
    },
    onSuccess: () => {
      toast({ title: "Deleted" });
      qc.invalidateQueries({ queryKey: ["/api/research/outputs", activeTool] });
      setViewing(null);
    },
  });

  return (
    <Layout>
      <main className="flex-1 space-y-6 px-6 py-8 lg:px-10 max-w-[1400px] mx-auto">
        <section>
          <div className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Workspace</div>
          <h1 className="mt-2 font-serif text-4xl text-foreground">Research</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Deep, web-grounded research for consultants — start from the Inspiration engine to find a
            client's closest real-world playbook, or use the structured AI tools for segmentation,
            sizing, and positioning. Outputs are saved to the library.
          </p>
        </section>

        {/* Section switch: Inspiration vs Research tools */}
        <div className="inline-flex rounded-lg border border-border bg-card p-1">
          {([
            { id: "inspiration", label: "Inspiration", Icon: Lightbulb },
            { id: "tools", label: "Research tools", Icon: Wrench },
          ] as const).map(s => (
            <button
              key={s.id}
              onClick={() => setSection(s.id)}
              className={
                "inline-flex items-center gap-2 rounded-md px-4 py-1.5 text-sm font-medium transition-colors " +
                (section === s.id ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground")
              }
            >
              <s.Icon className="h-3.5 w-3.5" />
              {s.label}
            </button>
          ))}
        </div>

        {section === "inspiration" && <InspirationTab />}

        {section === "tools" && (
        <>
        {/* Tool tabs + the shared, subtle "saved outputs" drawer on the right —
            the same history surface every workspace tab uses. */}
        <div className="flex items-end justify-between gap-3 border-b border-border">
          <div className="flex items-center gap-1 overflow-x-auto">
            {TOOLS.map(t => (
              <button
                key={t.key}
                onClick={() => { setActiveTool(t.key); setInputs({}); setTitle(""); setViewing(null); }}
                className={
                  "flex items-center gap-2 px-4 py-2 text-sm font-medium transition-colors border-b-2 -mb-px whitespace-nowrap " +
                  (activeTool === t.key
                    ? "border-primary text-foreground"
                    : "border-transparent text-muted-foreground hover:text-foreground")
                }
              >
                <t.Icon className="h-3.5 w-3.5" />
                {t.label}
              </button>
            ))}
          </div>
          <div className="shrink-0 pb-1.5">
            <SavedRunsDrawer
              triggerLabel="Saved outputs"
              title={`Saved · ${tool.label}`}
              searchable
              loading={isLoading}
              emptyText={`No saved ${tool.label.toLowerCase()} outputs yet — generate one on the left.`}
              items={(listData?.outputs ?? []).map((o) => ({
                id: o.id,
                title: o.title,
                meta: new Date(o.createdAt).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }),
                active: viewing?.id === o.id,
              }))}
              onOpen={(id) => {
                const o = (listData?.outputs ?? []).find((x) => x.id === Number(id));
                if (o) setViewing(o);
              }}
              onDelete={(id) => deleteMutation.mutate(Number(id))}
            />
          </div>
        </div>

        {/* Generator */}
        <div className="max-w-2xl">
          <section className="rounded-xl border border-border bg-card p-5">
            <div className="flex items-center gap-2.5">
              <div className={`rounded-md p-2 ${tool.accent}`}>
                <tool.Icon className="h-4 w-4" />
              </div>
              <div>
                <h2 className="font-serif text-xl text-foreground">{tool.label}</h2>
              </div>
            </div>
            <p className="mt-2 text-xs text-muted-foreground">{tool.description}</p>

            <div className="mt-4 space-y-3">
              <div>
                <label className="mb-1 block text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                  Title (for the library)
                </label>
                <input
                  type="text"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder={`${tool.label} - ${new Date().toISOString().slice(0,10)}`}
                  className="w-full px-3 py-2 bg-background border border-input rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-ring/20 focus:border-ring"
                />
              </div>
              {tool.inputs.map(field => (
                <div key={field.name}>
                  <label className="mb-1 block text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                    {field.label}{field.required && <span className="text-destructive ml-0.5">*</span>}
                  </label>
                  {field.type === "textarea" ? (
                    <textarea
                      value={inputs[field.name] ?? ""}
                      onChange={(e) => setInputs({ ...inputs, [field.name]: e.target.value })}
                      rows={3}
                      placeholder={field.placeholder}
                      className="w-full px-3 py-2 bg-background border border-input rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-ring/20 focus:border-ring"
                    />
                  ) : (
                    <input
                      type="text"
                      value={inputs[field.name] ?? ""}
                      onChange={(e) => setInputs({ ...inputs, [field.name]: e.target.value })}
                      placeholder={field.placeholder}
                      className="w-full px-3 py-2 bg-background border border-input rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-ring/20 focus:border-ring"
                    />
                  )}
                </div>
              ))}
              <button
                onClick={() => generateMutation.mutate()}
                disabled={generateMutation.isPending}
                className="w-full inline-flex items-center justify-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
              >
                {generateMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                {generateMutation.isPending ? "Generating with AI…" : "Generate"}
              </button>
            </div>
          </section>
        </div>

        {/* Output viewer */}
        {viewing && (
          <section className="rounded-xl border border-border bg-card p-6 mt-6">
            <header className="flex items-start justify-between gap-3 mb-4">
              <div>
                <div className="text-xs uppercase tracking-[0.2em] text-muted-foreground">{tool.label}</div>
                <h2 className="mt-1 font-serif text-2xl text-foreground">{viewing.title}</h2>
                <p className="mt-1 text-xs text-muted-foreground">
                  Generated {new Date(viewing.createdAt).toLocaleString("en-IN")}
                </p>
              </div>
              <button onClick={() => setViewing(null)} className="text-xs text-muted-foreground hover:text-foreground">
                Close
              </button>
            </header>
            {renderOutput(activeTool, viewing.output)}
          </section>
        )}
        </>
        )}

        <footer className="pt-2 text-center text-xs text-muted-foreground">
          Thinking Spree · Consultant Suite v5.0
        </footer>
      </main>
    </Layout>
  );
}
