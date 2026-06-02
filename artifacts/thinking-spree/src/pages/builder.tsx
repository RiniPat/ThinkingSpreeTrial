import { useEffect, useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react";
import { Layout } from "@/components/Layout";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import {
  FileText, Upload, Sparkles, Loader2, Download, ChevronRight, ArrowLeft,
  CheckCircle2, AlertCircle, Trash2, FileEdit, Wand2, Plus, X,
} from "lucide-react";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

// ───────────────────────── Types (mirror backend) ────────────────────────
type RAG = "RED" | "AMBER" | "GREEN" | "";
type ExistingOrNew = "Existing" | "New" | "Not stated.";

type StreamAnchor = { rag: RAG; supportNeed: string };
type Anchors = {
  primaryProduct: string; primaryCustomer: string; primaryGeography: string;
  currentScale: string; coreBusinessModel: string;
  growthProduct: string; growthCustomer: string; growthGeography: string;
  growthProductIsNew: ExistingOrNew;
  growthCustomerIsNew: ExistingOrNew;
  growthGeographyIsNew: ExistingOrNew;
  gtm: StreamAnchor; product: StreamAnchor; operations: StreamAnchor;
  supplyChain: StreamAnchor; peopleHr: StreamAnchor; finance: StreamAnchor;
  primarySprintStream: string;
  risk: string; bottleneck: string; scalability: string;
};

type ListItem = {
  id: number; startupName: string; cohort: string | null;
  status: "drafting" | "anchors_ready" | "report_ready" | "failed";
  numSprints: number; createdAt: string; updatedAt: string;
};

type FullReport = {
  id: number; startupName: string; cohort: string | null;
  tsheetLink: string; status: ListItem["status"]; errorMessage: string | null;
  numSprints: number; anchors: Anchors | null; report: any; hasDocx: boolean;
  createdAt: string; updatedAt: string;
};

// ───────────────────────── Main page ─────────────────────────────────────
type Mode = "growth_report" | "summary";

export default function BuilderPage() {
  // Mode toggle: Growth Report (Phase A) vs Wadhwani Summary (Phase B).
  // Each mode tracks its own active item + create-flag so switching tabs
  // doesn't dump state.
  const [mode, setMode] = useState<Mode>("growth_report");
  const [activeId, setActiveId] = useState<number | null>(null);
  const [creatingNew, setCreatingNew] = useState(false);
  const [summaryActiveId, setSummaryActiveId] = useState<number | null>(null);
  const [summaryCreatingNew, setSummaryCreatingNew] = useState(false);

  return (
    <Layout>
      <main className="flex-1 space-y-6 px-6 py-8 lg:px-10 max-w-[1400px] mx-auto">
        <header>
          <div className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Workspace</div>
          <h1 className="mt-2 font-serif text-4xl text-foreground">Builder</h1>
          <p className="mt-1 text-sm text-muted-foreground max-w-2xl">
            Generate downloadable artefacts: Growth Reports as branded .docx files; Summary entries
            for cohort dashboards. Pick a mode below.
          </p>
        </header>

        {/* Mode toggle */}
        <div className="inline-flex rounded-md border border-border bg-card overflow-hidden text-sm">
          <button
            onClick={() => setMode("growth_report")}
            className={`px-4 py-2 font-medium transition ${mode === "growth_report" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted"}`}
          >
            Growth Report
          </button>
          <button
            onClick={() => setMode("summary")}
            className={`px-4 py-2 font-medium transition ${mode === "summary" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted"}`}
          >
            Wadhwani Summary
          </button>
        </div>

        {mode === "growth_report" ? (
          activeId !== null ? (
            <ReportWorkflow id={activeId} onBack={() => setActiveId(null)} />
          ) : creatingNew ? (
            <NewReportForm onCancel={() => setCreatingNew(false)} onCreated={(id) => { setCreatingNew(false); setActiveId(id); }} />
          ) : (
            <ReportLibrary onOpen={setActiveId} onNew={() => setCreatingNew(true)} />
          )
        ) : summaryActiveId !== null ? (
          <SummaryWorkflow id={summaryActiveId} onBack={() => setSummaryActiveId(null)} />
        ) : summaryCreatingNew ? (
          <NewSummaryForm onCancel={() => setSummaryCreatingNew(false)} onCreated={(id) => { setSummaryCreatingNew(false); setSummaryActiveId(id); }} />
        ) : (
          <SummaryLibrary onOpen={setSummaryActiveId} onNew={() => setSummaryCreatingNew(true)} />
        )}

        <footer className="pt-2 text-center text-xs text-muted-foreground">Thinking Spree · Consultant Suite v5.5</footer>
      </main>
    </Layout>
  );
}

// ───────────────────────── Library list ──────────────────────────────────
function ReportLibrary({ onOpen, onNew }: { onOpen: (id: number) => void; onNew: () => void }) {
  const { data, isLoading } = useQuery<{ reports: ListItem[] }>({
    queryKey: ["/api/builder/growth-reports"],
    queryFn: () => customFetch(`${BASE}/api/builder/growth-reports`, { credentials: "include" }),
  });

  // Group by cohort so the consultant can see all Wadhwani / ISB reports together.
  const grouped = useMemo(() => {
    const m = new Map<string, ListItem[]>();
    for (const r of data?.reports ?? []) {
      const key = r.cohort?.trim() || "No cohort";
      if (!m.has(key)) m.set(key, []);
      m.get(key)!.push(r);
    }
    return Array.from(m.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [data]);

  return (
    <section className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <h2 className="font-serif text-2xl text-foreground">Growth Reports</h2>
        <button onClick={onNew}
          className="inline-flex items-center gap-2 rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:opacity-90">
          <Sparkles className="h-4 w-4" /> New Report
        </button>
      </div>

      {isLoading ? (
        <div className="space-y-2">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-16 rounded-lg" />)}</div>
      ) : (data?.reports ?? []).length === 0 ? (
        <div className="rounded-xl border border-dashed border-border bg-card p-10 text-center">
          <div className="mx-auto rounded-full bg-muted/50 p-3 w-fit"><FileText className="h-6 w-6 text-muted-foreground" /></div>
          <h3 className="mt-3 font-serif text-xl text-foreground">No reports yet</h3>
          <p className="mt-1 text-sm text-muted-foreground max-w-md mx-auto">
            Upload a Strategic Canvas + optional Fathom transcripts, edit the extracted anchors,
            and generate a branded growth journey report as a Word document.
          </p>
        </div>
      ) : (
        grouped.map(([cohort, reports]) => (
          <div key={cohort} className="rounded-xl border border-border bg-card overflow-hidden">
            <div className="px-4 py-2 bg-muted/30 border-b border-border text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              {cohort} · {reports.length}
            </div>
            <ul className="divide-y divide-border">
              {reports.map(r => (
                <li key={r.id}>
                  <button onClick={() => onOpen(r.id)} className="w-full flex items-center gap-3 px-4 py-3 hover:bg-muted/30 transition text-left">
                    <FileText className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                    <div className="min-w-0 flex-1">
                      <div className="font-medium text-foreground truncate">{r.startupName}</div>
                      <div className="text-[11px] text-muted-foreground">
                        {r.numSprints} sprint{r.numSprints === 1 ? "" : "s"} · updated {new Date(r.updatedAt).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}
                      </div>
                    </div>
                    <StatusBadge status={r.status} />
                    <ChevronRight className="h-4 w-4 text-muted-foreground" />
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ))
      )}
    </section>
  );
}

function StatusBadge({ status }: { status: ListItem["status"] }) {
  const map: Record<ListItem["status"], { label: string; cls: string }> = {
    drafting:       { label: "Drafting",       cls: "bg-amber-50 text-amber-800 border-amber-200" },
    anchors_ready:  { label: "Anchors Ready",   cls: "bg-blue-50 text-blue-700 border-blue-200" },
    report_ready:   { label: "Report Ready",    cls: "bg-emerald-50 text-emerald-700 border-emerald-200" },
    failed:         { label: "Failed",          cls: "bg-rose-50 text-rose-700 border-rose-200" },
  };
  const m = map[status];
  return <span className={`whitespace-nowrap inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium ${m.cls}`}>{m.label}</span>;
}

// ───────────────────────── New report form (Step 1) ──────────────────────
function NewReportForm({ onCancel, onCreated }: { onCancel: () => void; onCreated: (id: number) => void }) {
  const { toast } = useToast();

  // Persist text-field state to localStorage so switching browser tabs
  // (or closing/reopening the tab) doesn't lose the user's progress.
  // File objects can't be serialized, so they don't persist — we show a
  // small hint on rehydrate if text fields came back but files didn't.
  const STORAGE_KEY = "ts.builder.newReportForm.v2";
  const loadInitial = (): { startupName: string; cohort: string; tsheetLink: string; numSprints: 1 | 2 } => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return { startupName: "", cohort: "", tsheetLink: "", numSprints: 1 };
      const parsed = JSON.parse(raw);
      return {
        startupName: typeof parsed.startupName === "string" ? parsed.startupName : "",
        cohort: typeof parsed.cohort === "string" ? parsed.cohort : "",
        tsheetLink: typeof parsed.tsheetLink === "string" ? parsed.tsheetLink : "",
        numSprints: parsed.numSprints === 2 ? 2 : 1,
      };
    } catch {
      return { startupName: "", cohort: "", tsheetLink: "", numSprints: 1 };
    }
  };
  const [form, setForm] = useState(loadInitial);
  const [canvas, setCanvas] = useState<File | null>(null);
  // Dynamic list of Fathom transcripts — start with one empty slot, user can
  // add as many as they want. Each slot holds a File or null.
  const [fathoms, setFathoms] = useState<Array<File | null>>([null]);
  const [checkin, setCheckin] = useState<File | null>(null);

  // Persist text fields on every change. Wrapped in try/catch in case
  // localStorage is unavailable (private browsing / quota exceeded).
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(form));
    } catch {
      /* ignore */
    }
  }, [form]);

  // Show a one-time hint if we rehydrated text fields but the user will
  // need to re-attach their files. Only shown when there's *something*
  // in the text fields (i.e. rehydrated state, not a fresh form).
  const [hintDismissed, setHintDismissed] = useState(false);
  const hasRehydratedText =
    (form.startupName.trim().length > 0 ||
      form.cohort.trim().length > 0 ||
      form.tsheetLink.trim().length > 0) &&
    !canvas && fathoms.every((f) => !f) && !checkin;

  const submitMutation = useMutation({
    mutationFn: async () => {
      const fd = new FormData();
      fd.append("startup_name", form.startupName);
      if (form.cohort.trim()) fd.append("cohort", form.cohort.trim());
      fd.append("tsheet_link", form.tsheetLink);
      fd.append("num_sprints", String(form.numSprints));
      if (canvas) fd.append("strategic_canvas", canvas);
      // Send every populated Fathom slot. Backend accepts fathom_1, fathom_2, … fathom_N.
      let fathomIdx = 0;
      for (const f of fathoms) {
        if (f) {
          fathomIdx += 1;
          fd.append(`fathom_${fathomIdx}`, f);
        }
      }
      if (checkin) fd.append("checkin", checkin);

      const res = await fetch(`${BASE}/api/builder/growth-reports`, {
        method: "POST", credentials: "include", body: fd,
      });
      if (!res.ok) throw new Error((await res.json()).error || "Upload failed");
      return (await res.json()).report as FullReport;
    },
    onSuccess: (r) => {
      // Clear the saved draft now that we have a real report on the server
      try { localStorage.removeItem(STORAGE_KEY); } catch { /* ignore */ }
      toast({ title: "Files uploaded", description: "Text extracted. Now extract anchors." });
      onCreated(r.id);
    },
    onError: (err: any) => toast({ title: "Upload failed", description: err.message, variant: "destructive" }),
  });

  const canSubmit =
    form.startupName.trim().length > 0 &&
    form.tsheetLink.trim().length > 0 &&
    !!canvas;

  return (
    <section className="space-y-4">
      <button onClick={onCancel} className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4" /> Back to Reports
      </button>

      <div className="rounded-xl border border-border bg-card p-6">
        <h2 className="font-serif text-2xl text-foreground">New Growth Report</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Step 1 of 3: upload source documents. Raw files are extracted to text then discarded.
        </p>

        {hasRehydratedText && !hintDismissed && (
          <div className="mt-4 flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
            <span className="mt-0.5">↩</span>
            <div className="flex-1">
              <p className="font-medium">Restored your previous progress.</p>
              <p className="text-amber-800">Your text fields came back from earlier, but you'll need to re-attach the files.</p>
            </div>
            <button onClick={() => setHintDismissed(true)} className="text-amber-900 hover:underline text-xs">Dismiss</button>
          </div>
        )}

        <div className="mt-5 grid grid-cols-1 md:grid-cols-2 gap-4">
          <Field label="Startup Name" required>
            <input type="text" value={form.startupName} onChange={(e) => setForm({ ...form, startupName: e.target.value })}
              placeholder="e.g. Bull AgriTech"
              className="w-full px-3 py-2 bg-background border border-input rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-ring/20" />
          </Field>
          <Field label="Cohort" hint="Used to group reports in the library">
            <input type="text" value={form.cohort} onChange={(e) => setForm({ ...form, cohort: e.target.value })}
              placeholder="e.g. Wadhwani Foundation"
              className="w-full px-3 py-2 bg-background border border-input rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-ring/20" />
          </Field>
          <Field label="T-Sheet Link" required hint="Google Sheets URL for the Sprint Template">
            <input type="url" value={form.tsheetLink} onChange={(e) => setForm({ ...form, tsheetLink: e.target.value })}
              placeholder="https://docs.google.com/spreadsheets/d/..."
              className="w-full px-3 py-2 bg-background border border-input rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-ring/20" />
          </Field>
          <Field label="Number of Sprints" hint="Informational — affects the report narrative">
            <select value={form.numSprints} onChange={(e) => setForm({ ...form, numSprints: Number(e.target.value) as 1 | 2 })}
              className="w-full px-3 py-2 bg-background border border-input rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-ring/20">
              <option value={1}>1 Sprint</option>
              <option value={2}>2 Sprints</option>
            </select>
          </Field>
        </div>

        <div className="mt-5 space-y-3">
          <FileSlot label="Strategic Canvas" required accept=".pdf"
            hint="PDF only. Text must be selectable (not scanned image)."
            file={canvas} onChange={setCanvas} />
          {fathoms.map((f, idx) => (
            <FileSlot
              key={idx}
              label={`Fathom Transcript ${idx + 1}`}
              accept=".vtt,.srt,.txt,.docx,.md"
              hint={idx === 0
                ? "Optional. .vtt / .srt / .txt / .docx"
                : "Optional. Additional Fathom transcript."}
              file={f}
              onChange={(file) =>
                setFathoms((prev) => prev.map((p, i) => (i === idx ? file : p)))
              }
              onRemove={fathoms.length > 1
                ? () => setFathoms((prev) => prev.filter((_, i) => i !== idx))
                : undefined}
            />
          ))}
          <button
            type="button"
            onClick={() => setFathoms((prev) => [...prev, null])}
            className="inline-flex items-center gap-1.5 rounded-md border border-dashed border-border bg-background px-3 py-1.5 text-sm font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <Plus className="h-3.5 w-3.5" /> Add another Fathom transcript
          </button>
          <FileSlot label="Check-In Call" accept=".vtt,.srt,.txt,.docx,.md"
            hint="Optional. Recent check-in transcript."
            file={checkin} onChange={setCheckin} />
        </div>

        <div className="mt-6 flex items-center justify-end gap-2">
          <button onClick={onCancel} className="rounded-md border border-border bg-background px-3 py-2 text-sm font-medium hover:bg-muted">
            Cancel
          </button>
          <button onClick={() => submitMutation.mutate()} disabled={!canSubmit || submitMutation.isPending}
            className="inline-flex items-center gap-2 rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50">
            {submitMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
            {submitMutation.isPending ? "Uploading…" : "Upload & Continue"}
          </button>
        </div>
      </div>
    </section>
  );
}

function Field({ label, hint, required, children }: { label: string; hint?: string; required?: boolean; children: React.ReactNode }) {
  return (
    <div>
      <label className="mb-1 block text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
        {label}{required && <span className="text-destructive ml-0.5">*</span>}
      </label>
      {children}
      {hint && <p className="mt-1 text-[11px] text-muted-foreground">{hint}</p>}
    </div>
  );
}

function FileSlot({ label, hint, accept, required, file, onChange, onRemove }: {
  label: string; hint?: string; accept: string; required?: boolean;
  file: File | null; onChange: (f: File | null) => void;
  /** If provided, render an X button that removes the whole slot
   *  (not just the file). Used for the dynamic Fathom list — slot 1
   *  doesn't get this since there must always be at least one. */
  onRemove?: () => void;
}) {
  return (
    <div className="rounded-lg border border-dashed border-border bg-background/50 p-3">
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex-1 min-w-0">
          <div className="text-xs font-semibold text-foreground">
            {label}{required && <span className="text-destructive ml-0.5">*</span>}
          </div>
          {hint && <div className="text-[11px] text-muted-foreground">{hint}</div>}
        </div>
        {file ? (
          <div className="flex items-center gap-2">
            <span className="text-[11px] text-emerald-700 inline-flex items-center gap-1">
              <CheckCircle2 className="h-3 w-3" /> {file.name}
            </span>
            <button onClick={() => onChange(null)} className="rounded p-1 text-muted-foreground hover:bg-muted" title="Clear file">
              <Trash2 className="h-3 w-3" />
            </button>
          </div>
        ) : (
          <label className="inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-3 py-1.5 text-xs font-medium hover:bg-muted cursor-pointer">
            <Upload className="h-3 w-3" /> Choose file
            <input type="file" accept={accept} className="hidden"
              onChange={(e) => onChange(e.target.files?.[0] ?? null)} />
          </label>
        )}
        {onRemove && (
          <button onClick={onRemove} className="rounded p-1 text-muted-foreground hover:bg-destructive/10 hover:text-destructive" title="Remove this slot">
            <X className="h-3 w-3" />
          </button>
        )}
      </div>
    </div>
  );
}

// ───────────────────────── Report workflow (steps 2 & 3) ─────────────────
function ReportWorkflow({ id, onBack }: { id: number; onBack: () => void }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const { data, isLoading } = useQuery<{ report: FullReport }>({
    queryKey: ["/api/builder/growth-reports", id],
    queryFn: () => customFetch(`${BASE}/api/builder/growth-reports/${id}`, { credentials: "include" }),
    refetchOnWindowFocus: false,
  });
  const r = data?.report;

  // Anchor extraction (Prompt 1)
  const extractMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`${BASE}/api/builder/growth-reports/${id}/extract-anchors`, {
        method: "POST", credentials: "include",
      });
      if (!res.ok) throw new Error((await res.json()).error || "Extraction failed");
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Anchors extracted", description: "Review and edit before generating the full report." });
      qc.invalidateQueries({ queryKey: ["/api/builder/growth-reports", id] });
      qc.invalidateQueries({ queryKey: ["/api/builder/growth-reports"] });
    },
    onError: (err: any) => toast({ title: "Extraction failed", description: err.message, variant: "destructive" }),
  });

  // Local editable copy of anchors. Initialised from server data the first
  // time it arrives; consultant edits stay local until Save or Generate.
  const [draftAnchors, setDraftAnchors] = useState<Anchors | null>(null);
  useEffect(() => {
    if (r?.anchors && draftAnchors === null) setDraftAnchors(r.anchors);
  }, [r?.anchors, draftAnchors]);

  const saveAnchorsMutation = useMutation({
    mutationFn: async (anchors: Anchors) => {
      const res = await fetch(`${BASE}/api/builder/growth-reports/${id}/anchors`, {
        method: "PATCH", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ anchors }),
      });
      if (!res.ok) throw new Error((await res.json()).error || "Save failed");
    },
    onSuccess: () => toast({ title: "Anchors saved" }),
    onError: (err: any) => toast({ title: "Save failed", description: err.message, variant: "destructive" }),
  });

  // Final report generation (Prompt 2 + DOCX)
  const generateMutation = useMutation({
    mutationFn: async () => {
      // Always save the current draft anchors before generating
      if (draftAnchors) {
        await fetch(`${BASE}/api/builder/growth-reports/${id}/anchors`, {
          method: "PATCH", credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ anchors: draftAnchors }),
        });
      }
      const res = await fetch(`${BASE}/api/builder/growth-reports/${id}/generate-report`, {
        method: "POST", credentials: "include",
      });
      if (!res.ok) throw new Error((await res.json()).error || "Generation failed");
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Report generated", description: "Download the DOCX from the action bar." });
      qc.invalidateQueries({ queryKey: ["/api/builder/growth-reports", id] });
      qc.invalidateQueries({ queryKey: ["/api/builder/growth-reports"] });
    },
    onError: (err: any) => toast({ title: "Generation failed", description: err.message, variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`${BASE}/api/builder/growth-reports/${id}`, { method: "DELETE", credentials: "include" });
      if (!res.ok) throw new Error("Delete failed");
    },
    onSuccess: () => { toast({ title: "Deleted" }); qc.invalidateQueries({ queryKey: ["/api/builder/growth-reports"] }); onBack(); },
  });

  if (isLoading || !r) {
    return <div className="p-10 text-center text-sm text-muted-foreground">Loading…</div>;
  }

  return (
    <section className="space-y-4">
      <button onClick={onBack} className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4" /> Back to Reports
      </button>

      {/* Header */}
      <div className="rounded-xl border border-border bg-card p-5">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <div className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Growth Report</div>
            <h2 className="mt-1 font-serif text-3xl text-foreground">{r.startupName}</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              {r.cohort ?? "No cohort"} · {r.numSprints} sprint{r.numSprints === 1 ? "" : "s"}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <StatusBadge status={r.status} />
            <button onClick={() => { if (confirm(`Delete this report?`)) deleteMutation.mutate(); }}
              className="rounded-md p-1.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive">
              <Trash2 className="h-4 w-4" />
            </button>
          </div>
        </div>
        {r.errorMessage && (
          <div className="mt-3 rounded-md border border-rose-200 bg-rose-50 p-3 text-xs text-rose-800 flex items-start gap-2">
            <AlertCircle className="h-3.5 w-3.5 flex-shrink-0 mt-0.5" />
            <div><strong>Last error:</strong> {r.errorMessage}</div>
          </div>
        )}
      </div>

      {/* Step 2: anchor extraction */}
      {r.status === "drafting" && (
        <div className="rounded-xl border border-border bg-card p-6 text-center">
          <Wand2 className="h-8 w-8 mx-auto text-muted-foreground" />
          <h3 className="mt-2 font-serif text-xl text-foreground">Step 2 — Extract Anchors</h3>
          <p className="mt-1 text-sm text-muted-foreground max-w-md mx-auto">
            AI will read the uploaded documents and extract the Venture Baseline Anchors. You'll
            review and edit them before final report generation.
          </p>
          <button onClick={() => extractMutation.mutate()} disabled={extractMutation.isPending}
            className="mt-4 inline-flex items-center gap-2 rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50">
            {extractMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
            {extractMutation.isPending ? "Extracting…" : "Extract Anchors with AI"}
          </button>
        </div>
      )}

      {/* Step 3: edit anchors + generate */}
      {(r.status === "anchors_ready" || r.status === "report_ready") && draftAnchors && (
        <AnchorEditor
          anchors={draftAnchors}
          onChange={setDraftAnchors}
          onSave={() => saveAnchorsMutation.mutate(draftAnchors)}
          saving={saveAnchorsMutation.isPending}
          onGenerate={() => generateMutation.mutate()}
          generating={generateMutation.isPending}
          reportReady={r.status === "report_ready" && r.hasDocx}
          reportId={id}
        />
      )}
    </section>
  );
}

