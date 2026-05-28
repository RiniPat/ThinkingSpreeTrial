import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react";
import { Layout } from "@/components/Layout";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { Plus, Trash2, ExternalLink, Linkedin, Mail, X } from "lucide-react";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

const STAGES = [
  { value: "cold",            label: "Cold",           color: "bg-slate-100 text-slate-700 border-slate-200" },
  { value: "contacted",       label: "Contacted",      color: "bg-blue-50 text-blue-700 border-blue-200" },
  { value: "meeting_booked",  label: "Meeting Booked", color: "bg-amber-50 text-amber-800 border-amber-200" },
  { value: "proposal_sent",   label: "Proposal Sent",  color: "bg-violet-50 text-violet-800 border-violet-200" },
  { value: "won",             label: "Won",            color: "bg-emerald-50 text-emerald-700 border-emerald-200" },
  { value: "lost",            label: "Lost",           color: "bg-rose-50 text-rose-700 border-rose-200" },
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

export default function SalesLeadsPage() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [openCreate, setOpenCreate] = useState(false);
  const [stageFilter, setStageFilter] = useState<string>("all");
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

  const filteredLeads = useMemo(() => {
    const leads = data?.leads ?? [];
    if (stageFilter === "all") return leads;
    return leads.filter(l => l.stage === stageFilter);
  }, [data, stageFilter]);

  const stageCounts = useMemo(() => {
    const counts: Record<string, number> = { all: 0 };
    for (const s of STAGES) counts[s.value] = 0;
    for (const l of data?.leads ?? []) {
      counts.all++;
      counts[l.stage] = (counts[l.stage] ?? 0) + 1;
    }
    return counts;
  }, [data]);

  return (
    <Layout>
      <main className="flex-1 space-y-6 px-6 py-8 lg:px-10 max-w-[1400px] mx-auto">
        <section className="flex items-end justify-between gap-4 flex-wrap">
          <div>
            <div className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Workspace</div>
            <h1 className="mt-2 font-serif text-4xl text-foreground">Sales Leads</h1>
            <p className="mt-1 text-sm text-muted-foreground">CRM-lite pipeline tracker for prospects.</p>
          </div>
          <button
            onClick={() => { setOpenCreate(true); setNewLead({ stage: "cold" }); }}
            className="inline-flex items-center gap-2 rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:opacity-90"
          >
            <Plus className="h-4 w-4" /> Add Lead
          </button>
        </section>

        {/* Stage filter chips */}
        <div className="flex items-center gap-2 flex-wrap">
          <button
            onClick={() => setStageFilter("all")}
            className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium ${stageFilter === "all" ? "bg-primary text-primary-foreground border-primary" : "bg-card text-foreground border-border hover:bg-muted"}`}
          >
            All <span className="text-[10px] opacity-70">{stageCounts.all}</span>
          </button>
          {STAGES.map(s => (
            <button
              key={s.value}
              onClick={() => setStageFilter(s.value)}
              className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium ${stageFilter === s.value ? "bg-primary text-primary-foreground border-primary" : `${s.color} hover:opacity-80`}`}
            >
              {s.label} <span className="text-[10px] opacity-70">{stageCounts[s.value] ?? 0}</span>
            </button>
          ))}
        </div>

        {/* Leads table */}
        <section className="rounded-xl border border-border bg-card overflow-hidden">
          {isLoading ? (
            <div className="p-5 space-y-2">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-12 rounded" />)}</div>
          ) : filteredLeads.length === 0 ? (
            <div className="p-10 text-center text-sm text-muted-foreground">
              {stageFilter === "all" ? "No leads yet — click Add Lead to start." : "No leads in this stage."}
            </div>
          ) : (
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
                  {filteredLeads.map(l => (
                    <tr key={l.id} className="border-t border-border hover:bg-muted/20">
                      <td className="px-4 py-3">
                        <button onClick={() => setEditingLead(l)} className="text-left">
                          <div className="font-medium text-foreground">{l.companyName}</div>
                          {l.notes && <div className="text-[11px] text-muted-foreground truncate max-w-xs">{l.notes}</div>}
                        </button>
                      </td>
                      <td className="px-4 py-3">
                        {l.contactName ? (
                          <>
                            <div className="text-foreground">{l.contactName}</div>
                            <div className="text-[11px] text-muted-foreground">{l.contactRole}</div>
                          </>
                        ) : <span className="text-muted-foreground italic">—</span>}
                      </td>
                      <td className="px-4 py-3">
                        <select
                          value={l.stage}
                          onChange={(e) => updateMutation.mutate({ id: l.id, patch: { stage: e.target.value } })}
                          className="text-xs bg-background border border-input rounded px-2 py-1"
                        >
                          {STAGES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
                        </select>
                      </td>
                      <td className="px-4 py-3 text-xs text-muted-foreground">{l.source ?? "—"}</td>
                      <td className="px-4 py-3 text-right">
                        <div className="inline-flex items-center gap-1.5">
                          {l.linkedinUrl && <a href={l.linkedinUrl} target="_blank" rel="noreferrer" className="rounded p-1 text-muted-foreground hover:text-foreground" title="LinkedIn"><Linkedin className="h-3.5 w-3.5" /></a>}
                          {l.contactEmail && <a href={`mailto:${l.contactEmail}`} className="rounded p-1 text-muted-foreground hover:text-foreground" title="Email"><Mail className="h-3.5 w-3.5" /></a>}
                          <button onClick={() => { if (confirm(`Delete ${l.companyName}?`)) deleteMutation.mutate(l.id); }}
                            className="rounded p-1 text-muted-foreground hover:bg-destructive/10 hover:text-destructive" title="Delete">
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {/* Create modal */}
        {openCreate && (
          <LeadForm
            initial={newLead}
            onCancel={() => setOpenCreate(false)}
            onSave={(lead) => createMutation.mutate(lead)}
            saving={createMutation.isPending}
          />
        )}

        {/* Edit modal */}
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

        <footer className="pt-2 text-center text-xs text-muted-foreground">Thinking Spree · Consultant Suite v5.0</footer>
      </main>
    </Layout>
  );
}

function LeadForm({ initial, onCancel, onSave, saving, isEdit }: {
  initial: Partial<Lead>; onCancel: () => void; onSave: (l: Partial<Lead>) => void; saving: boolean; isEdit?: boolean;
}) {
  const [form, setForm] = useState<Partial<Lead>>(initial);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
         style={{ background: "rgba(15,23,42,.55)", backdropFilter: "blur(4px)" }}
         onMouseDown={(e) => { if (e.target === e.currentTarget) onCancel(); }}>
      <div className="w-full max-w-xl rounded-xl border border-border bg-card shadow-2xl" onMouseDown={(e) => e.stopPropagation()}>
        <header className="flex items-center justify-between border-b border-border px-6 py-4">
          <h2 className="font-serif text-2xl text-foreground">{isEdit ? "Edit Lead" : "Add Lead"}</h2>
          <button onClick={onCancel} className="rounded-md p-1.5 text-muted-foreground hover:bg-muted"><X className="h-4 w-4" /></button>
        </header>
        <div className="p-6 space-y-3 max-h-[calc(100vh-14rem)] overflow-y-auto">
          {[
            { name: "companyName",  label: "Company Name",   required: true },
            { name: "contactName",  label: "Contact Name",   required: false },
            { name: "contactRole",  label: "Contact Role",   required: false },
            { name: "contactEmail", label: "Contact Email",  required: false, type: "email" },
            { name: "linkedinUrl",  label: "LinkedIn URL",   required: false, type: "url" },
            { name: "source",       label: "Source",         required: false, placeholder: "e.g. inbound, referral, event" },
          ].map(f => (
            <div key={f.name}>
              <label className="mb-1 block text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                {f.label}{f.required && <span className="text-destructive ml-0.5">*</span>}
              </label>
              <input
                type={f.type ?? "text"}
                value={(form as any)[f.name] ?? ""}
                onChange={(e) => setForm({ ...form, [f.name]: e.target.value })}
                placeholder={f.placeholder}
                className="w-full px-3 py-2 bg-background border border-input rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-ring/20 focus:border-ring"
              />
            </div>
          ))}
          <div>
            <label className="mb-1 block text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Stage</label>
            <select
              value={form.stage ?? "cold"}
              onChange={(e) => setForm({ ...form, stage: e.target.value })}
              className="w-full px-3 py-2 bg-background border border-input rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-ring/20 focus:border-ring"
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
              className="w-full px-3 py-2 bg-background border border-input rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-ring/20 focus:border-ring"
            />
          </div>
        </div>
        <footer className="flex justify-end gap-2 border-t border-border px-6 py-3 bg-muted/30">
          <button onClick={onCancel} className="rounded-md border border-border bg-background px-3 py-1.5 text-xs font-medium text-foreground hover:bg-muted">Cancel</button>
          <button onClick={() => onSave(form)} disabled={saving || !(form.companyName ?? "").trim()}
            className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50">
            {saving ? "Saving…" : (isEdit ? "Save changes" : "Add Lead")}
          </button>
        </footer>
      </div>
    </div>
  );
}
