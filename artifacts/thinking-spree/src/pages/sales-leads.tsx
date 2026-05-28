import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react";
import { Layout } from "@/components/Layout";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import {
  Plus, Trash2, Linkedin, Mail, X, ExternalLink, Search,
  LayoutGrid, List, Building2, User, Sparkles, Loader2,
} from "lucide-react";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

/** Stage definitions — drives both the kanban columns and the chip filters.
 *  Order matters: columns render left → right in this order. */
const STAGES = [
  { value: "cold",            label: "Cold",           accent: "border-slate-200",  dot: "bg-slate-400",   chip: "bg-slate-100 text-slate-700 border-slate-200" },
  { value: "contacted",       label: "Contacted",      accent: "border-blue-200",   dot: "bg-blue-500",     chip: "bg-blue-50 text-blue-700 border-blue-200" },
  { value: "meeting_booked",  label: "Meeting Booked", accent: "border-amber-200",  dot: "bg-amber-500",    chip: "bg-amber-50 text-amber-800 border-amber-200" },
  { value: "proposal_sent",   label: "Proposal Sent",  accent: "border-violet-200", dot: "bg-violet-500",   chip: "bg-violet-50 text-violet-800 border-violet-200" },
  { value: "won",             label: "Won",            accent: "border-emerald-200",dot: "bg-emerald-500",  chip: "bg-emerald-50 text-emerald-700 border-emerald-200" },
  { value: "lost",            label: "Lost",           accent: "border-rose-200",   dot: "bg-rose-500",     chip: "bg-rose-50 text-rose-700 border-rose-200" },
] as const;

type Lead = {
  id: number;
  companyName: string;
  contactName: string | null;
  contactEmail: string | null;
  contactRole: string | null;
  linkedinUrl: string | null;
  stage: string;
  source: string | null;
  notes: string | null;
  lastTouchAt: string | null;
  createdAt: string;
  updatedAt: string;
};

/**
 * Extract a human-readable handle from a LinkedIn URL. Used to pre-fill the
 * Contact Name field when the consultant pastes a URL but doesn't yet know
 * the person's name. Best-effort — the slug isn't always the real name.
 */