// ───────────────────────── Anchor editor (Step 3) ────────────────────────
const STREAM_KEYS = ["gtm", "product", "operations", "supplyChain", "peopleHr", "finance"] as const;
const STREAM_LABELS: Record<typeof STREAM_KEYS[number], string> = {
  gtm: "GTM (Go-to-Market)", product: "Product", operations: "Operations",
  supplyChain: "Supply Chain", peopleHr: "People / HR", finance: "Finance",
};

function AnchorEditor({ anchors, onChange, onSave, saving, onGenerate, generating, reportReady, reportId }: {
  anchors: Anchors; onChange: (a: Anchors) => void;
  onSave: () => void; saving: boolean;
  onGenerate: () => void; generating: boolean;
  reportReady: boolean; reportId: number;
}) {
  function update<K extends keyof Anchors>(k: K, v: Anchors[K]) {
    onChange({ ...anchors, [k]: v });
  }
  function updateStream(k: typeof STREAM_KEYS[number], patch: Partial<StreamAnchor>) {
    onChange({ ...anchors, [k]: { ...anchors[k], ...patch } });
  }

  return (
    <>
      <div className="rounded-xl border border-border bg-card overflow-hidden">
        <div className="px-5 py-3 border-b border-border bg-muted/30 flex items-center gap-2">
          <FileEdit className="h-4 w-4 text-muted-foreground" />
          <h3 className="font-serif text-lg text-foreground">Step 3 — Review & Edit Anchors</h3>
          <p className="ml-3 text-xs text-muted-foreground">Edit any field. These drive the final report.</p>
        </div>

        <div className="p-5 space-y-6">
          <section>
            <h4 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-2">Current State</h4>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <AnchorField label="[A] Primary Product / Service" value={anchors.primaryProduct} onChange={(v) => update("primaryProduct", v)} />
              <AnchorField label="[B] Primary Customer Segment" value={anchors.primaryCustomer} onChange={(v) => update("primaryCustomer", v)} />
              <AnchorField label="[C] Primary Geography" value={anchors.primaryGeography} onChange={(v) => update("primaryGeography", v)} />
              <AnchorField label="[E] Core Business Model" value={anchors.coreBusinessModel} onChange={(v) => update("coreBusinessModel", v)} />
              <div className="md:col-span-2">
                <AnchorField label="[D] Current Scale" value={anchors.currentScale} onChange={(v) => update("currentScale", v)} multiline />
              </div>
            </div>
          </section>

          <section>
            <h4 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-2">Growth State</h4>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <AnchorField label="[F] Growth Product / Service" value={anchors.growthProduct} onChange={(v) => update("growthProduct", v)} />
              <ExistingOrNewField label="[I-F] Existing or New" value={anchors.growthProductIsNew} onChange={(v) => update("growthProductIsNew", v)} />
              <AnchorField label="[G] Growth Customer Segment" value={anchors.growthCustomer} onChange={(v) => update("growthCustomer", v)} />
              <ExistingOrNewField label="[I-G] Existing or New" value={anchors.growthCustomerIsNew} onChange={(v) => update("growthCustomerIsNew", v)} />
              <AnchorField label="[H] Growth Geography" value={anchors.growthGeography} onChange={(v) => update("growthGeography", v)} />
              <ExistingOrNewField label="[I-H] Existing or New" value={anchors.growthGeographyIsNew} onChange={(v) => update("growthGeographyIsNew", v)} />
            </div>
          </section>

          <section>
            <h4 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-2">Streams · RAG + Support Need</h4>
            <div className="space-y-2">
              {STREAM_KEYS.map(k => (
                <div key={k} className="grid grid-cols-1 md:grid-cols-12 gap-2 items-start rounded-md border border-border bg-background p-3">
                  <div className="md:col-span-3 text-sm font-medium text-foreground">{STREAM_LABELS[k]}</div>
                  <div className="md:col-span-2">
                    <RagSelector value={anchors[k].rag} onChange={(rag) => updateStream(k, { rag })} />
                  </div>
                  <div className="md:col-span-7">
                    <textarea value={anchors[k].supportNeed}
                      onChange={(e) => updateStream(k, { supportNeed: e.target.value })}
                      rows={2}
                      placeholder="One line on the specific support need (from documents)"
                      className="w-full px-2 py-1.5 bg-background border border-input rounded text-sm focus:outline-none focus:ring-2 focus:ring-ring/20" />
                  </div>
                </div>
              ))}
            </div>
            <div className="mt-3">
              <Field label="[P] Primary Sprint Stream (Sprint 1 anchors here)">
                <select value={anchors.primarySprintStream}
                  onChange={(e) => update("primarySprintStream", e.target.value)}
                  className="w-full px-3 py-2 bg-background border border-input rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-ring/20">
                  <option value="">— pick a stream —</option>
                  {STREAM_KEYS.map(k => <option key={k} value={STREAM_LABELS[k]}>{STREAM_LABELS[k]}</option>)}
                </select>
              </Field>
            </div>
          </section>

          <section>
            <h4 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-2">Strategic Summary Inputs</h4>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <AnchorField label="[Q] Risk" value={anchors.risk} onChange={(v) => update("risk", v)} multiline />
              <AnchorField label="[R] Bottleneck" value={anchors.bottleneck} onChange={(v) => update("bottleneck", v)} multiline />
              <AnchorField label="[S] Scalability" value={anchors.scalability} onChange={(v) => update("scalability", v)} multiline />
            </div>
          </section>
        </div>

        <div className="border-t border-border bg-muted/20 px-5 py-3 flex items-center justify-between gap-2 flex-wrap">
          <div className="text-[11px] text-muted-foreground">
            Edits save when you click <strong>Save Edits</strong> or <strong>Generate Report</strong>.
          </div>
          <div className="flex items-center gap-2">
            <button onClick={onSave} disabled={saving || generating}
              className="rounded-md border border-border bg-card px-3 py-1.5 text-xs font-medium hover:bg-muted disabled:opacity-50">
              {saving ? "Saving…" : "Save Edits"}
            </button>
            <button onClick={onGenerate} disabled={saving || generating}
              className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50">
              {generating ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
              {generating ? "Generating…" : (reportReady ? "Regenerate Report" : "Generate Report")}
            </button>
          </div>
        </div>
      </div>

      {/* Download — only when DOCX exists */}
      {reportReady && (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-5 flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-3">
            <div className="rounded-full bg-emerald-100 p-2"><CheckCircle2 className="h-5 w-5 text-emerald-700" /></div>
            <div>
              <div className="font-medium text-emerald-900">Report ready</div>
              <div className="text-xs text-emerald-800/80">Download the Word document below.</div>
            </div>
          </div>
          <a href={`${BASE}/api/builder/growth-reports/${reportId}/docx`}
            className="inline-flex items-center gap-2 rounded-md bg-emerald-600 text-white px-3 py-2 text-sm font-medium hover:bg-emerald-700"
            download>
            <Download className="h-4 w-4" /> Download DOCX
          </a>
        </div>
      )}
    </>
  );
}

function AnchorField({ label, value, onChange, multiline }: { label: string; value: string; onChange: (v: string) => void; multiline?: boolean }) {
  return (
    <Field label={label}>
      {multiline ? (
        <textarea value={value} onChange={(e) => onChange(e.target.value)} rows={2}
          className="w-full px-3 py-2 bg-background border border-input rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-ring/20" />
      ) : (
        <input type="text" value={value} onChange={(e) => onChange(e.target.value)}
          className="w-full px-3 py-2 bg-background border border-input rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-ring/20" />
      )}
    </Field>
  );
}

function ExistingOrNewField({ label, value, onChange }: { label: string; value: ExistingOrNew; onChange: (v: ExistingOrNew) => void }) {
  return (
    <Field label={label}>
      <select value={value} onChange={(e) => onChange(e.target.value as ExistingOrNew)}
        className="w-full px-3 py-2 bg-background border border-input rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-ring/20">
        <option value="Existing">Existing</option>
        <option value="New">New</option>
        <option value="Not stated.">Not stated.</option>
      </select>
    </Field>
  );
}

function RagSelector({ value, onChange }: { value: RAG; onChange: (v: RAG) => void }) {
  const RAGS: { value: RAG; label: string; cls: string }[] = [
    { value: "GREEN", label: "Green", cls: "bg-emerald-100 text-emerald-800 border-emerald-300" },
    { value: "AMBER", label: "Amber", cls: "bg-amber-100 text-amber-800 border-amber-300" },
    { value: "RED",   label: "Red",   cls: "bg-rose-100 text-rose-800 border-rose-300" },
  ];
  return (
    <div className="flex gap-1">
      {RAGS.map(r => (
        <button key={r.value}
          onClick={() => onChange(r.value)}
          className={`flex-1 rounded border px-2 py-1 text-[10px] font-medium uppercase tracking-wider transition ${value === r.value ? r.cls + " ring-2 ring-offset-1 ring-current" : "bg-card text-muted-foreground border-border hover:bg-muted"}`}>
          {r.label}
        </button>
      ))}
    </div>
  );
}

// ───────────────────────── Summary placeholder (Phase B) ─────────────────
// ═════════════════════════════════════════════════════════════════════════
// PHASE B — Wadhwani Foundation Summary Builder
// ═════════════════════════════════════════════════════════════════════════

type SummaryListItem = {
  id: number; startupName: string; cohort: string | null;
  status: "drafting" | "extracted" | "written_to_sheet" | "failed";
  industry: string | null; tg: string | null; funding: string | null;
  createdAt: string; updatedAt: string;
};

type SummaryFull = {
  id: number; startupName: string; cohort: string | null;
  tsheetLink: string; status: SummaryListItem["status"]; errorMessage: string | null;
  founderName: string | null; host: string | null; coHost: string | null;
  goal: string | null; vp1Date: string | null; vp2Date: string | null;
  currentRevenue: string | null; industryDetail: string | null;
  criticalVenture: string | null; tsConnects: string | null; tsSupport: string | null;
  industry: string | null; tg: string | null; funding: string | null;
  sheetRowIndex: number | null;
  createdAt: string; updatedAt: string;
};

// Default dropdown options. Users can extend any list at runtime — additions
// are persisted to localStorage so they survive across sessions / browsers.
// First load uses defaults; subsequent loads union defaults + saved customs.
const DEFAULT_INDUSTRY_OPTIONS = [
  "Manufacturing", "Fintech", "Healthtech", "Tech", "AI", "SaaS",
  "Ed Tech", "FMCG", "Retail", "Legal",
];
const DEFAULT_TG_OPTIONS = ["B2C", "B2B", "B2C+B2B", "B2G+D2C"];
const DEFAULT_FUNDING_OPTIONS = ["Bootstrapped", "Funded"];

function useExtensibleList(key: string, defaults: string[]): [string[], (val: string) => void] {
  // Reads custom additions from localStorage, unions with defaults, dedupes.
  // `add` appends a new value to the saved list AND triggers a re-render.
  const STORAGE_KEY = `ts.builder.dropdowns.${key}`;
  const [customs, setCustoms] = useState<string[]>(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === "string") : [];
    } catch { return []; }
  });
  const all = useMemo(() => {
    // Defaults first (stable order), then any user additions
    const seen = new Set<string>();
    const result: string[] = [];
    for (const v of [...defaults, ...customs]) {
      const k = v.trim().toLowerCase();
      if (!k || seen.has(k)) continue;
      seen.add(k);
      result.push(v);
    }
    return result;
  }, [customs, defaults]);
  const add = (val: string) => {
    const v = val.trim();
    if (!v) return;
    setCustoms((prev) => {
      const dedupKey = v.toLowerCase();
      // Skip if already present in defaults or customs
      if (defaults.some(d => d.toLowerCase() === dedupKey)) return prev;
      if (prev.some(p => p.toLowerCase() === dedupKey)) return prev;
      const next = [...prev, v];
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify(next)); } catch { /* ignore */ }
      return next;
    });
  };
  return [all, add];
}

