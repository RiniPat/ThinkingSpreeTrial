import { useMemo, useState } from "react";
import { Link } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react";
import { Layout } from "@/components/Layout";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import {
  Link2, FileSpreadsheet, Building2, ChevronRight, AlertCircle,
  CheckCircle2, Mail, Loader2, Search, ExternalLink, Trash2,
} from "lucide-react";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

type Company = {
  id: number;
  companyName: string;
  founderName: string;
  founderEmail: string | null;
  cohortId: number | null;
  cohortName: string | null;
  deckUrl: string | null;
  vision: string | null;
  stageWorkflow: "pre_sprint" | "pre_email_sent" | "sprint_done" | "post_email_sent";
  sprintHost: string | null;
  coHost: string | null;
  createdAt: string;
};

type UploadResult = {
  companyId: number;
  isNew: boolean;
  detectedStage: "pre_sprint" | "sprint_done";
  parsed: { companyName: string; founderName: string; cohort: string | null };
  warnings: string[];
};

/**
 * Maps the workflow stage to a small chip + label. Each stage is a single
 * step in the consultant's workflow so the chip doubles as both a status and
 * a hint about the next action.
 */
function StageChip({ stage }: { stage: Company["stageWorkflow"] }) {
  const m: Record<Company["stageWorkflow"], { label: string; cls: string; Icon: React.ElementType }> = {
    pre_sprint:      { label: "Awaiting Pre-Email", cls: "bg-amber-50 text-amber-800 border-amber-200",  Icon: AlertCircle },
    pre_email_sent:  { label: "Pre-Email Sent",     cls: "bg-blue-50 text-primary border-blue-200",      Icon: Mail },
    sprint_done:     { label: "Sprint Done",        cls: "bg-violet-50 text-violet-800 border-violet-200", Icon: CheckCircle2 },
    post_email_sent: { label: "Closed Out",         cls: "bg-emerald-50 text-emerald-700 border-emerald-200", Icon: CheckCircle2 },
  };
  const c = m[stage] ?? m.pre_sprint;
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium ${c.cls}`}>
      <c.Icon className="h-3 w-3" />
      {c.label}
    </span>
  );
}

export default function CompaniesPage() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [sheetUrl, setSheetUrl] = useState("");
  const [search, setSearch] = useState("");
  const [pendingResult, setPendingResult] = useState<UploadResult | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<{ id: number; name: string } | null>(null);
  const [deleteText, setDeleteText] = useState("");

  const { data, isLoading } = useQuery<{ companies: Company[] }>({
    queryKey: ["companies"],
    queryFn: () => customFetch(`${BASE}/api/companies`, { credentials: "include" }),
    staleTime: 10_000,
  });

  /**
   * Sheet ingest mutation. Server pulls the Google Sheet via the consultant's
   * OAuth token, parses it, and creates/updates the company. We get back the
   * same result shape as the old file upload, so downstream UI is unchanged.
   */
  const ingestMutation = useMutation({
    mutationFn: async (url: string) => {
      const res = await fetch(`${BASE}/api/companies/ingest-sheet`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sheetUrl: url }),
      });
      if (!res.ok) {
        const errBody = await res.json().catch(() => ({}));
        throw new Error(errBody?.error || `Sync failed (${res.status})`);
      }
      return (await res.json()) as UploadResult;
    },
    onSuccess: (result) => {
      setPendingResult(result);
      setSheetUrl("");
      qc.invalidateQueries({ queryKey: ["companies"] });
      toast({
        title: result.isNew ? "Company created" : "Company updated",
        description: `${result.parsed.companyName} · ${result.parsed.founderName} · ${result.parsed.cohort ?? "no cohort"}`,
      });
    },
    onError: (err: any) => {
      toast({ title: "Sheet sync failed", description: err.message, variant: "destructive" });
    },
  });

  // Delete mutation with confirmation
  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      const res = await fetch(`${BASE}/api/companies/${id}`, { method: "DELETE", credentials: "include" });
      if (!res.ok) {
        const e = await res.json().catch(() => ({}));
        throw new Error(e?.error || "Delete failed");
      }
      return res.json();
    },
    onSuccess: (data, id) => {
      const name = confirmDelete?.name ?? "Company";
      const events = data?.deleted?.events ?? 0;
      const drafts = data?.deleted?.drafts ?? 0;
      toast({
        title: "Company deleted",
        description: `${name} removed${events || drafts ? ` (${events} timeline events · ${drafts} email drafts cleaned up)` : ""}`,
      });
      setConfirmDelete(null);
      setDeleteText("");
      qc.invalidateQueries({ queryKey: ["companies"] });
    },
    onError: (err: any) => {
      toast({ title: "Delete failed", description: err.message, variant: "destructive" });
    },
  });

  function handleSync() {
    const url = sheetUrl.trim();
    if (!url) {
      toast({ title: "Paste a Google Sheets URL first", variant: "destructive" });
      return;
    }
    ingestMutation.mutate(url);
  }

  // Group companies by cohort, with "Uncategorised" as a fallback bucket.
  const grouped = useMemo(() => {
    const cos = data?.companies ?? [];
    const filtered = search.trim()
      ? cos.filter(c =>
          c.companyName.toLowerCase().includes(search.toLowerCase()) ||
          c.founderName.toLowerCase().includes(search.toLowerCase()) ||
          (c.cohortName ?? "").toLowerCase().includes(search.toLowerCase()))
      : cos;
    const map = new Map<string, Company[]>();
    for (const c of filtered) {
      const key = c.cohortName ?? "Uncategorised";
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(c);
    }
    return Array.from(map.entries()).sort(([a], [b]) => {
      if (a === "Uncategorised") return 1;
      if (b === "Uncategorised") return -1;
      return a.localeCompare(b);
    });
  }, [data, search]);

  return (
    <Layout>
      <main className="flex-1 space-y-6 px-6 py-8 lg:px-10 max-w-[1400px] mx-auto">
        {/* Header */}
        <section className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <div className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Workspace</div>
            <h1 className="mt-2 font-serif text-4xl text-foreground">Companies</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Paste a Google Sheets link to add or update a company. Companies are grouped by cohort.
            </p>
          </div>
        </section>

        {/* Sheet URL ingest zone */}
        <section className="rounded-xl border border-border bg-card p-6">
          <div className="flex items-start gap-4">
            <div className="hidden sm:flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 flex-shrink-0">
              <FileSpreadsheet className="h-6 w-6 text-primary" />
            </div>
            <div className="min-w-0 flex-1">
              <h2 className="font-serif text-2xl text-foreground">Link a Google Sheet</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Paste the URL of your filled Sprint Template Google Sheet.
                It must be shared with your Google account (any access ≥ Viewer)
                or set to "Anyone with the link".
              </p>

              <div className="mt-4 flex flex-col sm:flex-row gap-2">
                <div className="relative flex-1">
                  <Link2 className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <input
                    type="url"
                    value={sheetUrl}
                    onChange={(e) => setSheetUrl(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") handleSync(); }}
                    placeholder="https://docs.google.com/spreadsheets/d/1Abc.../edit"
                    disabled={ingestMutation.isPending}
                    className="w-full pl-9 pr-4 py-2.5 bg-background border border-input rounded-md text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring/20 focus:border-ring transition disabled:opacity-60"
                  />
                </div>
                <button
                  onClick={handleSync}
                  disabled={ingestMutation.isPending || !sheetUrl.trim()}
                  className="inline-flex items-center justify-center gap-2 rounded-md bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed transition whitespace-nowrap"
                >
                  {ingestMutation.isPending ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Syncing…
                    </>
                  ) : (
                    <>
                      <FileSpreadsheet className="h-4 w-4" />
                      Pull Data from Sheet
                    </>
                  )}
                </button>
              </div>

              <p className="mt-2 text-[11px] text-muted-foreground">
                Required sheet tabs: <strong>Overview</strong>. Required fields: Company Name, Founder's Name.
                Other tabs (SWOT, Funding, etc.) are read automatically if filled.
              </p>
            </div>
          </div>
        </section>

        {/* Recent upload result panel */}
        {pendingResult && (
          <section className="rounded-xl border border-emerald-200 bg-emerald-50 p-5 dark:bg-emerald-900/20 dark:border-emerald-900/50">
            <div className="flex items-start justify-between gap-4">
              <div className="flex items-start gap-3">
                <CheckCircle2 className="h-5 w-5 text-emerald-700 mt-0.5 flex-shrink-0" />
                <div>
                  <h3 className="font-medium text-foreground">
                    {pendingResult.isNew ? "New company added" : "Company updated"}: {pendingResult.parsed.companyName}
                  </h3>
                  <p className="mt-0.5 text-sm text-muted-foreground">
                    Detected stage: <strong>{pendingResult.detectedStage === "pre_sprint" ? "Pre-sprint" : "Post-sprint"}</strong>.
                    {" "}Open the company page to generate the {pendingResult.detectedStage === "pre_sprint" ? "pre" : "post"}-sprint email.
                  </p>
                  {pendingResult.warnings.length > 0 && (
                    <ul className="mt-2 list-disc pl-5 text-xs text-amber-800">
                      {pendingResult.warnings.map((w, i) => <li key={i}>{w}</li>)}
                    </ul>
                  )}
                </div>
              </div>
              <Link href={`/companies/${pendingResult.companyId}`}>
                <a className="inline-flex items-center gap-1 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:opacity-90">
                  Open <ChevronRight className="h-3 w-3" />
                </a>
              </Link>
            </div>
          </section>
        )}

        {/* Search */}
        <section>
          <div className="relative max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <input
              type="text"
              placeholder="Search by company, founder, or cohort"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-9 pr-4 py-2 bg-card border border-input rounded-md text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring/20 focus:border-ring transition"
            />
          </div>
        </section>

        {/* Cohort sections */}
        {isLoading ? (
          <div className="space-y-4">
            {[1, 2].map(i => <Skeleton key={i} className="h-32 rounded-xl" />)}
          </div>
        ) : grouped.length === 0 ? (
          <section className="rounded-xl border border-border bg-card p-12 text-center">
            <Building2 className="mx-auto h-10 w-10 text-muted-foreground/40" />
            <h3 className="mt-3 font-serif text-xl text-foreground">No companies yet</h3>
            <p className="mt-1 text-sm text-muted-foreground">
              Upload a Sprint Template above to get started.
            </p>
          </section>
        ) : (
          <div className="space-y-6">
            {grouped.map(([cohort, companies]) => (
              <section key={cohort} className="rounded-xl border border-border bg-card overflow-hidden">
                <header className="flex items-center justify-between border-b border-border px-6 py-3 bg-muted/30">
                  <div className="flex items-center gap-2.5">
                    <Building2 className="h-4 w-4 text-muted-foreground" />
                    <h2 className="font-medium text-foreground">{cohort}</h2>
                    <span className="rounded-full bg-background border border-border px-2 py-0.5 text-[11px] text-muted-foreground">
                      {companies.length} {companies.length === 1 ? "company" : "companies"}
                    </span>
                  </div>
                </header>
                <ul className="divide-y divide-border">
                  {companies.map(c => (
                    <li key={c.id} className="relative group">
                      {/* Row content is wrapped in a Link, but the delete button
                          intercepts the click via stopPropagation so it doesn't
                          bubble up and navigate the user away. */}
                      <Link href={`/companies/${c.id}`}>
                        <a className="flex items-center gap-5 px-6 py-4 transition-colors hover:bg-muted/30 cursor-pointer">
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="font-medium text-foreground">{c.companyName}</span>
                              {c.deckUrl && (
                                <ExternalLink className="h-3 w-3 text-muted-foreground" />
                              )}
                            </div>
                            <div className="mt-0.5 text-xs text-muted-foreground">
                              {c.founderName}
                              {c.founderEmail && !c.founderEmail.includes("@placeholder.local") && (
                                <> · {c.founderEmail}</>
                              )}
                              {c.sprintHost && <> · Host: {c.sprintHost}</>}
                            </div>
                          </div>
                          <StageChip stage={c.stageWorkflow} />
                          {/* Reserve space for the delete button so the chip
                              doesn't jump when hovering. */}
                          <span className="w-8" />
                          <ChevronRight className="h-4 w-4 text-muted-foreground" />
                        </a>
                      </Link>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          setConfirmDelete({ id: c.id, name: c.companyName });
                          setDeleteText("");
                        }}
                        className="absolute right-14 top-1/2 -translate-y-1/2 rounded-md p-1.5 text-muted-foreground opacity-0 transition-all hover:bg-destructive/10 hover:text-destructive group-hover:opacity-100 focus:opacity-100"
                        aria-label={`Delete ${c.companyName}`}
                        title="Delete company"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
        )}

        <footer className="pt-2 text-center text-xs text-muted-foreground">
          Thinking Spree · Consultant Suite v4.4
        </footer>
      </main>

      {/* Delete confirmation dialog — requires typing "DELETE" to confirm.
          The two-step UX is intentional: this action is irreversible and
          cascades to email drafts + timeline events. */}
      {confirmDelete && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ background: "rgba(15, 23, 42, 0.55)", backdropFilter: "blur(4px)" }}
          onMouseDown={(e) => {
            if (e.target === e.currentTarget && !deleteMutation.isPending) {
              setConfirmDelete(null);
              setDeleteText("");
            }
          }}
        >
          <div
            className="w-full max-w-md rounded-xl border border-border bg-card shadow-2xl"
            onMouseDown={(e) => e.stopPropagation()}
          >
            <header className="flex items-start gap-3 border-b border-border px-6 py-4">
              <div className="rounded-md bg-destructive/10 p-2 flex-shrink-0">
                <AlertCircle className="h-5 w-5 text-destructive" />
              </div>
              <div>
                <h2 className="font-serif text-xl text-foreground">Delete company permanently?</h2>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  This cannot be undone.
                </p>
              </div>
            </header>
            <div className="px-6 py-4 space-y-3 text-sm text-foreground">
              <p>
                You're about to delete <strong>{confirmDelete.name}</strong>. This will also
                remove:
              </p>
              <ul className="list-disc pl-5 text-muted-foreground space-y-1">
                <li>All timeline events (uploads, sends, completions)</li>
                <li>All saved email drafts for this company</li>
                <li>All parsed sprint data</li>
              </ul>
              <p className="text-xs text-muted-foreground">
                Type <span className="font-mono font-semibold text-foreground">DELETE</span> below to confirm.
              </p>
              <input
                type="text"
                value={deleteText}
                onChange={(e) => setDeleteText(e.target.value)}
                placeholder="DELETE"
                autoFocus
                disabled={deleteMutation.isPending}
                className="w-full px-3 py-2 bg-background border border-input rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-destructive/30 focus:border-destructive font-mono"
              />
            </div>
            <footer className="flex items-center justify-end gap-2 border-t border-border px-6 py-3 bg-muted/30">
              <button
                onClick={() => {
                  if (!deleteMutation.isPending) {
                    setConfirmDelete(null);
                    setDeleteText("");
                  }
                }}
                disabled={deleteMutation.isPending}
                className="rounded-md border border-border bg-background px-3 py-1.5 text-xs font-medium text-foreground hover:bg-muted disabled:opacity-60"
              >
                Cancel
              </button>
              <button
                onClick={() => deleteMutation.mutate(confirmDelete.id)}
                disabled={deleteMutation.isPending || deleteText !== "DELETE"}
                className="inline-flex items-center gap-1.5 rounded-md bg-destructive px-3 py-1.5 text-xs font-medium text-destructive-foreground hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {deleteMutation.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                Delete permanently
              </button>
            </footer>
          </div>
        </div>
      )}
    </Layout>
  );
}
