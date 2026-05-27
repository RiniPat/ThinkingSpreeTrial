import { useMemo, useRef, useState } from "react";
import { Link } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react";
import { Layout } from "@/components/Layout";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import {
  Upload, FileSpreadsheet, Building2, ChevronRight, AlertCircle,
  CheckCircle2, Mail, Loader2, Search, ExternalLink, Plus,
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
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);
  const [search, setSearch] = useState("");
  const [pendingResult, setPendingResult] = useState<UploadResult | null>(null);

  const { data, isLoading } = useQuery<{ companies: Company[] }>({
    queryKey: ["companies"],
    queryFn: () => customFetch(`${BASE}/api/companies`, { credentials: "include" }),
    staleTime: 10_000,
  });

  /**
   * Upload mutation. multipart/form-data, hits /api/companies/upload-template,
   * shows a result toast + opens a small "what next" panel for the consultant.
   */
  const uploadMutation = useMutation({
    mutationFn: async (file: File) => {
      const form = new FormData();
      form.append("file", file);
      // We rely on the server to read the cohort from the Excel — no override yet.
      const res = await fetch(`${BASE}/api/companies/upload-template`, {
        method: "POST",
        credentials: "include",
        body: form,
      });
      if (!res.ok) {
        const errBody = await res.json().catch(() => ({}));
        throw new Error(errBody?.error || `Upload failed (${res.status})`);
      }
      return (await res.json()) as UploadResult;
    },
    onSuccess: (result) => {
      setPendingResult(result);
      qc.invalidateQueries({ queryKey: ["companies"] });
      toast({
        title: result.isNew ? "Company created" : "Company updated",
        description: `${result.parsed.companyName} · ${result.parsed.founderName} · ${result.parsed.cohort ?? "no cohort"}`,
      });
    },
    onError: (err: any) => {
      toast({ title: "Upload failed", description: err.message, variant: "destructive" });
    },
  });

  function handleFile(file: File | null) {
    if (!file) return;
    if (!file.name.toLowerCase().endsWith(".xlsx")) {
      toast({ title: "Wrong file type", description: "Please upload an .xlsx file", variant: "destructive" });
      return;
    }
    uploadMutation.mutate(file);
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
              Upload a Sprint Template to add or update a company. Companies are grouped by cohort.
            </p>
          </div>
        </section>

        {/* Upload zone */}
        <section
          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragOver(false);
            const f = e.dataTransfer.files?.[0];
            if (f) handleFile(f);
          }}
          className={
            "relative rounded-xl border-2 border-dashed p-8 text-center transition-colors " +
            (dragOver
              ? "border-primary bg-primary/5"
              : "border-border bg-card hover:border-muted-foreground/30")
          }
        >
          <input
            ref={fileInputRef}
            type="file"
            accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            className="hidden"
            onChange={(e) => handleFile(e.target.files?.[0] ?? null)}
          />
          {uploadMutation.isPending ? (
            <div className="flex flex-col items-center gap-2">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
              <p className="text-sm text-foreground">Parsing template...</p>
            </div>
          ) : (
            <>
              <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
                <FileSpreadsheet className="h-6 w-6 text-primary" />
              </div>
              <h2 className="mt-3 font-serif text-2xl text-foreground">Upload Sprint Template</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Drop a filled <code className="px-1 py-0.5 bg-muted rounded text-xs">.xlsx</code> file here,
                or click below to browse.
              </p>
              <button
                onClick={() => fileInputRef.current?.click()}
                className="mt-4 inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 transition"
              >
                <Upload className="h-4 w-4" />
                Choose File
              </button>
              <p className="mt-3 text-[11px] text-muted-foreground">
                Required fields: Company Name, Founder's Name. Cohort &amp; deck link recommended.
              </p>
            </>
          )}
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
                    <li key={c.id}>
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
                          <ChevronRight className="h-4 w-4 text-muted-foreground" />
                        </a>
                      </Link>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
        )}

        <footer className="pt-2 text-center text-xs text-muted-foreground">
          Thinking Spree · Consultant Suite v4.2
        </footer>
      </main>
    </Layout>
  );
}