function SummaryStatusBadge({ status }: { status: SummaryListItem["status"] }) {
  const map: Record<SummaryListItem["status"], { label: string; cls: string }> = {
    drafting:         { label: "Drafting",         cls: "bg-amber-50 text-amber-800 border-amber-200" },
    extracted:        { label: "Extracted",        cls: "bg-blue-50 text-blue-700 border-blue-200" },
    written_to_sheet: { label: "Written to Sheet", cls: "bg-emerald-50 text-emerald-700 border-emerald-200" },
    failed:           { label: "Failed",           cls: "bg-rose-50 text-rose-700 border-rose-200" },
  };
  const m = map[status];
  return <span className={`whitespace-nowrap inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium ${m.cls}`}>{m.label}</span>;
}

function SummaryLibrary({ onOpen, onNew }: { onOpen: (id: number) => void; onNew: () => void }) {
  const { data, isLoading } = useQuery<{ summaries: SummaryListItem[] }>({
    queryKey: ["/api/builder/wadhwani-summaries"],
    queryFn: () => customFetch(`${BASE}/api/builder/wadhwani-summaries`, { credentials: "include" }),
  });

  const grouped = useMemo(() => {
    const m = new Map<string, SummaryListItem[]>();
    for (const r of data?.summaries ?? []) {
      const key = r.cohort?.trim() || "No cohort";
      if (!m.has(key)) m.set(key, []);
      m.get(key)!.push(r);
    }
    return Array.from(m.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [data]);

  return (
    <section className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <h2 className="font-serif text-2xl text-foreground">Wadhwani Summaries</h2>
        <button onClick={onNew}
          className="inline-flex items-center gap-2 rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:opacity-90">
          <Sparkles className="h-4 w-4" /> New Summary
        </button>
      </div>

      {isLoading ? (
        <div className="space-y-2">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-16 rounded-lg" />)}</div>
      ) : (data?.summaries ?? []).length === 0 ? (
        <div className="rounded-xl border border-dashed border-border bg-card p-10 text-center">
          <div className="mx-auto rounded-full bg-muted/50 p-3 w-fit"><FileEdit className="h-6 w-6 text-muted-foreground" /></div>
          <h3 className="mt-3 font-serif text-xl text-foreground">No summaries yet</h3>
          <p className="mt-1 text-sm text-muted-foreground max-w-md mx-auto">
            Drop a T-Sheet link + Fathom transcripts. Pulls Startup Name, Founder, Host, Goal,
            VP dates from the T-Sheet; AI extracts revenue, industry detail, critical venture,
            and support needs from Fathom. Pick industry / TG / funding, then write the row to
            your Wadhwani Summary Sheet.
          </p>
        </div>
      ) : (
        grouped.map(([cohort, summaries]) => (
          <div key={cohort} className="rounded-xl border border-border bg-card overflow-hidden">
            <div className="px-4 py-2 bg-muted/30 border-b border-border text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              {cohort} · {summaries.length}
            </div>
            <ul className="divide-y divide-border">
              {summaries.map(s => (
                <li key={s.id}>
                  <button onClick={() => onOpen(s.id)} className="w-full flex items-center gap-3 px-4 py-3 hover:bg-muted/30 transition text-left">
                    <FileEdit className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                    <div className="min-w-0 flex-1">
                      <div className="font-medium text-foreground truncate">{s.startupName}</div>
                      <div className="text-[11px] text-muted-foreground truncate">
                        {[s.industry, s.tg, s.funding].filter(Boolean).join(" · ") || "No tags yet"} · updated {new Date(s.updatedAt).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}
                      </div>
                    </div>
                    <SummaryStatusBadge status={s.status} />
                    <ChevronRight className="h-4 w-4 text-muted-foreground" />
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ))
      )}
    </section>
  );
}

function NewSummaryForm({ onCancel, onCreated }: { onCancel: () => void; onCreated: (id: number) => void }) {
  const { toast } = useToast();
  // Same localStorage rehydrate pattern as the Growth Report form. Files
  // can't be serialized, so they don't persist.
  const STORAGE_KEY = "ts.builder.newSummaryForm.v1";
  const loadInitial = () => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return { startupName: "", cohort: "", tsheetLink: "", industry: "", tg: "", funding: "" };
      const p = JSON.parse(raw);
      return {
        startupName: typeof p.startupName === "string" ? p.startupName : "",
        cohort: typeof p.cohort === "string" ? p.cohort : "",
        tsheetLink: typeof p.tsheetLink === "string" ? p.tsheetLink : "",
        industry: typeof p.industry === "string" ? p.industry : "",
        tg: typeof p.tg === "string" ? p.tg : "",
        funding: typeof p.funding === "string" ? p.funding : "",
      };
    } catch {
      return { startupName: "", cohort: "", tsheetLink: "", industry: "", tg: "", funding: "" };
    }
  };
  const [form, setForm] = useState(loadInitial);
  const [fathoms, setFathoms] = useState<Array<File | null>>([null]);

  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(form)); } catch { /* ignore */ }
  }, [form]);

  const [hintDismissed, setHintDismissed] = useState(false);
  const hasRehydratedText =
    (form.startupName.trim() || form.cohort.trim() || form.tsheetLink.trim()) &&
    fathoms.every(f => !f);

  const [industryOpts, addIndustry] = useExtensibleList("industry", DEFAULT_INDUSTRY_OPTIONS);
  const [tgOpts, addTg] = useExtensibleList("tg", DEFAULT_TG_OPTIONS);
  const [fundingOpts, addFunding] = useExtensibleList("funding", DEFAULT_FUNDING_OPTIONS);

  const submitMutation = useMutation({
    mutationFn: async () => {
      const fd = new FormData();
      // startup_name is optional — backend prefers the value extracted from
      // Overview tab. We send it as a fallback hint if user entered one.
      if (form.startupName.trim()) fd.append("startup_name", form.startupName.trim());
      if (form.cohort.trim()) fd.append("cohort", form.cohort.trim());
      fd.append("tsheet_link", form.tsheetLink);
      if (form.industry) fd.append("industry", form.industry);
      if (form.tg) fd.append("tg", form.tg);
      if (form.funding) fd.append("funding", form.funding);
      let fathomIdx = 0;
      for (const f of fathoms) {
        if (f) {
          fathomIdx += 1;
          fd.append(`fathom_${fathomIdx}`, f);
        }
      }
      const res = await fetch(`${BASE}/api/builder/wadhwani-summaries`, {
        method: "POST", credentials: "include", body: fd,
      });
      if (!res.ok) throw new Error((await res.json()).error || "Create failed");
      return (await res.json()).summary as SummaryFull;
    },
    onSuccess: (s) => {
      try { localStorage.removeItem(STORAGE_KEY); } catch { /* ignore */ }
      toast({ title: "Summary created", description: "Review and edit before writing to sheet." });
      onCreated(s.id);
    },
    onError: (err: any) => toast({ title: "Create failed", description: err.message, variant: "destructive" }),
  });

  const canSubmit = form.tsheetLink.trim().length > 0;

  return (
    <section className="space-y-4">
      <button onClick={onCancel} className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4" /> Back to Summaries
      </button>

      <div className="rounded-xl border border-border bg-card p-6">
        <h2 className="font-serif text-2xl text-foreground">New Wadhwani Summary</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Pulls fields from the T-Sheet (Overview, SMART, Sprint Tracking) and AI-extracts revenue,
          industry detail, critical venture, and TS support needs from Fathom transcripts.
        </p>

        {hasRehydratedText && !hintDismissed && (
          <div className="mt-4 flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
            <span className="mt-0.5">↩</span>
            <div className="flex-1">
              <p className="font-medium">Restored your previous progress.</p>
              <p className="text-amber-800">Text fields came back, but you'll need to re-attach Fathom files.</p>
            </div>
            <button onClick={() => setHintDismissed(true)} className="text-amber-900 hover:underline text-xs">Dismiss</button>
          </div>
        )}

        <div className="mt-5 grid grid-cols-1 md:grid-cols-2 gap-4">
          <Field label="Startup Name" hint="Optional — pulled from T-Sheet Overview if blank">
            <input type="text" value={form.startupName} onChange={(e) => setForm({ ...form, startupName: e.target.value })}
              placeholder="e.g. Bull AgriTech"
              className="w-full px-3 py-2 bg-background border border-input rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-ring/20" />
          </Field>
          <Field label="Cohort" hint="Used to group summaries in the library">
            <input type="text" value={form.cohort} onChange={(e) => setForm({ ...form, cohort: e.target.value })}
              placeholder="e.g. Wadhwani Foundation"
              className="w-full px-3 py-2 bg-background border border-input rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-ring/20" />
          </Field>
          <Field label="T-Sheet Link" required hint="Google Sheets URL for the Sprint Template">
            <input type="url" value={form.tsheetLink} onChange={(e) => setForm({ ...form, tsheetLink: e.target.value })}
              placeholder="https://docs.google.com/spreadsheets/d/..."
              className="w-full px-3 py-2 bg-background border border-input rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-ring/20" />
          </Field>
          <div /> {/* spacer to keep grid alignment */}

          <ExtensibleDropdown
            label="Industry"
            hint="Top-level label. Use + to add a new one."
            value={form.industry}
            options={industryOpts}
            onChange={(v) => setForm({ ...form, industry: v })}
            onAdd={addIndustry}
          />
          <ExtensibleDropdown
            label="Target Group (TG)"
            hint="B2C, B2B, B2C+B2B, B2G+D2C, etc."
            value={form.tg}
            options={tgOpts}
            onChange={(v) => setForm({ ...form, tg: v })}
            onAdd={addTg}
          />
          <ExtensibleDropdown
            label="Funding Status"
            hint="Bootstrapped, Funded, Pre-seed, etc."
            value={form.funding}
            options={fundingOpts}
            onChange={(v) => setForm({ ...form, funding: v })}
            onAdd={addFunding}
          />
        </div>

        <div className="mt-5 space-y-3">
          {fathoms.map((f, idx) => (
            <FileSlot
              key={idx}
              label={`Fathom Transcript ${idx + 1}`}
              accept=".vtt,.srt,.txt,.docx,.md"
              hint={idx === 0
                ? "Optional but recommended — AI extracts 5 fields from these."
                : "Optional. Additional Fathom transcript."}
              file={f}
              onChange={(file) =>
                setFathoms((prev) => prev.map((p, i) => (i === idx ? file : p)))
              }
              onRemove={fathoms.length > 1
                ? () => setFathoms((prev) => prev.filter((_, i) => i !== idx))
                : undefined}
            />
          ))}
          <button
            type="button"
            onClick={() => setFathoms((prev) => [...prev, null])}
            className="inline-flex items-center gap-1.5 rounded-md border border-dashed border-border bg-background px-3 py-1.5 text-sm font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <Plus className="h-3.5 w-3.5" /> Add another Fathom transcript
          </button>
        </div>

        <div className="mt-6 flex items-center justify-end gap-2">
          <button onClick={onCancel} className="rounded-md border border-border bg-background px-3 py-2 text-sm font-medium hover:bg-muted">
            Cancel
          </button>
          <button onClick={() => submitMutation.mutate()} disabled={!canSubmit || submitMutation.isPending}
            className="inline-flex items-center gap-2 rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50">
            {submitMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Wand2 className="h-4 w-4" />}
            {submitMutation.isPending ? "Extracting…" : "Pull T-Sheet & Extract"}
          </button>
        </div>
      </div>
    </section>
  );
}

