/**
 * Inline edit dialog for a company. Used from the Company Detail page.
 *
 * Lets a consultant change the basic fields without going back through the
 * Sheets ingestion flow. Cohort is a typeable input — typing a new name
 * creates the cohort on save (server logic). Existing cohort suggestions
 * come from /api/companies/cohorts.
 */
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react";
import { Loader2, X, Save } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

type Props = {
  companyId: number;
  open: boolean;
  initial: {
    companyName: string;
    founderName: string;
    founderEmail: string | null;
    cohortName: string | null;
    deckUrl: string | null;
    sprintHost: string | null;
    coHost: string | null;
  };
  onClose: () => void;
};

export function EditCompanyDialog({ companyId, open, initial, onClose }: Props) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [form, setForm] = useState({
    companyName: "",
    founderName: "",
    founderEmail: "",
    cohortName: "",
    deckUrl: "",
    sprintHost: "",
    coHost: "",
  });

  // Reset form values when dialog opens with fresh data.
  useEffect(() => {
    if (open) {
      setForm({
        companyName: initial.companyName ?? "",
        founderName: initial.founderName ?? "",
        founderEmail: initial.founderEmail && !initial.founderEmail.includes("@placeholder.local")
          ? initial.founderEmail : "",
        cohortName: initial.cohortName ?? "",
        deckUrl: initial.deckUrl ?? "",
        sprintHost: initial.sprintHost ?? "",
        coHost: initial.coHost ?? "",
      });
    }
  }, [open, initial]);

  // Fetch existing cohort names for the datalist.
  const { data: cohortsData } = useQuery<{ cohorts: { id: number; name: string }[] }>({
    queryKey: ["cohorts"],
    queryFn: () => customFetch(`${BASE}/api/companies/cohorts`, { credentials: "include" }),
    enabled: open,
    staleTime: 60_000,
  });

  const saveMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`${BASE}/api/companies/${companyId}`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      if (!res.ok) {
        const e = await res.json().catch(() => ({}));
        throw new Error(e?.error || `Save failed (${res.status})`);
      }
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Company updated" });
      qc.invalidateQueries({ queryKey: ["company", companyId] });
      qc.invalidateQueries({ queryKey: ["companies"] });
      qc.invalidateQueries({ queryKey: ["cohorts"] });
      onClose();
    },
    onError: (err: any) => toast({ title: "Save failed", description: err.message, variant: "destructive" }),
  });

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: "rgba(15, 23, 42, 0.55)", backdropFilter: "blur(4px)" }}
      onMouseDown={(e) => { if (e.target === e.currentTarget && !saveMutation.isPending) onClose(); }}
    >
      <div className="w-full max-w-xl rounded-xl border border-border bg-card shadow-2xl"
           onMouseDown={(e) => e.stopPropagation()}>
        <header className="flex items-start justify-between gap-4 border-b border-border px-6 py-4">
          <div>
            <h2 className="font-serif text-2xl text-foreground">Edit Company</h2>
            <p className="mt-0.5 text-xs text-muted-foreground">Update the basic fields. Re-sync the Sheet for SWOT/Funding changes.</p>
          </div>
          <button
            onClick={() => !saveMutation.isPending && onClose()}
            className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        <div className="px-6 py-5 space-y-4 max-h-[calc(100vh-14rem)] overflow-y-auto">
          {/* Row 1: Company / Founder Name */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field label="Company Name" required>
              <input
                value={form.companyName}
                onChange={(e) => setForm({ ...form, companyName: e.target.value })}
                className="input"
              />
            </Field>
            <Field label="Founder Name" required>
              <input
                value={form.founderName}
                onChange={(e) => setForm({ ...form, founderName: e.target.value })}
                className="input"
              />
            </Field>
          </div>

          {/* Founder Email */}
          <Field label="Founder Email">
            <input
              type="email"
              value={form.founderEmail}
              onChange={(e) => setForm({ ...form, founderEmail: e.target.value })}
              placeholder="founder@startup.com"
              className="input"
            />
          </Field>

          {/* Cohort with datalist */}
          <Field label="Cohort">
            <input
              list="cohorts-list"
              value={form.cohortName}
              onChange={(e) => setForm({ ...form, cohortName: e.target.value })}
              placeholder="ISB i-Venture, JU IIIDEA Lab, Wadhwani, Ashoka, or any name"
              className="input"
            />
            <datalist id="cohorts-list">
              {cohortsData?.cohorts?.map(c => (
                <option key={c.id} value={c.name} />
              ))}
            </datalist>
            <p className="mt-1 text-[11px] text-muted-foreground">
              Type any cohort name. New cohorts are created automatically on save.
            </p>
          </Field>

          {/* Deck URL */}
          <Field label="Deck URL">
            <input
              type="url"
              value={form.deckUrl}
              onChange={(e) => setForm({ ...form, deckUrl: e.target.value })}
              placeholder="https://drive.google.com/..."
              className="input"
            />
          </Field>

          {/* Row 2: Host + Co-Host */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field label="Sprint Host">
              <input
                value={form.sprintHost}
                onChange={(e) => setForm({ ...form, sprintHost: e.target.value })}
                placeholder="e.g. Priya Sharma"
                className="input"
              />
            </Field>
            <Field label="Co-Host">
              <input
                value={form.coHost}
                onChange={(e) => setForm({ ...form, coHost: e.target.value })}
                placeholder="e.g. Aman Gupta"
                className="input"
              />
            </Field>
          </div>
        </div>

        <footer className="flex items-center justify-end gap-2 border-t border-border px-6 py-3 bg-muted/30">
          <button
            onClick={() => !saveMutation.isPending && onClose()}
            disabled={saveMutation.isPending}
            className="rounded-md border border-border bg-background px-3 py-1.5 text-xs font-medium text-foreground hover:bg-muted disabled:opacity-60"
          >
            Cancel
          </button>
          <button
            onClick={() => saveMutation.mutate()}
            disabled={saveMutation.isPending || !form.companyName.trim() || !form.founderName.trim()}
            className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
          >
            {saveMutation.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
            Save changes
          </button>
        </footer>
      </div>

      {/* tiny utility CSS scoped here — `.input` keeps the markup readable */}
      <style>{`
        .input {
          width: 100%;
          padding: 0.5rem 0.75rem;
          background: hsl(var(--background));
          border: 1px solid hsl(var(--input));
          border-radius: 0.375rem;
          font-size: 0.875rem;
          color: hsl(var(--foreground));
          outline: none;
        }
        .input:focus {
          border-color: hsl(var(--ring));
          box-shadow: 0 0 0 3px hsl(var(--ring) / 0.2);
        }
      `}</style>
    </div>
  );
}

function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <div>
      <label className="mb-1.5 block text-xs font-medium uppercase tracking-wider text-muted-foreground">
        {label}{required && <span className="text-destructive ml-0.5">*</span>}
      </label>
      {children}
    </div>
  );
}
