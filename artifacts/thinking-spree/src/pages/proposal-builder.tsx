import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react";
import { Layout } from "@/components/Layout";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { FileText, Plus, Sparkles, Loader2, Copy, Trash2, ChevronRight, ArrowLeft, GripVertical, X } from "lucide-react";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

type Section = { heading: string; body: string; aiGenerated: boolean };
type Proposal = {
  id: number;
  prospectName: string;
  prospectCompany: string;
  brief: string | null;
  sections: Section[];
  status: "draft" | "final";
  createdAt: string;
  updatedAt: string;
};

export default function ProposalBuilderPage() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [active, setActive] = useState<number | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [createForm, setCreateForm] = useState({ prospectName: "", prospectCompany: "", brief: "" });

  const { data: listData, isLoading } = useQuery<{ proposals: Proposal[] }>({
    queryKey: ["/api/sales/proposals"],
    queryFn: () => customFetch(`${BASE}/api/sales/proposals`, { credentials: "include" }),
    staleTime: 10_000,
  });

  const { data: activeData } = useQuery<{ proposal: Proposal }>({
    queryKey: ["/api/sales/proposals", active],
    queryFn: () => customFetch(`${BASE}/api/sales/proposals/${active}`, { credentials: "include" }),
    enabled: active !== null,
    staleTime: 0,
  });

  const createMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`${BASE}/api/sales/proposals`, {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(createForm),
      });
      if (!res.ok) throw new Error((await res.json()).error || "Create failed");
      return (await res.json()).proposal as Proposal;
    },
    onSuccess: (p) => {
      qc.invalidateQueries({ queryKey: ["/api/sales/proposals"] });
      setActive(p.id);
      setCreateOpen(false);
      setCreateForm({ prospectName: "", prospectCompany: "", brief: "" });
      toast({ title: "Proposal created", description: "Default sections added — customize headings and fill with AI." });
    },
    onError: (err: any) => toast({ title: "Failed", description: err.message, variant: "destructive" }),
  });

  if (active !== null) {
    return <ProposalDetail
      proposal={activeData?.proposal}
      onBack={() => setActive(null)}
    />;
  }

  return (
    <Layout>
      <main className="flex-1 space-y-6 px-6 py-8 lg:px-10 max-w-[1400px] mx-auto">
        <section className="flex items-end justify-between gap-4 flex-wrap">
          <div>
            <div className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Workspace</div>
            <h1 className="mt-2 font-serif text-4xl text-foreground">Proposal Builder</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              You provide the section structure. AI fills each section's body. You stay in control of the edits.
            </p>
          </div>
          <button
            onClick={() => setCreateOpen(true)}
            className="inline-flex items-center gap-2 rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:opacity-90"
          >
            <Plus className="h-4 w-4" /> New Proposal
          </button>
        </section>

        {isLoading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-44 rounded-xl" />)}
          </div>
        ) : (listData?.proposals ?? []).length === 0 ? (
          <div className="rounded-xl border border-dashed border-border bg-card p-12 text-center">
            <div className="mx-auto rounded-full bg-muted/50 p-3 w-fit">
              <FileText className="h-6 w-6 text-muted-foreground" />
            </div>
            <h3 className="mt-3 font-serif text-xl text-foreground">No proposals yet</h3>
            <p className="mt-1 text-sm text-muted-foreground max-w-md mx-auto">
              Start a new proposal: pick the section structure (or use defaults), then have AI fill each section's body.
            </p>
            <button onClick={() => setCreateOpen(true)} className="mt-4 inline-flex items-center gap-2 rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:opacity-90">
              <Plus className="h-4 w-4" /> Start your first proposal
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {(listData?.proposals ?? []).map(p => {
              const sections = p.sections ?? [];
              const filled = sections.filter((s: any) => s.body && s.body.trim()).length;
              const progress = sections.length > 0 ? Math.round((filled / sections.length) * 100) : 0;
              const initials = (p.prospectCompany || "?").trim().slice(0, 2).toUpperCase();
              return (
                <button
                  key={p.id}
                  onClick={() => setActive(p.id)}
                  className="group rounded-xl border border-border bg-card p-5 text-left transition hover:border-primary/40 hover:shadow-sm relative overflow-hidden"
                >
                  {/* Subtle accent strip */}
                  <div className={`absolute top-0 left-0 h-1 w-full ${p.status === "final" ? "bg-emerald-500/80" : "bg-amber-500/60"}`} />

                  <div className="flex items-start gap-3">
                    <div className="rounded-md font-serif text-lg flex items-center justify-center w-11 h-11 flex-shrink-0"
                         style={{ background: "var(--gold)", color: "hsl(222 38% 15%)" }}>
                      {initials}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="font-medium text-foreground truncate">{p.prospectCompany}</div>
                      <div className="text-[11px] text-muted-foreground truncate">To {p.prospectName}</div>
                    </div>
                    <span className={`rounded-full border px-2 py-0.5 text-[10px] font-medium ${p.status === "final" ? "bg-emerald-50 text-emerald-700 border-emerald-200" : "bg-amber-50 text-amber-800 border-amber-200"}`}>
                      {p.status}
                    </span>
                  </div>

                  {/* Progress bar — filled vs total sections */}
                  <div className="mt-4 space-y-1">
                    <div className="flex items-center justify-between text-[11px] text-muted-foreground">
                      <span>{filled}/{sections.length} sections drafted</span>
                      <span className="tabular-nums">{progress}%</span>
                    </div>
                    <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                      <div className="h-full bg-primary transition-all" style={{ width: `${progress}%` }} />
                    </div>
                  </div>

                  <div className="mt-3 text-[11px] text-muted-foreground">
                    Updated {new Date(p.updatedAt).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}
                  </div>
                </button>
              );
            })}
          </div>
        )}

        {createOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
               style={{ background: "rgba(15,23,42,.55)", backdropFilter: "blur(4px)" }}
               onMouseDown={(e) => { if (e.target === e.currentTarget && !createMutation.isPending) setCreateOpen(false); }}>
            <div className="w-full max-w-lg rounded-xl border border-border bg-card shadow-2xl" onMouseDown={(e) => e.stopPropagation()}>
              <header className="flex items-center justify-between border-b border-border px-6 py-4">
                <h2 className="font-serif text-2xl text-foreground">New Proposal</h2>
                <button onClick={() => setCreateOpen(false)} className="rounded-md p-1.5 text-muted-foreground hover:bg-muted"><X className="h-4 w-4" /></button>
              </header>
              <div className="p-6 space-y-3">
                <div>
                  <label className="mb-1 block text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Prospect Name <span className="text-destructive">*</span></label>
                  <input value={createForm.prospectName} onChange={(e) => setCreateForm({ ...createForm, prospectName: e.target.value })}
                    placeholder="e.g. Anjali Sharma"
                    className="w-full px-3 py-2 bg-background border border-input rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-ring/20 focus:border-ring" />
                </div>
                <div>
                  <label className="mb-1 block text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Prospect Company <span className="text-destructive">*</span></label>
                  <input value={createForm.prospectCompany} onChange={(e) => setCreateForm({ ...createForm, prospectCompany: e.target.value })}
                    placeholder="e.g. Acme Tech"
                    className="w-full px-3 py-2 bg-background border border-input rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-ring/20 focus:border-ring" />
                </div>
                <div>
                  <label className="mb-1 block text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Brief (shared across all AI-filled sections)</label>
                  <textarea value={createForm.brief} onChange={(e) => setCreateForm({ ...createForm, brief: e.target.value })}
                    rows={4} placeholder="What we're proposing and why. The AI uses this for every section it fills."
                    className="w-full px-3 py-2 bg-background border border-input rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-ring/20 focus:border-ring" />
                </div>
                <p className="text-[11px] text-muted-foreground">A default set of sections (Executive Summary, Approach, Investment, etc.) will be added. You can rename them and add/remove sections after creation.</p>
              </div>
              <footer className="flex justify-end gap-2 border-t border-border px-6 py-3 bg-muted/30">
                <button onClick={() => setCreateOpen(false)} disabled={createMutation.isPending} className="rounded-md border border-border bg-background px-3 py-1.5 text-xs font-medium text-foreground hover:bg-muted">Cancel</button>
                <button
                  onClick={() => createMutation.mutate()}
                  disabled={createMutation.isPending || !createForm.prospectName.trim() || !createForm.prospectCompany.trim()}
                  className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50">
                  {createMutation.isPending ? "Creating…" : "Create"}
                </button>
              </footer>
            </div>
          </div>
        )}

        <footer className="pt-2 text-center text-xs text-muted-foreground">Thinking Spree · Consultant Suite v5.0</footer>
      </main>
    </Layout>
  );
}