/** Dropdown with a "+ Add" affordance that prompts for a new value and
 *  persists it to localStorage for future sessions. */
function ExtensibleDropdown({
  label, hint, value, options, onChange, onAdd,
}: {
  label: string; hint?: string; value: string;
  options: string[]; onChange: (v: string) => void;
  onAdd: (v: string) => void;
}) {
  const [adding, setAdding] = useState(false);
  const [newVal, setNewVal] = useState("");
  const handleAdd = () => {
    const v = newVal.trim();
    if (!v) { setAdding(false); return; }
    onAdd(v);
    onChange(v);
    setNewVal("");
    setAdding(false);
  };
  return (
    <Field label={label} hint={hint}>
      {adding ? (
        <div className="flex gap-1">
          <input type="text" value={newVal} onChange={(e) => setNewVal(e.target.value)} autoFocus
            placeholder="Type new option…"
            onKeyDown={(e) => { if (e.key === "Enter") handleAdd(); if (e.key === "Escape") setAdding(false); }}
            className="flex-1 px-3 py-2 bg-background border border-input rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-ring/20" />
          <button onClick={handleAdd} className="rounded-md bg-primary px-2 text-xs font-medium text-primary-foreground hover:opacity-90">Save</button>
          <button onClick={() => setAdding(false)} className="rounded-md border border-border px-2 text-xs hover:bg-muted">Cancel</button>
        </div>
      ) : (
        <div className="flex gap-1">
          <select value={value} onChange={(e) => onChange(e.target.value)}
            className="flex-1 px-3 py-2 bg-background border border-input rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-ring/20">
            <option value="">— Select —</option>
            {options.map(o => <option key={o} value={o}>{o}</option>)}
          </select>
          <button onClick={() => setAdding(true)} title={`Add new ${label.toLowerCase()}`}
            className="rounded-md border border-border bg-background px-2 text-muted-foreground hover:bg-muted hover:text-foreground">
            <Plus className="h-3.5 w-3.5" />
          </button>
        </div>
      )}
    </Field>
  );
}