function deriveNameFromLinkedInUrl(url: string): string | null {
  const m = url.match(/linkedin\.com\/in\/([^/?#]+)/i);
  if (!m) return null;
  // LinkedIn sometimes appends hash-style tags like "anjali-sharma-3a7b9c1d".
  // We strip only suffixes that look like a hash (mixed letters + digits,
  // 6+ chars) — pure-alpha tokens like "Sharma" are real surnames and
  // must NOT be stripped.
  let slug = decodeURIComponent(m[1]).replace(/-([a-z0-9]{6,})$/i, (match, tag) => {
    return (/[0-9]/.test(tag) && /[a-z]/i.test(tag)) ? "" : match;
  });
  return slug
    .split(/[-_]/g)
    .filter(Boolean)
    .map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(" ");
}

/** Canonicalise a LinkedIn URL. Returns null if it doesn't look like one. */
function canonicalLinkedInUrl(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (/^[a-z0-9_-]+$/i.test(trimmed)) return `https://www.linkedin.com/in/${trimmed}`;
  if (/^in\/[a-z0-9_-]+$/i.test(trimmed)) return `https://www.linkedin.com/${trimmed}`;
  if (!/linkedin\.com/i.test(trimmed)) return null;
  if (!/^https?:\/\//i.test(trimmed)) return `https://${trimmed}`;
  return trimmed;
}

// ───────────────────── MAIN PAGE ──────────────────────────────────────────
export default function SalesLeadsPage() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [view, setView] = useState<"kanban" | "list">("kanban");
  const [stageFilter, setStageFilter] = useState<string>("all");
  const [search, setSearch] = useState("");
  const [openCreate, setOpenCreate] = useState(false);
  const [editingLead, setEditingLead] = useState<Lead | null>(null);
  const [newLead, setNewLead] = useState<Partial<Lead>>({ stage: "cold" });

  const { data, isLoading } = useQuery<{ leads: Lead[] }>({
    queryKey: ["/api/sales/leads"],
    queryFn: () => customFetch(`${BASE}/api/sales/leads`, { credentials: "include" }),
    staleTime: 10_000,
  });

  const createMutation = useMutation({
    mutationFn: async (lead: Partial<Lead>) => {
      const res = await fetch(`${BASE}/api/sales/leads`, {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(lead),
      });
      if (!res.ok) throw new Error((await res.json()).error || "Create failed");
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Lead added" });
      qc.invalidateQueries({ queryKey: ["/api/sales/leads"] });
      setOpenCreate(false);
      setNewLead({ stage: "cold" });
    },
    onError: (err: any) => toast({ title: "Failed", description: err.message, variant: "destructive" }),
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, patch }: { id: number; patch: Partial<Lead> }) => {
      const res = await fetch(`${BASE}/api/sales/leads/${id}`, {
        method: "PATCH", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      if (!res.ok) throw new Error((await res.json()).error || "Update failed");
      return res.json();
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["/api/sales/leads"] }),
    onError: (err: any) => toast({ title: "Failed", description: err.message, variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      const res = await fetch(`${BASE}/api/sales/leads/${id}`, { method: "DELETE", credentials: "include" });
      if (!res.ok) throw new Error("Delete failed");
    },
    onSuccess: () => {
      toast({ title: "Deleted" });
      qc.invalidateQueries({ queryKey: ["/api/sales/leads"] });
    },
  });

  // Filtered + searched leads
  const filteredLeads = useMemo(() => {
    const leads = data?.leads ?? [];
    return leads.filter(l => {
      if (stageFilter !== "all" && l.stage !== stageFilter) return false;
      if (search.trim()) {
        const q = search.toLowerCase();
        const haystack = [l.companyName, l.contactName, l.contactRole, l.contactEmail, l.notes]
          .filter(Boolean).join(" ").toLowerCase();
        if (!haystack.includes(q)) return false;
      }
      return true;
    });
  }, [data, stageFilter, search]);

  const stageCounts = useMemo(() => {
    const counts: Record<string, number> = { all: 0 };
    for (const s of STAGES) counts[s.value] = 0;
    for (const l of data?.leads ?? []) {
      counts.all++;
      counts[l.stage] = (counts[l.stage] ?? 0) + 1;
    }
    return counts;
  }, [data]);

  const leadsByStage = useMemo(() => {
    const m: Record<string, Lead[]> = {};
    for (const s of STAGES) m[s.value] = [];
    for (const l of filteredLeads) {
      if (m[l.stage]) m[l.stage].push(l);
      else m[l.stage] = [l];
    }
    return m;
  }, [filteredLeads]);

  return (
    <Layout>
      <main className="flex-1 space-y-6 px-6 py-8 lg:px-10 max-w-[1500px] mx-auto">
        <section className="flex items-end justify-between gap-4 flex-wrap">
          <div>
            <div className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Workspace</div>
            <h1 className="mt-2 font-serif text-4xl text-foreground">Sales Pipeline</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              CRM-lite for prospects. Drag a card or change the dropdown to move stages.
            </p>
          </div>
          <button
            onClick={() => { setOpenCreate(true); setNewLead({ stage: "cold" }); }}
            className="inline-flex items-center gap-2 rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 shadow-sm"
          >
            <Plus className="h-4 w-4" /> Add Lead
          </button>
        </section>

        <div className="flex items-center gap-3 flex-wrap">
          <div className="relative flex-1 min-w-[280px] max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <input
              type="text"
              placeholder="Search by company, contact, role, notes…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-9 pr-3 py-2 bg-card border border-input rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-ring/20 focus:border-ring"
            />
          </div>
          <div className="ml-auto inline-flex items-center rounded-md border border-border bg-card overflow-hidden text-xs">
            <button onClick={() => setView("kanban")}
              className={`px-3 py-1.5 inline-flex items-center gap-1.5 ${view === "kanban" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted"}`}>
              <LayoutGrid className="h-3 w-3" /> Pipeline
            </button>
            <button onClick={() => setView("list")}
              className={`px-3 py-1.5 inline-flex items-center gap-1.5 ${view === "list" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted"}`}>
              <List className="h-3 w-3" /> Table
            </button>
          </div>
        </div>

        {view === "list" && (
          <div className="flex items-center gap-2 flex-wrap">
            <button
              onClick={() => setStageFilter("all")}
              className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition ${stageFilter === "all" ? "bg-primary text-primary-foreground border-primary" : "bg-card text-foreground border-border hover:bg-muted"}`}
            >
              All <span className="text-[10px] opacity-70 tabular-nums">{stageCounts.all}</span>
            </button>
            {STAGES.map(s => (
              <button
                key={s.value}
                onClick={() => setStageFilter(s.value)}
                className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition ${stageFilter === s.value ? "ring-2 ring-primary/30 " + s.chip : `${s.chip} hover:opacity-80`}`}
              >
                <span className={`h-1.5 w-1.5 rounded-full ${s.dot}`} />
                {s.label} <span className="text-[10px] opacity-70 tabular-nums">{stageCounts[s.value] ?? 0}</span>
              </button>
            ))}
          </div>
        )}

        {isLoading ? (
          <div className="space-y-2">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-24 rounded-lg" />)}</div>
        ) : (data?.leads ?? []).length === 0 ? (
          <EmptyState onAdd={() => setOpenCreate(true)} />
        ) : view === "kanban" ? (
          <KanbanView
            leadsByStage={leadsByStage}
            onClickLead={(l) => setEditingLead(l)}
            onChangeStage={(id, stage) => updateMutation.mutate({ id, patch: { stage } })}
            onDelete={(id) => { if (confirm("Delete this lead?")) deleteMutation.mutate(id); }}
          />
        ) : (
          <ListView
            leads={filteredLeads}
            onClickLead={(l) => setEditingLead(l)}
            onChangeStage={(id, stage) => updateMutation.mutate({ id, patch: { stage } })}
            onDelete={(id) => { if (confirm("Delete this lead?")) deleteMutation.mutate(id); }}
          />
        )}

        {openCreate && (
          <LeadForm
            initial={newLead}
            onCancel={() => setOpenCreate(false)}
            onSave={(lead) => createMutation.mutate(lead)}
            saving={createMutation.isPending}
          />
        )}
        {editingLead && (
          <LeadForm
            initial={editingLead}
            onCancel={() => setEditingLead(null)}
            onSave={(patch) => {
              updateMutation.mutate({ id: editingLead.id, patch }, {
                onSuccess: () => { setEditingLead(null); toast({ title: "Updated" }); }
              });
            }}
            saving={updateMutation.isPending}
            isEdit
          />
        )}

        <footer className="pt-2 text-center text-xs text-muted-foreground">Thinking Spree · Consultant Suite v5.1</footer>
      </main>
    </Layout>
  );
}

