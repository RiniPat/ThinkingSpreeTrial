import { useState, useRef } from "react";
import { Layout } from "@/components/Layout";
import { useGetMe } from "@workspace/api-client-react";
import { useToast } from "@/hooks/use-toast";
import { useQueryClient } from "@tanstack/react-query";
import {
  Upload, FileSpreadsheet, CheckCircle2, Loader2, AlertCircle,
  FileText, Sparkles, RefreshCw, Database,
} from "lucide-react";
import { Redirect } from "wouter";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

type UploadKind = "auto" | "isb-summary" | "ju-summary" | "sheet-tracking";
type ImportResult = {
  kind: string;
  fileName: string;
  result: { imported: number; skipped: number; existing?: number };
};

const SHEET_TYPES: { kind: UploadKind; label: string; hint: string }[] = [
  { kind: "auto",           label: "Auto-detect",      hint: "Look at the headers and figure it out" },
  { kind: "isb-summary",    label: "ISB Summary",      hint: "ISB IVI venture summary export" },
  { kind: "ju-summary",     label: "JU Summary",       hint: "Jadavpur University venture summary" },
  { kind: "sheet-tracking", label: "Sheet Tracking",   hint: "All-sprints tracking log" },
];

export default function AdminImportPage() {
  const { data: user, isLoading } = useGetMe();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [kind, setKind] = useState<UploadKind>("auto");
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [recentImports, setRecentImports] = useState<ImportResult[]>([]);
  const [dragging, setDragging] = useState(false);
  const [reseeding, setReseeding] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  if (isLoading) return <Layout><div className="p-6">Loading…</div></Layout>;
  if (!(user as any)?.isAdmin) return <Redirect to="/dashboard" />;

  async function handleReseed() {
    if (!confirm("Re-run the baked-in seed (the three xlsx files shipped with the repo)? This is safe — append-only.")) return;
    setReseeding(true);
    try {
      const res = await fetch(`${BASE}/api/admin/reseed`, { method: "POST", credentials: "include" });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Reseed failed" }));
        throw new Error(err.error ?? `HTTP ${res.status}`);
      }
      const data = await res.json();
      const lines: string[] = [];
      if (data.isb)      lines.push(`ISB: ${data.isb.imported} new`);
      if (data.ju)       lines.push(`JU: ${data.ju.imported} new`);
      if (data.tracking) lines.push(`Tracking: ${data.tracking.imported} new (${data.tracking.existing ?? 0} existed)`);
      toast({ title: "Re-seed complete", description: lines.join(" · ") || "Done" });
      queryClient.invalidateQueries({ queryKey: ["listIncubators"] });
      queryClient.invalidateQueries({ queryKey: ["listSprints"] });
      queryClient.invalidateQueries({ queryKey: ["listFounders"] });
      queryClient.invalidateQueries({ queryKey: ["/api/sprints"] });
    } catch (err: any) {
      toast({ title: "Re-seed failed", description: err?.message ?? "Unknown error", variant: "destructive" });
    } finally {
      setReseeding(false);
    }
  }

  async function handleUpload() {
    if (!file) return;
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("kind", kind);
      const res = await fetch(`${BASE}/api/admin/import`, {
        method: "POST",
        body: fd,
        credentials: "include",
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Upload failed" }));
        throw new Error(err.error ?? `HTTP ${res.status}`);
      }
      const data: ImportResult = await res.json();
      setRecentImports(r => [data, ...r].slice(0, 5));
      toast({
        title: "Import successful",
        description: `${data.result.imported} new row(s) added` +
          (data.result.existing ? `, ${data.result.existing} already existed` : "") +
          (data.result.skipped ? `, ${data.result.skipped} skipped` : ""),
      });
      // Invalidate caches so the rest of the app picks up the new data
      queryClient.invalidateQueries({ queryKey: ["listIncubators"] });
      queryClient.invalidateQueries({ queryKey: ["listSprints"] });
      queryClient.invalidateQueries({ queryKey: ["listFounders"] });
      setFile(null);
    } catch (err: any) {
      toast({
        title: "Import failed",
        description: err?.message ?? "Unknown error",
        variant: "destructive",
      });
    } finally {
      setUploading(false);
    }
  }

  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragging(false);
    const f = e.dataTransfer.files[0];
    if (f && f.name.toLowerCase().endsWith(".xlsx")) setFile(f);
    else toast({
      title: "Only .xlsx files are accepted",
      variant: "destructive",
    });
  }

  return (
    <Layout>
      <div className="p-6 max-w-4xl mx-auto">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-foreground">Import Data</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Upload the ISB / JU summary sheets or the Sheet Tracking log. Existing rows are kept; new rows are added (append-only).
          </p>
        </div>

        {/* Quick fix — re-run the built-in seed. Use this if Sprint Tracking
            is unexpectedly empty after a deploy. Safe to run anytime since the
            importer is append-only. */}
        <div className="bg-card border border-card-border rounded-xl p-5 mb-4">
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div className="flex items-start gap-3 min-w-0">
              <Database size={18} className="text-primary mt-0.5 flex-shrink-0" />
              <div className="min-w-0">
                <p className="text-sm font-medium text-foreground">Re-run baked-in seed</p>
                <p className="text-xs text-muted-foreground mt-1 leading-relaxed max-w-xl">
                  Re-imports the three xlsx files shipped with the repo (ISB / JU / Sheet Tracking).
                  Use this if a tab looks empty after a deploy. It only adds new rows — never
                  overwrites your existing data.
                </p>
              </div>
            </div>
            <button onClick={handleReseed} disabled={reseeding}
              className="px-4 py-2 bg-primary text-primary-foreground rounded-md text-sm font-medium hover:opacity-90 transition disabled:opacity-50 flex items-center gap-2 flex-shrink-0">
              <RefreshCw size={14} className={reseeding ? "animate-spin" : ""} />
              {reseeding ? "Re-seeding…" : "Re-seed now"}
            </button>
          </div>
        </div>

        {/* Sheet kind picker */}
        <div className="bg-card border border-card-border rounded-xl p-5 mb-4">
          <p className="text-sm font-medium text-foreground mb-3">1. Which sheet are you uploading?</p>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
            {SHEET_TYPES.map(t => (
              <button
                key={t.kind}
                onClick={() => setKind(t.kind)}
                className={`p-3 rounded-lg border text-left transition ${
                  kind === t.kind
                    ? "border-primary bg-primary/5 text-primary"
                    : "border-border hover:border-primary/40 text-foreground"
                }`}
              >
                <div className="flex items-center gap-2 mb-1">
                  {t.kind === "auto" ? <Sparkles size={14} /> : <FileSpreadsheet size={14} />}
                  <span className="text-sm font-medium">{t.label}</span>
                </div>
                <p className="text-[11px] text-muted-foreground leading-snug">{t.hint}</p>
              </button>
            ))}
          </div>
        </div>

        {/* File drop zone */}
        <div className="bg-card border border-card-border rounded-xl p-5 mb-4">
          <p className="text-sm font-medium text-foreground mb-3">2. Choose the file</p>
          <div
            onDragOver={e => { e.preventDefault(); setDragging(true); }}
            onDragLeave={() => setDragging(false)}
            onDrop={onDrop}
            onClick={() => inputRef.current?.click()}
            className={`border-2 border-dashed rounded-lg p-8 text-center cursor-pointer transition ${
              dragging
                ? "border-primary bg-primary/5"
                : file
                  ? "border-emerald-300 bg-emerald-50 dark:bg-emerald-900/10"
                  : "border-border hover:border-primary/40"
            }`}
          >
            <input
              ref={inputRef}
              type="file"
              accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              onChange={e => setFile(e.target.files?.[0] ?? null)}
              className="hidden"
            />
            {file ? (
              <div>
                <CheckCircle2 size={36} className="mx-auto text-emerald-600 dark:text-emerald-400 mb-2" />
                <p className="text-sm font-medium text-foreground">{file.name}</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {(file.size / 1024).toFixed(1)} KB · Click to choose a different file
                </p>
              </div>
            ) : (
              <div>
                <Upload size={36} className="mx-auto text-muted-foreground/50 mb-2" />
                <p className="text-sm font-medium text-foreground">Drag & drop an .xlsx file here</p>
                <p className="text-xs text-muted-foreground mt-1">or click to browse</p>
              </div>
            )}
          </div>
        </div>

        {/* Upload button */}
        <button
          onClick={handleUpload}
          disabled={!file || uploading}
          className="w-full py-2.5 bg-primary text-primary-foreground rounded-md text-sm font-semibold hover:opacity-90 transition disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
        >
          {uploading ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />}
          {uploading ? "Importing…" : "Import this file"}
        </button>

        {/* Recent imports */}
        {recentImports.length > 0 && (
          <div className="bg-card border border-card-border rounded-xl p-5 mt-6">
            <p className="text-sm font-medium text-foreground mb-3 flex items-center gap-2">
              <FileText size={14} /> Recent imports (this session)
            </p>
            <div className="space-y-2">
              {recentImports.map((r, i) => (
                <div key={i} className="flex items-start gap-3 p-3 bg-background rounded-lg border border-border">
                  <CheckCircle2 size={16} className="text-emerald-600 dark:text-emerald-400 mt-0.5 flex-shrink-0" />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-foreground truncate">{r.fileName}</p>
                    <p className="text-xs text-muted-foreground">
                      <span className="text-emerald-700 dark:text-emerald-400 font-medium">{r.result.imported} new</span>
                      {r.result.existing ? <> · <span className="text-amber-700 dark:text-amber-400">{r.result.existing} existed</span></> : null}
                      {r.result.skipped ? <> · <span>{r.result.skipped} skipped</span></> : null}
                      <> · {r.kind}</>
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Info box */}
        <div className="bg-card border border-card-border rounded-xl p-5 mt-6">
          <div className="flex items-start gap-2">
            <AlertCircle size={14} className="text-amber-600 dark:text-amber-400 mt-0.5 flex-shrink-0" />
            <div>
              <p className="text-sm font-medium text-foreground">How append-only works</p>
              <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
                When the same company / sprint already exists in the database, that row is left unchanged.
                Only genuinely new rows are added. To replace data, drop the data from Neon's SQL editor first, then re-upload.
              </p>
            </div>
          </div>
        </div>
      </div>
    </Layout>
  );
}