function ProposalDetail({ proposal, onBack }: { proposal: Proposal | undefined; onBack: () => void }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [sections, setSections] = useState<Section[]>(proposal?.sections ?? []);
  const [brief, setBrief] = useState(proposal?.brief ?? "");
  const [fillingIdx, setFillingIdx] = useState<number | null>(null);

  // Sync local state when proposal data arrives
  useState(() => {
    if (proposal) { setSections(proposal.sections ?? []); setBrief(proposal.brief ?? ""); }
  });

  if (!proposal) {
    return <Layout><div className="p-10 text-center text-sm text-muted-foreground">Loading proposal…</div></Layout>;
  }

  async function saveAll() {
    const res = await fetch(`${BASE}/api/sales/proposals/${proposal!.id}`, {
      method: "PATCH", credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sections, brief }),
    });
    if (!res.ok) {
      toast({ title: "Save failed", variant: "destructive" });
      return;
    }
    toast({ title: "Saved" });
    qc.invalidateQueries({ queryKey: ["/api/sales/proposals", proposal!.id] });
  }

  async function fillSection(idx: number) {
    setFillingIdx(idx);
    try {
      // Save current state first so the server has the latest brief + headings
      await fetch(`${BASE}/api/sales/proposals/${proposal!.id}`, {
        method: "PATCH", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sections, brief }),
      });
      const res = await fetch(`${BASE}/api/sales/proposals/${proposal!.id}/fill-section`, {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sectionIndex: idx }),
      });
      if (!res.ok) throw new Error((await res.json()).error || "Fill failed");
      const { body } = await res.json();
      const next = [...sections];
      next[idx] = { ...next[idx], body, aiGenerated: true };
      setSections(next);
      toast({ title: "Section filled by AI" });
    } catch (err: any) {
      toast({ title: "AI fill failed", description: err.message, variant: "destructive" });
    } finally {
      setFillingIdx(null);
    }
  }

  function addSection() {
    setSections([...sections, { heading: "New Section", body: "", aiGenerated: false }]);
  }
  function removeSection(idx: number) {
    setSections(sections.filter((_, i) => i !== idx));
  }
  function updateSection(idx: number, patch: Partial<Section>) {
    const next = [...sections];
    next[idx] = { ...next[idx], ...patch };
    setSections(next);
  }
  function exportAsText() {
    const text = sections.map(s => `# ${s.heading}\n\n${s.body}`).join("\n\n");
    navigator.clipboard.writeText(text);
    toast({ title: "Copied to clipboard", description: "Paste into your doc editor." });
  }

  return (
    <Layout>
      <main className="flex-1 space-y-6 px-6 py-8 lg:px-10 max-w-[1100px] mx-auto">
        <button onClick={onBack} className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-4 w-4" /> Back to proposals
        </button>

        <section className="rounded-xl border border-border bg-card p-6">
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div>
              <div className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Proposal</div>
              <h1 className="mt-2 font-serif text-3xl text-foreground">{proposal.prospectCompany}</h1>
              <p className="mt-1 text-sm text-muted-foreground">To {proposal.prospectName}</p>
            </div>
            <div className="flex items-center gap-2">
              <span className={`rounded-full border px-2.5 py-1 text-[10px] font-medium ${proposal.status === "final" ? "bg-emerald-50 text-emerald-700 border-emerald-200" : "bg-amber-50 text-amber-800 border-amber-200"}`}>
                {proposal.status}
              </span>
              <button
                onClick={async () => {
                  const next = proposal.status === "final" ? "draft" : "final";
                  await fetch(`${BASE}/api/sales/proposals/${proposal.id}`, {
                    method: "PATCH", credentials: "include",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ status: next }),
                  });
                  qc.invalidateQueries({ queryKey: ["/api/sales/proposals", proposal.id] });
                  qc.invalidateQueries({ queryKey: ["/api/sales/proposals"] });
                  toast({ title: next === "final" ? "Marked as final" : "Reverted to draft" });
                }}
                className="inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-3 py-1.5 text-xs font-medium hover:bg-muted"
              >
                {proposal.status === "final" ? "Revert to draft" : "Mark as final"}
              </button>
              <button onClick={exportAsText} className="inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-3 py-1.5 text-xs font-medium hover:bg-muted">
                <Copy className="h-3.5 w-3.5" /> Copy as text
              </button>
              <button onClick={saveAll} className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:opacity-90">
                Save changes
              </button>
            </div>
          </div>

          <div className="mt-4">
            <label className="mb-1 block text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Brief (used by AI for all sections)</label>
            <textarea value={brief} onChange={(e) => setBrief(e.target.value)} rows={3}
              className="w-full px-3 py-2 bg-background border border-input rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-ring/20 focus:border-ring" />
          </div>
        </section>

        <section className="space-y-4">
          {sections.map((s, i) => (
            <div key={i} className="rounded-xl border border-border bg-card p-5">
              <div className="flex items-start gap-2">
                <div className="flex-1">
                  <input
                    value={s.heading}
                    onChange={(e) => updateSection(i, { heading: e.target.value })}
                    className="w-full bg-transparent text-lg font-serif text-foreground border-b border-transparent hover:border-border focus:border-primary focus:outline-none px-0 py-1 transition"
                    placeholder="Section heading"
                  />
                </div>
                <div className="flex items-center gap-1">
                  {s.aiGenerated && <span className="rounded-full bg-violet-50 text-violet-700 border border-violet-200 px-2 py-0.5 text-[10px] font-medium">AI</span>}
                  <button onClick={() => fillSection(i)} disabled={fillingIdx === i}
                    className="inline-flex items-center gap-1 rounded-md border border-border bg-card px-2 py-1 text-[11px] font-medium hover:bg-muted disabled:opacity-50">
                    {fillingIdx === i ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
                    {fillingIdx === i ? "Filling…" : (s.body ? "Re-fill with AI" : "Fill with AI")}
                  </button>
                  <button onClick={() => removeSection(i)} className="rounded p-1 text-muted-foreground hover:bg-destructive/10 hover:text-destructive">
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
              <textarea
                value={s.body}
                onChange={(e) => updateSection(i, { body: e.target.value, aiGenerated: false })}
                rows={s.body ? 6 : 3}
                placeholder="Section body — write yourself or use 'Fill with AI'."
                className="mt-3 w-full px-3 py-2 bg-background border border-input rounded-md text-sm leading-relaxed focus:outline-none focus:ring-2 focus:ring-ring/20 focus:border-ring"
              />
            </div>
          ))}
          <button onClick={addSection}
            className="w-full rounded-xl border-2 border-dashed border-border bg-card hover:bg-muted/30 px-5 py-3 text-sm text-muted-foreground inline-flex items-center justify-center gap-2 transition">
            <Plus className="h-4 w-4" /> Add Section
          </button>
        </section>
      </main>
    </Layout>
  );
}
