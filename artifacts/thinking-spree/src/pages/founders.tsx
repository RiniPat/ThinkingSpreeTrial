import { useState } from "react";
import { useListFounders, useCreateFounder, useDeleteFounder, getListFoundersQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Layout } from "@/components/Layout";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { Plus, Search, Trash2, ExternalLink, Building2, Mail, X } from "lucide-react";

function AddFounderModal({ onClose }: { onClose: () => void }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const createFounder = useCreateFounder();
  const [form, setForm] = useState({ name: "", email: "", companyName: "", sector: "", acceleratorProgram: "", thinkingSheetUrl: "" });

  function handleChange(k: string, v: string) { setForm(f => ({ ...f, [k]: v })); }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    createFounder.mutate({ data: form }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListFoundersQueryKey() });
        toast({ title: "Founder added" });
        onClose();
      },
      onError: (err: unknown) => {
        toast({ title: "Error", description: err instanceof Error ? err.message : "Failed to add founder", variant: "destructive" });
      },
    });
  }

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
      <div className="bg-card border border-card-border rounded-xl shadow-2xl w-full max-w-md">
        <div className="flex items-center justify-between p-6 border-b border-border">
          <h2 className="font-semibold text-foreground">Add Founder</h2>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground"><X size={18} /></button>
        </div>
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {[
            { key: "name", label: "Founder Name", required: true, placeholder: "John Doe" },
            { key: "email", label: "Email", type: "email", required: true, placeholder: "john@startup.com" },
            { key: "companyName", label: "Company Name", required: true, placeholder: "Acme Inc." },
            { key: "sector", label: "Sector", placeholder: "Fintech, SaaS, etc." },
            { key: "acceleratorProgram", label: "Accelerator Program", placeholder: "YC, Sequoia, etc." },
            { key: "thinkingSheetUrl", label: "Thinking Sheet URL", placeholder: "https://docs.google.com/..." },
          ].map(({ key, label, required, placeholder, type }) => (
            <div key={key}>
              <label className="block text-xs font-medium text-muted-foreground mb-1">{label}{required && " *"}</label>
              <input
                data-testid={`input-founder-${key}`}
                type={type ?? "text"}
                required={required}
                value={(form as Record<string, string>)[key]}
                onChange={e => handleChange(key, e.target.value)}
                placeholder={placeholder}
                className="w-full px-3 py-2 bg-background border border-input rounded-md text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
              />
            </div>
          ))}
          <div className="flex gap-3 pt-2">
            <button type="button" onClick={onClose} className="flex-1 py-2 border border-border rounded-md text-sm font-medium text-muted-foreground hover:bg-muted transition">Cancel</button>
            <button data-testid="button-save-founder" type="submit" disabled={createFounder.isPending} className="flex-1 py-2 bg-primary text-primary-foreground rounded-md text-sm font-medium hover:opacity-90 transition disabled:opacity-50">
              {createFounder.isPending ? "Saving..." : "Add Founder"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default function FoundersPage() {
  const { data: founders, isLoading } = useListFounders();
  const deleteFounder = useDeleteFounder();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [search, setSearch] = useState("");
  const [showAdd, setShowAdd] = useState(false);

  const filtered = founders?.filter(f =>
    f.name.toLowerCase().includes(search.toLowerCase()) ||
    f.companyName.toLowerCase().includes(search.toLowerCase()) ||
    f.email.toLowerCase().includes(search.toLowerCase())
  ) ?? [];

  function handleDelete(id: number, name: string) {
    if (!confirm(`Delete ${name}? This cannot be undone.`)) return;
    deleteFounder.mutate({ id }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListFoundersQueryKey() });
        toast({ title: "Founder deleted" });
      },
      onError: () => toast({ title: "Error", description: "Failed to delete founder", variant: "destructive" }),
    });
  }

  return (
    <Layout>
      <div className="p-6 max-w-5xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-foreground">Founders</h1>
            <p className="text-sm text-muted-foreground mt-0.5">{founders?.length ?? 0} startups registered</p>
          </div>
          <button
            data-testid="button-add-founder"
            onClick={() => setShowAdd(true)}
            className="flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:opacity-90 transition"
          >
            <Plus size={16} />
            Add Founder
          </button>
        </div>

        {/* Search */}
        <div className="relative mb-5">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input
            data-testid="input-search-founders"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search founders, companies..."
            className="w-full pl-9 pr-4 py-2.5 bg-card border border-border rounded-lg text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
          />
        </div>

        {isLoading ? (
          <div className="space-y-3">
            {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-20 rounded-xl" />)}
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-16 bg-card border border-card-border rounded-xl">
            <Building2 size={40} className="mx-auto text-muted-foreground/30 mb-3" />
            <p className="text-muted-foreground font-medium">No founders found</p>
            <p className="text-sm text-muted-foreground/60 mt-1">Add your first founder to get started</p>
          </div>
        ) : (
          <div className="space-y-3">
            {filtered.map(founder => (
              <div key={founder.id} data-testid={`card-founder-${founder.id}`} className="bg-card border border-card-border rounded-xl p-5 hover:border-primary/30 transition-colors">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex items-start gap-4 min-w-0">
                    <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0">
                      <Building2 size={18} className="text-primary" />
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <h3 className="font-semibold text-foreground">{founder.companyName}</h3>
                        {founder.sector && (
                          <span className="text-xs px-2 py-0.5 bg-secondary text-secondary-foreground rounded-full">{founder.sector}</span>
                        )}
                        {founder.acceleratorProgram && (
                          <span className="text-xs px-2 py-0.5 bg-primary/10 text-primary rounded-full">{founder.acceleratorProgram}</span>
                        )}
                      </div>
                      <p className="text-sm text-muted-foreground mt-0.5">{founder.name}</p>
                      <div className="flex items-center gap-1 mt-1">
                        <Mail size={12} className="text-muted-foreground/60" />
                        <span className="text-xs text-muted-foreground">{founder.email}</span>
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    {founder.thinkingSheetUrl && (
                      <a href={founder.thinkingSheetUrl} target="_blank" rel="noreferrer"
                        className="p-2 text-muted-foreground hover:text-primary hover:bg-primary/10 rounded-md transition">
                        <ExternalLink size={15} />
                      </a>
                    )}
                    <button
                      data-testid={`button-delete-founder-${founder.id}`}
                      onClick={() => handleDelete(founder.id, founder.name)}
                      className="p-2 text-muted-foreground hover:text-destructive hover:bg-destructive/10 rounded-md transition"
                    >
                      <Trash2 size={15} />
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
      {showAdd && <AddFounderModal onClose={() => setShowAdd(false)} />}
    </Layout>
  );
}
