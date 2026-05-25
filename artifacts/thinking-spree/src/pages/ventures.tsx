import { useState } from "react";
import { useListFounders, useCreateFounder, useDeleteFounder, useListIncubators, getListFoundersQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Layout } from "@/components/Layout";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { Plus, Search, Trash2, ExternalLink, Briefcase, Mail, X, Building2 } from "lucide-react";

function AddVentureModal({ onClose }: { onClose: () => void }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { data: incubators } = useListIncubators();
  const createFounder = useCreateFounder();
  const [form, setForm] = useState({
    name: "", email: "", companyName: "", sector: "", stage: "",
    description: "", acceleratorProgram: "", thinkingSheetUrl: "", incubatorId: "",
  });

  function handleChange(k: string, v: string) { setForm(f => ({ ...f, [k]: v })); }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    createFounder.mutate({
      data: {
        ...form,
        incubatorId: form.incubatorId ? parseInt(form.incubatorId) : undefined,
      }
    }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListFoundersQueryKey() });
        toast({ title: "Venture added" });
        onClose();
      },
      onError: (err: unknown) => toast({ title: "Error", description: err instanceof Error ? err.message : "Failed", variant: "destructive" }),
    });
  }

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
      <div className="bg-card border border-card-border rounded-xl shadow-2xl w-full max-w-lg max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between p-6 border-b border-border flex-shrink-0">
          <h2 className="font-semibold text-foreground">Add Venture</h2>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground"><X size={18} /></button>
        </div>
        <form onSubmit={handleSubmit} className="p-6 space-y-4 overflow-y-auto flex-1">
          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1">Incubator / Program</label>
            <select value={form.incubatorId} onChange={e => handleChange("incubatorId", e.target.value)}
              className="w-full px-3 py-2 bg-background border border-input rounded-md text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring">
              <option value="">No incubator (standalone)</option>
              {incubators?.map(i => <option key={i.id} value={i.id}>{i.name}</option>)}
            </select>
          </div>
          {[
            { key: "name", label: "Founder Name", required: true, placeholder: "Jane Doe" },
            { key: "email", label: "Email", type: "email", required: true, placeholder: "jane@startup.com" },
            { key: "companyName", label: "Company Name", required: true, placeholder: "Acme Inc." },
            { key: "sector", label: "Sector", placeholder: "Fintech, SaaS, etc." },
            { key: "stage", label: "Stage", placeholder: "Ideation, MVP, Growth..." },
            { key: "description", label: "Short Description", placeholder: "One-line pitch..." },
            { key: "acceleratorProgram", label: "Accelerator", placeholder: "YC, NSRCEL, etc." },
            { key: "thinkingSheetUrl", label: "Sheet URL", placeholder: "https://docs.google.com/..." },
          ].map(({ key, label, required, placeholder, type }) => (
            <div key={key}>
              <label className="block text-xs font-medium text-muted-foreground mb-1">{label}{required && " *"}</label>
              <input type={type ?? "text"} required={required} value={(form as Record<string, string>)[key]}
                onChange={e => handleChange(key, e.target.value)} placeholder={placeholder}
                className="w-full px-3 py-2 bg-background border border-input rounded-md text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring" />
            </div>
          ))}
          <div className="flex gap-3 pt-2">
            <button type="button" onClick={onClose} className="flex-1 py-2 border border-border rounded-md text-sm font-medium text-muted-foreground hover:bg-muted transition">Cancel</button>
            <button type="submit" disabled={createFounder.isPending}
              className="flex-1 py-2 bg-primary text-primary-foreground rounded-md text-sm font-medium hover:opacity-90 transition disabled:opacity-50">
              {createFounder.isPending ? "Saving..." : "Add Venture"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default function VenturesPage() {
  const { data: founders, isLoading } = useListFounders();
  const { data: incubators } = useListIncubators();
  const deleteFounder = useDeleteFounder();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [search, setSearch] = useState("");
  const [filterIncubator, setFilterIncubator] = useState("all");
  const [showAdd, setShowAdd] = useState(false);

  const incubatorMap = Object.fromEntries(incubators?.map(i => [i.id, i.name]) ?? []);

  const filtered = founders?.filter(f => {
    const matchSearch = !search ||
      f.name.toLowerCase().includes(search.toLowerCase()) ||
      f.companyName.toLowerCase().includes(search.toLowerCase()) ||
      f.email.toLowerCase().includes(search.toLowerCase());
    const matchIncubator = filterIncubator === "all" ||
      (filterIncubator === "none" && !f.incubatorId) ||
      String(f.incubatorId) === filterIncubator;
    return matchSearch && matchIncubator;
  }) ?? [];

  function handleDelete(id: number, name: string) {
    if (!confirm(`Delete ${name}? This cannot be undone.`)) return;
    deleteFounder.mutate({ id }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListFoundersQueryKey() });
        toast({ title: "Venture deleted" });
      },
      onError: () => toast({ title: "Error deleting venture", variant: "destructive" }),
    });
  }

  return (
    <Layout>
      <div className="p-6 max-w-5xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-foreground">Ventures</h1>
            <p className="text-sm text-muted-foreground mt-0.5">{founders?.length ?? 0} startups registered</p>
          </div>
          <button onClick={() => setShowAdd(true)}
            className="flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:opacity-90 transition">
            <Plus size={16} />Add Venture
          </button>
        </div>

        <div className="flex gap-3 mb-5">
          <div className="relative flex-1">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <input value={search} onChange={e => setSearch(e.target.value)}
              placeholder="Search ventures..."
              className="w-full pl-9 pr-4 py-2.5 bg-card border border-border rounded-lg text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring" />
          </div>
          <select value={filterIncubator} onChange={e => setFilterIncubator(e.target.value)}
            className="px-3 py-2.5 bg-card border border-border rounded-lg text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring">
            <option value="all">All Programs</option>
            <option value="none">No Program</option>
            {incubators?.map(i => <option key={i.id} value={i.id}>{i.name}</option>)}
          </select>
        </div>

        {isLoading ? (
          <div className="space-y-3">{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-20 rounded-xl" />)}</div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-16 bg-card border border-card-border rounded-xl">
            <Briefcase size={40} className="mx-auto text-muted-foreground/30 mb-3" />
            <p className="text-muted-foreground font-medium">No ventures found</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {filtered.map(founder => (
              <div key={founder.id} className="bg-card border border-card-border rounded-xl p-5 hover:border-primary/30 transition-colors">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-start gap-3 min-w-0">
                    <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0">
                      <Building2 size={18} className="text-primary" />
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <h3 className="font-semibold text-foreground">{founder.companyName}</h3>
                        {founder.sector && <span className="text-xs px-2 py-0.5 bg-secondary text-secondary-foreground rounded-full">{founder.sector}</span>}
                        {founder.stage && <span className="text-xs px-2 py-0.5 bg-primary/10 text-primary rounded-full">{founder.stage}</span>}
                      </div>
                      {founder.description && <p className="text-xs text-muted-foreground mt-0.5 line-clamp-1">{founder.description}</p>}
                      <p className="text-sm text-muted-foreground mt-1">{founder.name}</p>
                      <div className="flex items-center gap-1 mt-0.5">
                        <Mail size={11} className="text-muted-foreground/60" />
                        <span className="text-xs text-muted-foreground">{founder.email}</span>
                      </div>
                      {founder.incubatorId && incubatorMap[founder.incubatorId] && (
                        <span className="inline-flex items-center gap-1 mt-1.5 text-xs text-violet-600 dark:text-violet-400 bg-violet-100 dark:bg-violet-900/30 px-2 py-0.5 rounded-full">
                          <Briefcase size={10} />{incubatorMap[founder.incubatorId]}
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-1 flex-shrink-0">
                    {founder.thinkingSheetUrl && (
                      <a href={founder.thinkingSheetUrl} target="_blank" rel="noreferrer"
                        className="p-2 text-muted-foreground hover:text-primary hover:bg-primary/10 rounded-md transition">
                        <ExternalLink size={14} />
                      </a>
                    )}
                    <button onClick={() => handleDelete(founder.id, founder.name)}
                      className="p-2 text-muted-foreground hover:text-destructive hover:bg-destructive/10 rounded-md transition">
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
      {showAdd && <AddVentureModal onClose={() => setShowAdd(false)} />}
    </Layout>
  );
}
