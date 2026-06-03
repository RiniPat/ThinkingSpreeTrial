import { useEffect, useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react";
import { Layout } from "@/components/Layout";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import {
  FileText, Upload, Sparkles, Loader2, Download, ChevronRight, ArrowLeft,
  CheckCircle2, AlertCircle, Trash2, FileEdit, Wand2, Save, RefreshCw, Plus, Building2,
} from "lucide-react";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

/**
 * Read a useful error message off a failed Response without throwing.
 *
 * When the API crashes hard (e.g. an extraction library blows up, or the dyno
 * returns a 502 with an HTML/empty body), `res.json()` throws
 * "Unexpected end of JSON input", which masks the real failure. This reads the
 * body as text once, tries to parse JSON, and otherwise returns the raw text or
 * a status-based fallback.
 */
async function readErr(res: Response, fallback: string): Promise<string> {
  let body = "";
  try { body = await res.text(); } catch { /* ignore */ }
  if (body) {
    try {
      const j = JSON.parse(body);
      if (j && (j.error || j.message)) return j.error || j.message;
    } catch { /* not JSON — fall through to raw text */ }
    const trimmed = body.trim();
    if (trimmed && !trimmed.startsWith("<")) return trimmed.slice(0, 300);
  }
  return `${fallback} (HTTP ${res.status}${res.statusText ? " " + res.statusText : ""})`;
}

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
  // Mode toggle: Growth Report (Phase A, built) vs Summary (Phase B, placeholder).
  const [mode, setMode] = useState<Mode>("growth_report");
  // Active report ID drives whether we show the library or the workflow.
  const [activeId, setActiveId] = useState<number | null>(null);
  const [creatingNew, setCreatingNew] = useState(false);

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
            Summary
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
        ) : (
          <SummaryBuilder />
        )}

        <footer className="pt-2 text-center text-xs text-muted-foreground">Thinking Spree · Consultant Suite v5.6</footer>
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
  const [form, setForm] = useState({
    startupName: "", cohort: "", tsheetLink: "", numSprints: 1 as 1 | 2,
  });
  const [canvas, setCanvas] = useState<File | null>(null);
  const [fathom1, setFathom1] = useState<File | null>(null);
  const [fathom2, setFathom2] = useState<File | null>(null);
  const [checkin, setCheckin] = useState<File | null>(null);

  const submitMutation = useMutation({
    mutationFn: async () => {
      const fd = new FormData();
      fd.append("startup_name", form.startupName);
      if (form.cohort.trim()) fd.append("cohort", form.cohort.trim());
      fd.append("tsheet_link", form.tsheetLink);
      fd.append("num_sprints", String(form.numSprints));
      if (canvas) fd.append("strategic_canvas", canvas);
      if (fathom1) fd.append("fathom_1", fathom1);
      if (form.numSprints === 2 && fathom2) fd.append("fathom_2", fathom2);
      if (checkin) fd.append("checkin", checkin);

      const res = await fetch(`${BASE}/api/builder/growth-reports`, {
        method: "POST", credentials: "include", body: fd,
      });
      if (!res.ok) throw new Error(await readErr(res, "Upload failed"));
      return (await res.json()).report as FullReport;
    },
    onSuccess: (r) => {
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
          <Field label="Number of Sprints">
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
          <FileSlot label="Fathom Transcript 1" accept=".vtt,.srt,.txt,.docx,.md"
            hint="Optional. .vtt / .srt / .txt / .docx"
            file={fathom1} onChange={setFathom1} />
          {form.numSprints === 2 && (
            <FileSlot label="Fathom Transcript 2" accept=".vtt,.srt,.txt,.docx,.md"
              hint="Optional. Second sprint's Fathom."
              file={fathom2} onChange={setFathom2} />
          )}
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

function FileSlot({ label, hint, accept, required, file, onChange }: {
  label: string; hint?: string; accept: string; required?: boolean;
  file: File | null; onChange: (f: File | null) => void;
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
            <button onClick={() => onChange(null)} className="rounded p-1 text-muted-foreground hover:bg-muted">
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
      if (!res.ok) throw new Error(await readErr(res, "Extraction failed"));
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
      if (!res.ok) throw new Error(await readErr(res, "Save failed"));
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
      if (!res.ok) throw new Error(await readErr(res, "Generation failed"));
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

// ═════════════════════════ Summary Builder (Phase B) ═════════════════════
// Pulls the venture scaffold from the T-Sheet, AI-extracts the Wadhwani Fathom
// fields, looks up VP1/VP2 dates from Sprint Tracking, lets the consultant
// review/edit (with color-chip dropdowns), then commits a venture row to the
// Summary Sheet tab under the Wadhwani Foundation companies cohort.

type ChipOption = { value: string; color: string };

// Colors sampled from the program's industry / TG palettes. Both lists are
// extendable — consultants can type a custom value in the field below the chips.
const INDUSTRY_OPTIONS: ChipOption[] = [
  { value: "Manufacturing", color: "#E6E6E6" },
  { value: "Fintech",       color: "#D2EDBC" },
  { value: "Healthtech",    color: "#AF0201" },
  { value: "Tech",          color: "#FEC7A9" },
  { value: "AI",            color: "#FEE5A0" },
  { value: "SaaS",          color: "#C5DAE2" },
  { value: "Ed Tech",       color: "#E6CFF3" },
  { value: "FMCG",          color: "#3D3D3D" },
  { value: "Retail",        color: "#FCD0CA" },
  { value: "Legal",         color: "#763C09" },
];
const TG_OPTIONS: ChipOption[] = [
  { value: "B2C",        color: "#FCCCC0" },
  { value: "B2B",        color: "#FCC09C" },
  { value: "D2C",        color: "#E4CCF0" },
  { value: "B2B + D2C",  color: "#FCE49C" },
  { value: "B2B + B2C",  color: "#CCE4B4" },
  { value: "B2G",        color: "#B4D8F0" },
  { value: "B2G + D2C",  color: "#C0D8D8" },
  { value: "B2G + B2C",  color: "#3C3C3C" },
  { value: "B2G + B2B",  color: "#A80000" },
];
const FUNDING_OPTIONS: ChipOption[] = [
  { value: "Funded",       color: "#D2EDBC" },
  { value: "Bootstrapped", color: "#FEE5A0" },
  { value: "NA",           color: "#E6E6E6" },
];

/** Pick readable text color (black/white) for a hex background by luminance. */
function textOn(hex: string): string {
  const h = hex.replace("#", "");
  const r = parseInt(h.slice(0, 2), 16), g = parseInt(h.slice(2, 4), 16), b = parseInt(h.slice(4, 6), 16);
  const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return lum > 0.6 ? "#1f2937" : "#ffffff";
}

type SummaryFields = {
  startupName: string; founder: string; host: string; coHost: string; goal: string;
  industry: string; tg: string; funding: string;
  currentRevenueArr: string; industryDetail: string; criticalVenture: string;
  tsConnects: string; tsSupport: string;
  vp1Date: string | null; vp2Date: string | null; notes: string;
};

type SummaryStatus = "drafting" | "ready" | "committed" | "failed";
type SummaryListItem = {
  id: number; startupName: string; cohort: string | null;
  status: SummaryStatus; founderId: number | null; createdAt: string; updatedAt: string;
};
type FullSummaryBuild = {
  id: number; startupName: string; cohort: string | null; tsheetLink: string | null;
  status: SummaryStatus; errorMessage: string | null;
  pulled: any; aiFields: any; fields: SummaryFields | null;
  founderId: number | null; hasFathom: boolean; createdAt: string; updatedAt: string;
};

function SummaryBuilder() {
  const [activeId, setActiveId] = useState<number | null>(null);
  const [creatingNew, setCreatingNew] = useState(false);

  if (activeId !== null) return <SummaryWorkflow id={activeId} onBack={() => setActiveId(null)} />;
  if (creatingNew) return <NewSummaryForm onCancel={() => setCreatingNew(false)} onCreated={(id) => { setCreatingNew(false); setActiveId(id); }} />;
  return <SummaryLibrary onOpen={setActiveId} onNew={() => setCreatingNew(true)} />;
}

function SummaryStatusBadge({ status }: { status: SummaryStatus }) {
  const map: Record<SummaryStatus, { label: string; cls: string }> = {
    drafting:  { label: "Drafting",  cls: "bg-amber-50 text-amber-800 border-amber-200" },
    ready:     { label: "Ready",     cls: "bg-blue-50 text-blue-700 border-blue-200" },
    committed: { label: "Committed", cls: "bg-emerald-50 text-emerald-700 border-emerald-200" },
    failed:    { label: "Failed",    cls: "bg-rose-50 text-rose-700 border-rose-200" },
  };
  const m = map[status];
  return <span className={`whitespace-nowrap inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium ${m.cls}`}>{m.label}</span>;
}

function SummaryLibrary({ onOpen, onNew }: { onOpen: (id: number) => void; onNew: () => void }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const { data, isLoading } = useQuery<{ builds: SummaryListItem[] }>({
    queryKey: ["summary-builds"],
    queryFn: () => customFetch(`${BASE}/api/builder/summary-builds`, { credentials: "include" }),
  });

  const del = useMutation({
    mutationFn: async (id: number) => {
      const res = await fetch(`${BASE}/api/builder/summary-builds/${id}`, { method: "DELETE", credentials: "include" });
      if (!res.ok) throw new Error("Delete failed");
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["summary-builds"] }); toast({ title: "Deleted" }); },
  });

  const builds = data?.builds ?? [];

  return (
    <section className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="font-serif text-2xl text-foreground">Summary Builder</h2>
          <p className="mt-1 text-sm text-muted-foreground max-w-2xl">
            Build a Wadhwani-format venture summary from the T-Sheet + Fathom transcript, then commit it
            to the Summary Sheet tab.
          </p>
        </div>
        <button onClick={onNew}
          className="inline-flex items-center gap-2 rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:opacity-90">
          <Plus className="h-4 w-4" /> New Summary
        </button>
      </div>

      {isLoading ? (
        <div className="grid gap-3">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-16 rounded-lg" />)}</div>
      ) : builds.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border bg-card p-10 text-center">
          <Building2 className="mx-auto h-10 w-10 text-muted-foreground/30" />
          <p className="mt-3 font-semibold text-foreground">No summaries yet</p>
          <p className="mt-1 text-sm text-muted-foreground">Start one from a T-Sheet link and (optionally) a Fathom transcript.</p>
          <button onClick={onNew} className="mt-4 inline-flex items-center gap-2 rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:opacity-90">
            <Plus className="h-4 w-4" /> New Summary
          </button>
        </div>
      ) : (
        <div className="space-y-2">
          {builds.map(b => (
            <div key={b.id} className="flex items-center gap-3 rounded-lg border border-border bg-card px-4 py-3 hover:border-primary/40 transition">
              <button onClick={() => onOpen(b.id)} className="flex-1 min-w-0 text-left">
                <div className="flex items-center gap-2">
                  <span className="font-medium text-foreground truncate">{b.startupName}</span>
                  <SummaryStatusBadge status={b.status} />
                </div>
                <div className="text-[11px] text-muted-foreground">
                  {b.cohort ?? "Wadhwani Foundation companies"} · updated {new Date(b.updatedAt).toLocaleDateString()}
                </div>
              </button>
              <button onClick={() => onOpen(b.id)} className="rounded p-1.5 text-muted-foreground hover:bg-muted"><ChevronRight className="h-4 w-4" /></button>
              <button onClick={() => del.mutate(b.id)} className="rounded p-1.5 text-muted-foreground hover:bg-muted hover:text-destructive"><Trash2 className="h-4 w-4" /></button>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function NewSummaryForm({ onCancel, onCreated }: { onCancel: () => void; onCreated: (id: number) => void }) {
  const { toast } = useToast();
  const LS_KEY = "summaryBuilder:newForm";
  // Rehydrate from localStorage so progress survives a tab switch / refresh.
  const [form, setForm] = useState<{ startupName: string; tsheetLink: string }>(() => {
    try { const s = localStorage.getItem(LS_KEY); if (s) return JSON.parse(s); } catch { /* ignore */ }
    return { startupName: "", tsheetLink: "" };
  });
  const [fathom, setFathom] = useState<File | null>(null);
  useEffect(() => { try { localStorage.setItem(LS_KEY, JSON.stringify(form)); } catch { /* ignore */ } }, [form]);

  const submit = useMutation({
    mutationFn: async () => {
      const fd = new FormData();
      fd.append("startup_name", form.startupName.trim());
      fd.append("tsheet_link", form.tsheetLink.trim());
      if (fathom) fd.append("fathom", fathom);
      const res = await fetch(`${BASE}/api/builder/summary-builds`, { method: "POST", credentials: "include", body: fd });
      if (!res.ok) throw new Error(await readErr(res, "Build failed"));
      return (await res.json()).build as FullSummaryBuild;
    },
    onSuccess: (b) => {
      try { localStorage.removeItem(LS_KEY); } catch { /* ignore */ }
      toast({ title: "Pulled from T-Sheet", description: fathom ? "Fathom fields extracted. Review below." : "Review and fill the fields below." });
      onCreated(b.id);
    },
    onError: (err: any) => toast({ title: "Couldn't build", description: err.message, variant: "destructive" }),
  });

  const canSubmit = form.startupName.trim() && form.tsheetLink.trim();

  return (
    <section className="space-y-4">
      <button onClick={onCancel} className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4" /> Back to Summaries
      </button>
      <div className="rounded-xl border border-border bg-card p-6">
        <h2 className="font-serif text-2xl text-foreground">New Summary</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Pulls Startup / Founder / Host / Co-Host / Goal from the T-Sheet and VP1/VP2 dates from Sprint
          Tracking. Add a Fathom transcript to auto-fill Revenue, Industry detail, Critical Venture, and TS
          Connects / Support.
        </p>
        <div className="mt-5 grid grid-cols-1 md:grid-cols-2 gap-4">
          <Field label="Startup Name" required>
            <input type="text" value={form.startupName} onChange={(e) => setForm({ ...form, startupName: e.target.value })}
              placeholder="e.g. Bull AgriTech"
              className="w-full px-3 py-2 bg-background border border-input rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-ring/20" />
          </Field>
          <Field label="T-Sheet Link" required hint="Google Sheets URL for the Sprint Template">
            <input type="url" value={form.tsheetLink} onChange={(e) => setForm({ ...form, tsheetLink: e.target.value })}
              placeholder="https://docs.google.com/spreadsheets/d/..."
              className="w-full px-3 py-2 bg-background border border-input rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-ring/20" />
          </Field>
        </div>
        <div className="mt-5">
          <FileSlot label="Fathom Transcript" accept=".vtt,.srt,.txt,.docx,.md"
            hint="Optional. AI extracts Revenue / Industry / Critical Venture / TS Connects / TS Support."
            file={fathom} onChange={setFathom} />
        </div>
        <div className="mt-6 flex items-center justify-end gap-2">
          <button onClick={onCancel} className="rounded-md border border-border bg-background px-3 py-2 text-sm font-medium hover:bg-muted">Cancel</button>
          <button onClick={() => submit.mutate()} disabled={!canSubmit || submit.isPending}
            className="inline-flex items-center gap-2 rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50">
            {submit.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Wand2 className="h-4 w-4" />}
            {submit.isPending ? "Pulling…" : "Pull & Continue"}
          </button>
        </div>
      </div>
    </section>
  );
}

function ChipSelect({ value, onChange, options, allowCustom = true }: {
  value: string; onChange: (v: string) => void; options: ChipOption[]; allowCustom?: boolean;
}) {
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1.5">
        {options.map(o => {
          const selected = value === o.value;
          return (
            <button key={o.value} type="button" onClick={() => onChange(o.value)}
              style={{ backgroundColor: o.color, color: textOn(o.color) }}
              className={`rounded-full px-2.5 py-1 text-[11px] font-medium border transition ${selected ? "ring-2 ring-offset-1 ring-ring border-transparent" : "border-black/10 opacity-85 hover:opacity-100"}`}>
              {o.value}
            </button>
          );
        })}
      </div>
      {allowCustom && (
        <input type="text" value={value} onChange={(e) => onChange(e.target.value)} placeholder="or type a custom value"
          className="w-full px-3 py-2 bg-background border border-input rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-ring/20" />
      )}
    </div>
  );
}

function SummaryWorkflow({ id, onBack }: { id: number; onBack: () => void }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const LS_KEY = `summaryBuilder:fields:${id}`;

  const { data, isLoading } = useQuery<{ build: FullSummaryBuild }>({
    queryKey: ["summary-build", id],
    queryFn: () => customFetch(`${BASE}/api/builder/summary-builds/${id}`, { credentials: "include" }),
  });
  const build = data?.build;

  const [fields, setFields] = useState<SummaryFields | null>(null);
  // Initialise from server, but prefer locally-saved edits (tab-switch safety).
  useEffect(() => {
    if (!build?.fields) return;
    let local: SummaryFields | null = null;
    try { const s = localStorage.getItem(LS_KEY); if (s) local = JSON.parse(s); } catch { /* ignore */ }
    setFields(local ?? build.fields);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [build?.id]);
  useEffect(() => {
    if (fields) { try { localStorage.setItem(LS_KEY, JSON.stringify(fields)); } catch { /* ignore */ } }
  }, [fields, LS_KEY]);

  function set<K extends keyof SummaryFields>(k: K, v: SummaryFields[K]) {
    setFields(f => (f ? { ...f, [k]: v } : f));
  }

  const save = useMutation({
    mutationFn: async () => {
      const res = await fetch(`${BASE}/api/builder/summary-builds/${id}`, {
        method: "PATCH", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fields }),
      });
      if (!res.ok) throw new Error(await readErr(res, "Save failed"));
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["summary-build", id] }); toast({ title: "Saved" }); },
    onError: (e: any) => toast({ title: "Save failed", description: e.message, variant: "destructive" }),
  });

  const rerun = useMutation({
    mutationFn: async () => {
      const res = await fetch(`${BASE}/api/builder/summary-builds/${id}/extract`, { method: "POST", credentials: "include" });
      if (!res.ok) throw new Error(await readErr(res, "Extract failed"));
      return (await res.json()).fields as SummaryFields;
    },
    onSuccess: (merged) => { setFields(merged); toast({ title: "AI re-extracted", description: "Blank fields filled from the transcript." }); },
    onError: (e: any) => toast({ title: "Extract failed", description: e.message, variant: "destructive" }),
  });

  const commit = useMutation({
    mutationFn: async () => {
      // Save current edits first so the server commits exactly what's on screen.
      const r1 = await fetch(`${BASE}/api/builder/summary-builds/${id}`, {
        method: "PATCH", credentials: "include",
        headers: { "Content-Type": "application/json" }, body: JSON.stringify({ fields }),
      });
      if (!r1.ok) throw new Error(await readErr(r1, "Save failed"));
      const r2 = await fetch(`${BASE}/api/builder/summary-builds/${id}/commit`, { method: "POST", credentials: "include" });
      if (!r2.ok) throw new Error(await readErr(r2, "Commit failed"));
      return r2.json();
    },
    onSuccess: () => {
      try { localStorage.removeItem(LS_KEY); } catch { /* ignore */ }
      qc.invalidateQueries({ queryKey: ["summary-build", id] });
      qc.invalidateQueries({ queryKey: ["summary-builds"] });
      toast({ title: "Committed to Summary Sheet", description: "The venture now appears under the Wadhwani cohort on the Summary tab." });
    },
    onError: (e: any) => toast({ title: "Commit failed", description: e.message, variant: "destructive" }),
  });

  if (isLoading || !build || !fields) {
    return (
      <section className="space-y-4">
        <button onClick={onBack} className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="h-4 w-4" /> Back</button>
        <Skeleton className="h-72 rounded-xl" />
      </section>
    );
  }

  const committed = build.status === "committed";

  return (
    <section className="space-y-4">
      <button onClick={onBack} className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4" /> Back to Summaries
      </button>

      {build.status === "failed" && build.errorMessage && (
        <div className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-800 flex items-center gap-2">
          <AlertCircle className="h-3.5 w-3.5" /> {build.errorMessage}
        </div>
      )}
      {committed && (
        <div className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800 flex items-center gap-2">
          <CheckCircle2 className="h-3.5 w-3.5" /> Committed to the Summary Sheet tab under {build.cohort ?? "Wadhwani Foundation companies"}. Re-committing updates the same venture.
        </div>
      )}

      <div className="rounded-xl border border-border bg-card p-6 space-y-5">
        <div className="flex items-start justify-between">
          <div>
            <h2 className="font-serif text-2xl text-foreground">{fields.startupName || build.startupName}</h2>
            <p className="mt-0.5 text-xs text-muted-foreground">Review &amp; edit, then commit to the Summary Sheet tab.</p>
          </div>
          {build.hasFathom && (
            <button onClick={() => rerun.mutate()} disabled={rerun.isPending}
              className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-3 py-1.5 text-xs font-medium hover:bg-muted disabled:opacity-60">
              {rerun.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />} Re-run AI
            </button>
          )}
        </div>

        {/* From the T-Sheet */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Field label="Startup Name"><input value={fields.startupName} onChange={e => set("startupName", e.target.value)} className="w-full px-3 py-2 bg-background border border-input rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-ring/20" /></Field>
          <Field label="Founder"><input value={fields.founder} onChange={e => set("founder", e.target.value)} className="w-full px-3 py-2 bg-background border border-input rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-ring/20" /></Field>
          <Field label="Host"><input value={fields.host} onChange={e => set("host", e.target.value)} className="w-full px-3 py-2 bg-background border border-input rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-ring/20" /></Field>
          <Field label="Co-Host"><input value={fields.coHost} onChange={e => set("coHost", e.target.value)} className="w-full px-3 py-2 bg-background border border-input rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-ring/20" /></Field>
        </div>
        <Field label="Goal"><textarea value={fields.goal} onChange={e => set("goal", e.target.value)} rows={2} className="w-full px-3 py-2 bg-background border border-input rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-ring/20" /></Field>

        {/* Dropdowns */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Field label="Industry" hint="Pick a chip or type your own"><ChipSelect value={fields.industry} onChange={v => set("industry", v)} options={INDUSTRY_OPTIONS} /></Field>
          <Field label="TG (Target Group)" hint="Pick a chip or type your own"><ChipSelect value={fields.tg} onChange={v => set("tg", v)} options={TG_OPTIONS} /></Field>
          <Field label="Funding"><ChipSelect value={fields.funding} onChange={v => set("funding", v)} options={FUNDING_OPTIONS} allowCustom={false} /></Field>
        </div>

        {/* VP dates (from Sprint Tracking, editable) */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Field label="VP1 Date" hint="Looked up from Sprint Tracking"><input type="date" value={fields.vp1Date ?? ""} onChange={e => set("vp1Date", e.target.value || null)} className="w-full px-3 py-2 bg-background border border-input rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-ring/20" /></Field>
          <Field label="VP2 Date" hint="Looked up from Sprint Tracking"><input type="date" value={fields.vp2Date ?? ""} onChange={e => set("vp2Date", e.target.value || null)} className="w-full px-3 py-2 bg-background border border-input rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-ring/20" /></Field>
        </div>

        {/* AI-extracted (editable) */}
        <div className="grid grid-cols-1 gap-4">
          <Field label="Current Revenue / ARR"><input value={fields.currentRevenueArr} onChange={e => set("currentRevenueArr", e.target.value)} className="w-full px-3 py-2 bg-background border border-input rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-ring/20" /></Field>
          <Field label="Industry Detail"><textarea value={fields.industryDetail} onChange={e => set("industryDetail", e.target.value)} rows={2} className="w-full px-3 py-2 bg-background border border-input rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-ring/20" /></Field>
          <Field label="Critical Venture"><textarea value={fields.criticalVenture} onChange={e => set("criticalVenture", e.target.value)} rows={2} className="w-full px-3 py-2 bg-background border border-input rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-ring/20" /></Field>
          <Field label="TS Connects" hint="Market-access introductions"><textarea value={fields.tsConnects} onChange={e => set("tsConnects", e.target.value)} rows={2} className="w-full px-3 py-2 bg-background border border-input rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-ring/20" /></Field>
          <Field label="TS Support" hint="Support beyond connects"><textarea value={fields.tsSupport} onChange={e => set("tsSupport", e.target.value)} rows={2} className="w-full px-3 py-2 bg-background border border-input rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-ring/20" /></Field>
          <Field label="Notes" hint="Internal — not sent anywhere"><textarea value={fields.notes} onChange={e => set("notes", e.target.value)} rows={2} className="w-full px-3 py-2 bg-background border border-input rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-ring/20" /></Field>
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-border pt-4">
          <button onClick={() => save.mutate()} disabled={save.isPending}
            className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-3 py-2 text-sm font-medium hover:bg-muted disabled:opacity-60">
            {save.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Save
          </button>
          <button onClick={() => commit.mutate()} disabled={commit.isPending}
            className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50">
            {commit.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
            {committed ? "Re-commit to Summary Sheet" : "Commit to Summary Sheet"}
          </button>
        </div>
      </div>
    </section>
  );
}