function KanbanView({ leadsByStage, onClickLead, onChangeStage, onDelete }: {
  leadsByStage: Record<string, Lead[]>;
  onClickLead: (l: Lead) => void;
  onChangeStage: (id: number, stage: string) => void;
  onDelete: (id: number) => void;
}) {
  const [draggingId, setDraggingId] = useState<number | null>(null);
  const [overStage, setOverStage] = useState<string | null>(null);

  function onDrop(stage: string) {
    if (draggingId !== null) onChangeStage(draggingId, stage);
    setDraggingId(null);
    setOverStage(null);
  }

  return (
    <div className="overflow-x-auto pb-2">
      <div className="grid grid-flow-col auto-cols-[minmax(280px,1fr)] gap-3 min-w-full">
        {STAGES.map(s => (
          <div
            key={s.value}
            onDragOver={(e) => { e.preventDefault(); setOverStage(s.value); }}
            onDragLeave={() => setOverStage(prev => prev === s.value ? null : prev)}
            onDrop={() => onDrop(s.value)}
            className={`rounded-xl border-2 ${overStage === s.value ? "border-primary bg-primary/5" : s.accent} bg-card flex flex-col transition-colors`}
          >
            <header className="flex items-center justify-between px-4 py-3 border-b border-border">
              <div className="flex items-center gap-2">
                <span className={`h-2 w-2 rounded-full ${s.dot}`} />
                <span className="text-xs font-semibold uppercase tracking-wider text-foreground">{s.label}</span>
              </div>
              <span className="text-[10px] text-muted-foreground tabular-nums bg-muted/50 px-1.5 py-0.5 rounded">
                {leadsByStage[s.value]?.length ?? 0}
              </span>
            </header>
            <div className="p-2 space-y-2 min-h-[120px]">
              {(leadsByStage[s.value] ?? []).length === 0 ? (
                <div className="px-3 py-6 text-center text-[11px] text-muted-foreground/50">
                  Drop or add a lead here
                </div>
              ) : (
                leadsByStage[s.value].map(l => (
                  <KanbanCard
                    key={l.id}
                    lead={l}
                    onDragStart={() => setDraggingId(l.id)}
                    onDragEnd={() => setDraggingId(null)}
                    onClick={() => onClickLead(l)}
                    onDelete={() => onDelete(l.id)}
                  />
                ))
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function KanbanCard({ lead, onDragStart, onDragEnd, onClick, onDelete }: {
  lead: Lead; onDragStart: () => void; onDragEnd: () => void; onClick: () => void; onDelete: () => void;
}) {
  return (
    <div
      draggable
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      className="group rounded-lg border border-border bg-background hover:border-primary/40 hover:shadow-sm transition cursor-grab active:cursor-grabbing"
    >
      <button onClick={onClick} className="block w-full text-left px-3 py-2.5">
        <div className="flex items-start gap-2">
          <div className="flex-shrink-0 mt-0.5">
            <div className="rounded-md p-1.5 bg-muted/60">
              <Building2 className="h-3.5 w-3.5 text-muted-foreground" />
            </div>
          </div>
          <div className="min-w-0 flex-1">
            <div className="font-medium text-sm text-foreground truncate">{lead.companyName}</div>
            {lead.contactName && (
              <div className="text-[11px] text-muted-foreground truncate">
                {lead.contactName}{lead.contactRole ? ` · ${lead.contactRole}` : ""}
              </div>
            )}
            {lead.notes && (
              <div className="text-[11px] text-muted-foreground/80 line-clamp-2 mt-1">{lead.notes}</div>
            )}
          </div>
        </div>
      </button>
      <div className="flex items-center gap-1 px-2 pb-2 opacity-0 group-hover:opacity-100 transition">
        {lead.linkedinUrl && (
          <a href={lead.linkedinUrl} target="_blank" rel="noreferrer"
             className="inline-flex items-center gap-1 rounded p-1 text-[10px] text-blue-700 hover:bg-blue-50"
             title="Open in LinkedIn" onClick={(e) => e.stopPropagation()}>
            <Linkedin className="h-3 w-3" />
          </a>
        )}
        {lead.contactEmail && (
          <a href={`mailto:${lead.contactEmail}`}
             className="inline-flex items-center gap-1 rounded p-1 text-[10px] text-muted-foreground hover:bg-muted hover:text-foreground"
             title="Email" onClick={(e) => e.stopPropagation()}>
            <Mail className="h-3 w-3" />
          </a>
        )}
        <button onClick={(e) => { e.stopPropagation(); onDelete(); }}
          className="ml-auto rounded p-1 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
          title="Delete">
          <Trash2 className="h-3 w-3" />
        </button>
      </div>
    </div>
  );
}

function ListView({ leads, onClickLead, onChangeStage, onDelete }: {
  leads: Lead[]; onClickLead: (l: Lead) => void;
  onChangeStage: (id: number, stage: string) => void;
  onDelete: (id: number) => void;
}) {
  if (leads.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-border bg-card p-10 text-center text-sm text-muted-foreground">
        No leads match the current filter.
      </div>
    );
  }
  return (
    <section className="rounded-xl border border-border bg-card overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-muted/40 text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            <tr>
              <th className="px-4 py-3">Company</th>
              <th className="px-4 py-3">Contact</th>
              <th className="px-4 py-3">Stage</th>
              <th className="px-4 py-3">Source</th>
              <th className="px-4 py-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {leads.map(l => (
              <tr key={l.id} className="border-t border-border hover:bg-muted/20 transition">
                <td className="px-4 py-3">
                  <button onClick={() => onClickLead(l)} className="text-left">
                    <div className="font-medium text-foreground">{l.companyName}</div>
                    {l.notes && <div className="text-[11px] text-muted-foreground line-clamp-1 max-w-xs">{l.notes}</div>}
                  </button>
                </td>
                <td className="px-4 py-3">
                  {l.contactName ? (
                    <>
                      <div className="text-foreground">{l.contactName}</div>
                      {l.contactRole && <div className="text-[11px] text-muted-foreground">{l.contactRole}</div>}
                    </>
                  ) : <span className="text-muted-foreground italic">—</span>}
                </td>
                <td className="px-4 py-3">
                  <select
                    value={l.stage}
                    onChange={(e) => onChangeStage(l.id, e.target.value)}
                    className="text-xs bg-background border border-input rounded px-2 py-1"
                  >
                    {STAGES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
                  </select>
                </td>
                <td className="px-4 py-3 text-xs text-muted-foreground">{l.source ?? "—"}</td>
                <td className="px-4 py-3 text-right">
                  <div className="inline-flex items-center gap-1">
                    {l.linkedinUrl && (
                      <a href={l.linkedinUrl} target="_blank" rel="noreferrer"
                         className="rounded p-1.5 text-blue-700 hover:bg-blue-50" title="Open in LinkedIn">
                        <Linkedin className="h-3.5 w-3.5" />
                      </a>
                    )}
                    {l.contactEmail && (
                      <a href={`mailto:${l.contactEmail}`}
                         className="rounded p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground" title="Email">
                        <Mail className="h-3.5 w-3.5" />
                      </a>
                    )}
                    <button onClick={() => onDelete(l.id)}
                      className="rounded p-1.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive" title="Delete">
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function EmptyState({ onAdd }: { onAdd: () => void }) {
  return (
    <div className="rounded-xl border border-dashed border-border bg-card p-12 text-center">
      <div className="mx-auto rounded-full bg-muted/50 p-3 w-fit">
        <User className="h-6 w-6 text-muted-foreground" />
      </div>
      <h3 className="mt-3 font-serif text-xl text-foreground">No leads yet</h3>
      <p className="mt-1 text-sm text-muted-foreground max-w-md mx-auto">
        Add a sales lead manually, or paste a LinkedIn profile URL to quick-add a prospect.
      </p>
      <button onClick={onAdd} className="mt-4 inline-flex items-center gap-2 rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:opacity-90">
        <Plus className="h-4 w-4" /> Add your first lead
      </button>
    </div>
  );
}

function LeadForm({ initial, onCancel, onSave, saving, isEdit }: {
  initial: Partial<Lead>; onCancel: () => void;
  onSave: (l: Partial<Lead>) => void; saving: boolean; isEdit?: boolean;
}) {
  const { toast } = useToast();
  const [form, setForm] = useState<Partial<Lead>>(initial);
  const [linkedinPaste, setLinkedinPaste] = useState("");
  const [importing, setImporting] = useState(false);

  /**
   * Paste-LinkedIn quick-add. We can't hit LinkedIn's API. The best we can
   * do is extract the slug from the URL itself — usually contains the
   * person's name. Pre-fills Contact Name + LinkedIn URL.
   */
  function importFromLinkedIn() {
    const canonical = canonicalLinkedInUrl(linkedinPaste);
    if (!canonical) {
      toast({ title: "Doesn't look like a LinkedIn URL", description: "Paste like https://linkedin.com/in/anjali-sharma", variant: "destructive" });
      return;
    }
    setImporting(true);
    setTimeout(() => {
      const derivedName = deriveNameFromLinkedInUrl(canonical);
      setForm(prev => ({
        ...prev,
        linkedinUrl: canonical,
        contactName: prev.contactName || derivedName || "",
      }));
      setLinkedinPaste("");
      setImporting(false);
      toast({
        title: "LinkedIn URL added",
        description: derivedName ? `Pre-filled name: ${derivedName}. Adjust if needed.` : "Couldn't extract a name from the URL.",
      });
    }, 250);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
         style={{ background: "rgba(15,23,42,.55)", backdropFilter: "blur(4px)" }}
         onMouseDown={(e) => { if (e.target === e.currentTarget && !saving) onCancel(); }}>
      <div className="w-full max-w-2xl rounded-xl border border-border bg-card shadow-2xl flex flex-col max-h-[90vh]"
           onMouseDown={(e) => e.stopPropagation()}>
        <header className="flex items-center justify-between border-b border-border px-6 py-4">
          <h2 className="font-serif text-2xl text-foreground">{isEdit ? "Edit Lead" : "Add Lead"}</h2>
          <button onClick={onCancel} className="rounded-md p-1.5 text-muted-foreground hover:bg-muted">
            <X className="h-4 w-4" />
          </button>
        </header>
        <div className="p-6 space-y-4 overflow-y-auto flex-1">
          {!isEdit && (
            <div className="rounded-lg border border-blue-200 bg-blue-50/50 p-4">
              <div className="flex items-center gap-2 mb-2">
                <Linkedin className="h-4 w-4 text-blue-700" />
                <h3 className="text-xs font-semibold uppercase tracking-wider text-blue-900">Quick-add from LinkedIn URL</h3>
              </div>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={linkedinPaste}
                  onChange={(e) => setLinkedinPaste(e.target.value)}
                  placeholder="Paste LinkedIn profile URL"
                  className="flex-1 px-3 py-2 bg-background border border-input rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-ring/20"
                />
                <button onClick={importFromLinkedIn} disabled={!linkedinPaste.trim() || importing}
                  className="inline-flex items-center gap-1.5 rounded-md bg-blue-600 text-white px-3 py-2 text-xs font-medium hover:bg-blue-700 disabled:opacity-50">
                  {importing ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
                  Import
                </button>
              </div>
              <p className="mt-1.5 text-[11px] text-blue-900/70">
                We extract the name from the URL slug. LinkedIn's API doesn't let third-parties fetch profile data.
              </p>
            </div>
          )}

          {[
            { name: "companyName",  label: "Company Name",   required: true,  icon: Building2, placeholder: "e.g. Acme Tech" },
            { name: "contactName",  label: "Contact Name",   required: false, icon: User,      placeholder: "e.g. Anjali Sharma" },
            { name: "contactRole",  label: "Contact Role",   required: false, icon: null,      placeholder: "e.g. VP Growth" },
            { name: "contactEmail", label: "Contact Email",  required: false, icon: Mail,      type: "email", placeholder: "name@company.com" },
            { name: "linkedinUrl",  label: "LinkedIn URL",   required: false, icon: Linkedin,  type: "url", placeholder: "https://linkedin.com/in/..." },
            { name: "source",       label: "Source",         required: false, icon: null,      placeholder: "e.g. inbound, referral, event" },
          ].map(f => (
            <div key={f.name}>
              <label className="mb-1 block text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                {f.label}{f.required && <span className="text-destructive ml-0.5">*</span>}
              </label>
              <div className="relative">
                {f.icon && (
                  <f.icon className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
                )}
                <input
                  type={f.type ?? "text"}
                  value={(form as any)[f.name] ?? ""}
                  onChange={(e) => setForm({ ...form, [f.name]: e.target.value })}
                  placeholder={f.placeholder}
                  className={`w-full ${f.icon ? "pl-9" : "pl-3"} pr-3 py-2 bg-background border border-input rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-ring/20 focus:border-ring`}
                />
              </div>
            </div>
          ))}
          <div>
            <label className="mb-1 block text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Stage</label>
            <select
              value={form.stage ?? "cold"}
              onChange={(e) => setForm({ ...form, stage: e.target.value })}
              className="w-full px-3 py-2 bg-background border border-input rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-ring/20"
            >
              {STAGES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Notes</label>
            <textarea
              value={form.notes ?? ""}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
              rows={3}
              placeholder="Conversation context, next steps, follow-up dates…"
              className="w-full px-3 py-2 bg-background border border-input rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-ring/20 focus:border-ring leading-relaxed"
            />
          </div>
        </div>
        <footer className="flex items-center justify-between gap-2 border-t border-border px-6 py-3 bg-muted/30">
          {isEdit && form.linkedinUrl && (
            <a href={form.linkedinUrl} target="_blank" rel="noreferrer"
              className="inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-3 py-1.5 text-xs font-medium text-blue-700 hover:bg-blue-50">
              <Linkedin className="h-3 w-3" /> Open in LinkedIn <ExternalLink className="h-3 w-3" />
            </a>
          )}
          <div className="ml-auto flex gap-2">
            <button onClick={onCancel} disabled={saving}
              className="rounded-md border border-border bg-background px-3 py-1.5 text-xs font-medium text-foreground hover:bg-muted">
              Cancel
            </button>
            <button onClick={() => onSave(form)} disabled={saving || !(form.companyName ?? "").trim()}
              className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50">
              {saving ? "Saving…" : (isEdit ? "Save changes" : "Add Lead")}
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}