function SummaryWorkflow({ id, onBack }: { id: number; onBack: () => void }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const { data, isLoading } = useQuery<{ summary: SummaryFull }>({
    queryKey: ["/api/builder/wadhwani-summaries", id],
    queryFn: () => customFetch(`${BASE}/api/builder/wadhwani-summaries/${id}`, { credentials: "include" }),
    refetchOnWindowFocus: false,
  });
  const s = data?.summary;

  // Local editable copy. Synced from server data the first time it arrives;
  // edits stay local until Save or Write-to-Sheet.
  const [draft, setDraft] = useState<SummaryFull | null>(null);
  useEffect(() => {
    if (s && draft === null) setDraft(s);
  }, [s, draft]);

  const [summarySheetLink, setSummarySheetLink] = useState("");

  // Extensible dropdown lists — must be declared before any early return
  // (Rules of Hooks: same order on every render).
  const [industryOpts, addIndustry] = useExtensibleList("industry", DEFAULT_INDUSTRY_OPTIONS);
  const [tgOpts, addTg] = useExtensibleList("tg", DEFAULT_TG_OPTIONS);
  const [fundingOpts, addFunding] = useExtensibleList("funding", DEFAULT_FUNDING_OPTIONS);

  const saveMutation = useMutation({
    mutationFn: async (updates: Partial<SummaryFull>) => {
      const res = await fetch(`${BASE}/api/builder/wadhwani-summaries/${id}`, {
        method: "PATCH", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updates),
      });
      if (!res.ok) throw new Error((await res.json()).error || "Save failed");
    },
    onSuccess: () => {
      toast({ title: "Saved" });
      qc.invalidateQueries({ queryKey: ["/api/builder/wadhwani-summaries", id] });
      qc.invalidateQueries({ queryKey: ["/api/builder/wadhwani-summaries"] });
    },
    onError: (err: any) => toast({ title: "Save failed", description: err.message, variant: "destructive" }),
  });

  const writeMutation = useMutation({
    mutationFn: async () => {
      // Save current edits first
      if (draft) {
        await fetch(`${BASE}/api/builder/wadhwani-summaries/${id}`, {
          method: "PATCH", credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(draft),
        });
      }
      const res = await fetch(`${BASE}/api/builder/wadhwani-summaries/${id}/write-to-sheet`, {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ summary_sheet_link: summarySheetLink }),
      });
      if (!res.ok) throw new Error((await res.json()).error || "Write failed");
      return res.json();
    },
    onSuccess: (r) => {
      toast({ title: "Written to Sheet", description: `Row ${r.sheetRowIndex ?? "?"} appended to "${r.tab ?? ""}"` });
      qc.invalidateQueries({ queryKey: ["/api/builder/wadhwani-summaries", id] });
      qc.invalidateQueries({ queryKey: ["/api/builder/wadhwani-summaries"] });
    },
    onError: (err: any) => toast({ title: "Write failed", description: err.message, variant: "destructive" }),
  });

  if (isLoading || !s || !draft) {
    return <div className="space-y-2">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-16 rounded-lg" />)}</div>;
  }

  const updateField = (k: keyof SummaryFull, v: string) => {
    setDraft((d) => d ? { ...d, [k]: v } : d);
  };

  return (
    <section className="space-y-4">
      <button onClick={onBack} className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4" /> Back to Summaries
      </button>

      <div className="rounded-xl border border-border bg-card p-6 space-y-5">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="font-serif text-2xl text-foreground">{s.startupName}</h2>
            <p className="text-xs text-muted-foreground">{s.cohort ?? "No cohort"} · updated {new Date(s.updatedAt).toLocaleString("en-IN")}</p>
          </div>
          <SummaryStatusBadge status={s.status} />
        </div>

        {s.errorMessage && (
          <div className="flex items-start gap-2 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-900">
            <AlertCircle className="h-4 w-4 mt-0.5" />
            <div>{s.errorMessage}</div>
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Field label="Startup Name"><EditableText value={draft.startupName} onChange={(v) => updateField("startupName", v)} /></Field>
          <Field label="Cohort"><EditableText value={draft.cohort ?? ""} onChange={(v) => updateField("cohort", v)} /></Field>
          <Field label="Founder Name" hint="From Overview tab"><EditableText value={draft.founderName ?? ""} onChange={(v) => updateField("founderName", v)} /></Field>
          <Field label="Host" hint="T-Sprint Consultants Assigned"><EditableText value={draft.host ?? ""} onChange={(v) => updateField("host", v)} /></Field>
          <Field label="Co-Host" hint="Cell to the right of Host in Overview"><EditableText value={draft.coHost ?? ""} onChange={(v) => updateField("coHost", v)} /></Field>
          <div />
          <Field label="VP1 Date" hint="First occurrence in Sprint Tracking"><EditableText value={draft.vp1Date ?? ""} onChange={(v) => updateField("vp1Date", v)} /></Field>
          <Field label="VP2 Date" hint="Second occurrence in Sprint Tracking"><EditableText value={draft.vp2Date ?? ""} onChange={(v) => updateField("vp2Date", v)} /></Field>
        </div>

        <Field label="Goal" hint="From SMART tab (joined verbatim)">
          <textarea value={draft.goal ?? ""} onChange={(e) => updateField("goal", e.target.value)} rows={4}
            className="w-full px-3 py-2 bg-background border border-input rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-ring/20 font-mono" />
        </Field>

        <div className="border-t border-border pt-4">
          <h3 className="font-semibold text-sm text-foreground mb-3">AI-extracted from Fathom</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Field label="Current Revenue / ARR"><EditableText value={draft.currentRevenue ?? ""} onChange={(v) => updateField("currentRevenue", v)} placeholder="e.g. INR 1.2 Cr ARR" /></Field>
            <Field label="Industry Detail"><EditableText value={draft.industryDetail ?? ""} onChange={(v) => updateField("industryDetail", v)} placeholder="e.g. Electrical Equipment Manufacturing" /></Field>
            <Field label="Critical Venture" hint="Most important current initiative"><EditableText value={draft.criticalVenture ?? ""} onChange={(v) => updateField("criticalVenture", v)} placeholder="e.g. Scaling of Automated Panels" /></Field>
            <Field label="TS Connects Needed"><EditableText value={draft.tsConnects ?? ""} onChange={(v) => updateField("tsConnects", v)} placeholder="e.g. Plant and Factory consultants" /></Field>
            <div className="md:col-span-2">
              <Field label="TS Support (beyond connects)">
                <textarea value={draft.tsSupport ?? ""} onChange={(e) => updateField("tsSupport", e.target.value)} rows={2}
                  className="w-full px-3 py-2 bg-background border border-input rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-ring/20" />
              </Field>
            </div>
          </div>
        </div>

        <div className="border-t border-border pt-4">
          <h3 className="font-semibold text-sm text-foreground mb-3">Classification</h3>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <ExtensibleDropdown label="Industry" value={draft.industry ?? ""} options={industryOpts}
              onChange={(v) => updateField("industry", v)} onAdd={addIndustry} />
            <ExtensibleDropdown label="Target Group (TG)" value={draft.tg ?? ""} options={tgOpts}
              onChange={(v) => updateField("tg", v)} onAdd={addTg} />
            <ExtensibleDropdown label="Funding Status" value={draft.funding ?? ""} options={fundingOpts}
              onChange={(v) => updateField("funding", v)} onAdd={addFunding} />
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 pt-2 border-t border-border">
          <button onClick={() => draft && saveMutation.mutate(draft)} disabled={saveMutation.isPending}
            className="inline-flex items-center gap-2 rounded-md border border-border bg-background px-3 py-2 text-sm font-medium hover:bg-muted disabled:opacity-50">
            {saveMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
            Save edits
          </button>
        </div>
      </div>

      {/* Write to Sheet card */}
      <div className="rounded-xl border border-border bg-card p-6 space-y-3">
        <h3 className="font-serif text-xl text-foreground">Write to Wadhwani Summary Sheet</h3>
        <p className="text-sm text-muted-foreground">
          Paste the Google Sheets URL of the master summary sheet. We'll append a row to the tab
          named "Summary Sheet" (or the first tab if not found). Make sure Google Sheets is connected
          under Settings → Google Connections.
        </p>
        <input type="url" value={summarySheetLink} onChange={(e) => setSummarySheetLink(e.target.value)}
          placeholder="https://docs.google.com/spreadsheets/d/..."
          className="w-full px-3 py-2 bg-background border border-input rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-ring/20" />
        <div className="flex items-center justify-end">
          <button onClick={() => writeMutation.mutate()} disabled={!summarySheetLink.trim() || writeMutation.isPending}
            className="inline-flex items-center gap-2 rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50">
            {writeMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
            {writeMutation.isPending ? "Writing…" : "Append row to Summary Sheet"}
          </button>
        </div>
        {s.sheetRowIndex && (
          <p className="text-xs text-emerald-700 flex items-center gap-1">
            <CheckCircle2 className="h-3 w-3" /> Last written to row {s.sheetRowIndex}
          </p>
        )}
      </div>
    </section>
  );
}

function EditableText({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <input type="text" value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder}
      className="w-full px-3 py-2 bg-background border border-input rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-ring/20" />
  );
}
