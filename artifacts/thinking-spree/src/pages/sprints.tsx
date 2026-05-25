import { useState } from "react";
import { useListSprints, useCreateSprint, useListFounders, getListSprintsQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Layout } from "@/components/Layout";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { Plus, Zap, Calendar, User, X, ChevronRight } from "lucide-react";

function AddSprintModal({ onClose }: { onClose: () => void }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { data: founders } = useListFounders();
  const createSprint = useCreateSprint();
  const [form, setForm] = useState({ founderId: "", scheduledDate: "", scheduledTime: "", consultantName: "Pritesh Yeole", meetLink: "" });

  function handleChange(k: string, v: string) { setForm(f => ({ ...f, [k]: v })); }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.founderId) { toast({ title: "Select a founder", variant: "destructive" }); return; }
    createSprint.mutate({ data: { founderId: parseInt(form.founderId), scheduledDate: form.scheduledDate, scheduledTime: form.scheduledTime || undefined, consultantName: form.consultantName, meetLink: form.meetLink || undefined } }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListSprintsQueryKey() });
        toast({ title: "T-Sprint created" });
        onClose();
      },
      onError: (err: unknown) => toast({ title: "Error", description: err instanceof Error ? err.message : "Failed", variant: "destructive" }),
    });
  }

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
      <div className="bg-card border border-card-border rounded-xl shadow-2xl w-full max-w-md">
        <div className="flex items-center justify-between p-6 border-b border-border">
          <h2 className="font-semibold text-foreground">New T-Sprint</h2>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground"><X size={18} /></button>
        </div>
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1">Founder *</label>
            <select
              data-testid="select-founder"
              required
              value={form.founderId}
              onChange={e => handleChange("founderId", e.target.value)}
              className="w-full px-3 py-2 bg-background border border-input rounded-md text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
            >
              <option value="">Select founder...</option>
              {founders?.map(f => (
                <option key={f.id} value={f.id}>{f.name} — {f.companyName}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1">Date *</label>
            <input data-testid="input-sprint-date" type="date" required value={form.scheduledDate} onChange={e => handleChange("scheduledDate", e.target.value)}
              className="w-full px-3 py-2 bg-background border border-input rounded-md text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring" />
          </div>
          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1">Time</label>
            <input data-testid="input-sprint-time" type="time" value={form.scheduledTime} onChange={e => handleChange("scheduledTime", e.target.value)}
              className="w-full px-3 py-2 bg-background border border-input rounded-md text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring" />
          </div>
          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1">Consultant Name *</label>
            <input data-testid="input-consultant" type="text" required value={form.consultantName} onChange={e => handleChange("consultantName", e.target.value)}
              className="w-full px-3 py-2 bg-background border border-input rounded-md text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring" />
          </div>
          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1">Meet Link</label>
            <input data-testid="input-meet-link" type="url" value={form.meetLink} onChange={e => handleChange("meetLink", e.target.value)}
              placeholder="https://meet.google.com/..."
              className="w-full px-3 py-2 bg-background border border-input rounded-md text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring" />
          </div>
          <div className="flex gap-3 pt-2">
            <button type="button" onClick={onClose} className="flex-1 py-2 border border-border rounded-md text-sm font-medium text-muted-foreground hover:bg-muted transition">Cancel</button>
            <button data-testid="button-save-sprint" type="submit" disabled={createSprint.isPending}
              className="flex-1 py-2 bg-primary text-primary-foreground rounded-md text-sm font-medium hover:opacity-90 transition disabled:opacity-50">
              {createSprint.isPending ? "Creating..." : "Create Sprint"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default function SprintsPage() {
  const { data: sprints, isLoading } = useListSprints();
  const [, setLocation] = useLocation();
  const [showAdd, setShowAdd] = useState(false);
  const [filter, setFilter] = useState<"all" | "scheduled" | "completed" | "cancelled">("all");

  const filtered = sprints?.filter(s => filter === "all" || s.status === filter) ?? [];

  const statusColor = (status: string) => {
    if (status === "completed") return "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400";
    if (status === "cancelled") return "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400";
    return "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400";
  };

  return (
    <Layout>
      <div className="p-6 max-w-5xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-foreground">T-Sprints</h1>
            <p className="text-sm text-muted-foreground mt-0.5">{sprints?.length ?? 0} sessions total</p>
          </div>
          <button data-testid="button-add-sprint" onClick={() => setShowAdd(true)}
            className="flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:opacity-90 transition">
            <Plus size={16} />
            New Sprint
          </button>
        </div>

        {/* Filter tabs */}
        <div className="flex gap-1 mb-5 bg-muted p-1 rounded-lg w-fit">
          {(["all", "scheduled", "completed", "cancelled"] as const).map(f => (
            <button key={f} data-testid={`filter-${f}`} onClick={() => setFilter(f)}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition capitalize ${filter === f ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}>
              {f}
            </button>
          ))}
        </div>

        {isLoading ? (
          <div className="space-y-3">
            {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-20 rounded-xl" />)}
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-16 bg-card border border-card-border rounded-xl">
            <Zap size={40} className="mx-auto text-muted-foreground/30 mb-3" />
            <p className="text-muted-foreground font-medium">No T-Sprints found</p>
          </div>
        ) : (
          <div className="space-y-3">
            {filtered.map(sprint => (
              <div key={sprint.id} data-testid={`row-sprint-${sprint.id}`}
                onClick={() => setLocation(`/sprints/${sprint.id}`)}
                className="bg-card border border-card-border rounded-xl p-5 hover:border-primary/30 transition-colors cursor-pointer group">
                <div className="flex items-center justify-between gap-4">
                  <div className="flex items-center gap-4 min-w-0">
                    <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0">
                      <Zap size={18} className="text-primary" />
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <h3 className="font-semibold text-foreground">{sprint.companyName}</h3>
                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${statusColor(sprint.status)}`}>{sprint.status}</span>
                      </div>
                      <div className="flex items-center gap-3 mt-0.5 text-sm text-muted-foreground">
                        <span className="flex items-center gap-1"><User size={12} />{sprint.founderName}</span>
                        <span className="flex items-center gap-1"><Calendar size={12} />{sprint.scheduledDate}</span>
                      </div>
                    </div>
                  </div>
                  <ChevronRight size={16} className="text-muted-foreground group-hover:text-primary transition-colors flex-shrink-0" />
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
      {showAdd && <AddSprintModal onClose={() => setShowAdd(false)} />}
    </Layout>
  );
}
