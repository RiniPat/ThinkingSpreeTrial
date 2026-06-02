// artifacts/thinking-spree/src/pages/cohort-detail.tsx
//
// Cohort detail page — companies in this cohort, sync status, and a
// "sync now" button (for admins). For the Wadhwani Foundation cohort,
// this is the screen consultants land on from the sidebar.
//
// URL: /cohorts/:slug

import { useState } from "react";
import { Link, useParams } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
    AlertCircle,
    CheckCircle2,
    ChevronRight,
    Loader2,
    Mail,
    Plus,
    RefreshCw,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

type CohortDetail = {
    cohort: {
        id: number;
        name: string;
        slug: string;
        description: string | null;
        sourceSheetUrl: string | null;
        lastSyncedAt: string | null;
        lastSyncError: string | null;
    };
    companies: Array<{
        id: number;
        name: string;
        addedAt: string;
        source: "manual" | "sheet-sync";
        // ADAPT: extend with whatever fields your founders table exposes
    }>;
};

export default function CohortDetailPage() {
    const params = useParams<{ slug: string }>();
    const slug = params.slug;
    const qc = useQueryClient();
    const [showSyncBanner, setShowSyncBanner] = useState<string | null>(null);

    const q = useQuery({
        queryKey: ["cohort", slug],
        queryFn: async (): Promise<CohortDetail> => {
            const r = await fetch(`/api/cohorts/${slug}`);
            if (!r.ok) throw new Error("Failed to load cohort");
            return r.json();
        },
    });

    const syncMutation = useMutation({
        mutationFn: async (cohortId: number) => {
            const r = await fetch(`/api/cohorts/${cohortId}/sync`, { method: "POST" });
            const j = await r.json();
            if (!r.ok) throw new Error(j.error ?? "Sync failed");
            return j as { added: number; skipped: number; unresolved: string[] };
        },
        onSuccess: (result) => {
            const parts = [`${result.added} added`, `${result.skipped} already present`];
            if (result.unresolved.length) parts.push(`${result.unresolved.length} unresolved`);
            setShowSyncBanner(parts.join(" · "));
            qc.invalidateQueries({ queryKey: ["cohort", slug] });
            qc.invalidateQueries({ queryKey: ["cohorts"] });
        },
        onError: (err) => {
            setShowSyncBanner(`Sync failed: ${(err as Error).message}`);
        },
    });

    if (q.isLoading) return <div className="p-6 text-sm text-muted-foreground">Loading cohort…</div>;
    if (q.error) return <div className="p-6 text-sm text-destructive">{(q.error as Error).message}</div>;
    if (!q.data) return null;

    const { cohort, companies } = q.data;
    const lastSynced = cohort.lastSyncedAt
        ? formatRelativeTime(new Date(cohort.lastSyncedAt))
        : null;

    return (
        <div className="max-w-6xl mx-auto p-6 space-y-5">
            {/* Breadcrumb */}
            <nav className="flex items-center gap-1 text-xs text-muted-foreground">
                <Link href="/cohorts" className="hover:text-foreground">
                    Cohorts
                </Link>
                <ChevronRight className="h-3 w-3" />
                <span className="text-foreground">{cohort.name}</span>
            </nav>

            {/* Header */}
            <header className="flex flex-wrap items-end justify-between gap-3">
                <div>
                    <h1 className="font-serif text-3xl">{cohort.name}</h1>
                    {cohort.description ? (
                        <p className="text-sm text-muted-foreground mt-1 max-w-2xl">
                            {cohort.description}
                        </p>
                    ) : null}
                </div>
                <div className="flex items-center gap-2">
                    <Button variant="outline" size="sm">
                        <Mail className="h-3.5 w-3.5 mr-1.5" /> Email cohort
                    </Button>
                    <Button variant="outline" size="sm">
                        <Plus className="h-3.5 w-3.5 mr-1.5" /> Add company
                    </Button>
                </div>
            </header>

            {/* Sync status banner */}
            {cohort.sourceSheetUrl ? (
                <div
                    className={
                        "rounded-md border px-4 py-3 flex items-center gap-3 text-sm " +
                        (cohort.lastSyncError
                            ? "border-destructive/30 bg-destructive/5"
                            : "border-emerald-200/60 bg-emerald-50/60 dark:bg-emerald-950/20 dark:border-emerald-900/40")
                    }
                >
                    {cohort.lastSyncError ? (
                        <AlertCircle className="h-4 w-4 text-destructive shrink-0" />
                    ) : (
                        <CheckCircle2 className="h-4 w-4 text-emerald-700 dark:text-emerald-400 shrink-0" />
                    )}
                    <div className="flex-1 min-w-0">
                        {cohort.lastSyncError ? (
                            <p className="text-destructive">
                                Last sync failed: <span className="font-medium">{cohort.lastSyncError}</span>
                            </p>
                        ) : (
                            <p className="text-emerald-900 dark:text-emerald-300">
                                Live-synced from source sheet
                                {lastSynced ? <> · updated {lastSynced}</> : null}
                            </p>
                        )}
                        <p className="text-xs text-muted-foreground truncate mt-0.5">
                            <a
                                href={cohort.sourceSheetUrl}
                                target="_blank"
                                rel="noreferrer"
                                className="hover:underline"
                            >
                                {cohort.sourceSheetUrl}
                            </a>
                        </p>
                    </div>
                    <Button
                        size="sm"
                        variant="outline"
                        onClick={() => syncMutation.mutate(cohort.id)}
                        disabled={syncMutation.isPending}
                    >
                        {syncMutation.isPending ? (
                            <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                        ) : (
                            <RefreshCw className="h-3.5 w-3.5 mr-1.5" />
                        )}
                        Sync now
                    </Button>
                </div>
            ) : (
                <div className="rounded-md border bg-muted/40 px-4 py-3 text-sm text-muted-foreground">
                    Manual cohort — no source sheet attached. Companies stay until removed
                    manually. <Link href={`/admin/cohorts/${cohort.slug}`} className="underline">
                        Attach a sheet
                    </Link>
                </div>
            )}

            {/* Sync result banner */}
            {showSyncBanner ? (
                <div className="rounded-md border bg-secondary px-4 py-2 text-sm flex items-center justify-between">
                    <span>{showSyncBanner}</span>
                    <button
                        className="text-xs text-muted-foreground hover:text-foreground"
                        onClick={() => setShowSyncBanner(null)}
                    >
                        Dismiss
                    </button>
                </div>
            ) : null}

            {/* Metric cards */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <Metric label="Companies" value={companies.length} />
                <Metric label="From sheet sync" value={companies.filter((c) => c.source === "sheet-sync").length} />
                <Metric label="Added manually" value={companies.filter((c) => c.source === "manual").length} />
                <Metric label="Last 7 days" value={countWithin(companies, 7)} />
            </div>

            {/* Companies table */}
            <Card className="p-0 overflow-hidden">
                <div className="grid grid-cols-[1.6fr_1fr_0.7fr] gap-3 px-4 py-2.5 text-xs uppercase tracking-wider text-muted-foreground bg-muted/40 border-b">
                    <div>Company</div>
                    <div>Added</div>
                    <div>Source</div>
                </div>
                {companies.length === 0 ? (
                    <p className="p-8 text-center text-sm text-muted-foreground">
                        No companies yet. {cohort.sourceSheetUrl ? "Click \u201cSync now\u201d to pull from the sheet." : "Add some manually."}
                    </p>
                ) : (
                    companies.map((c) => (
                        <Link
                            key={c.id}
                            href={`/companies/${c.id}`}
                            className="grid grid-cols-[1.6fr_1fr_0.7fr] gap-3 px-4 py-3 text-sm border-b last:border-b-0 hover:bg-muted/30 transition-colors"
                        >
                            <div className="font-medium truncate">{c.name}</div>
                            <div className="text-muted-foreground">
                                {formatRelativeTime(new Date(c.addedAt))}
                            </div>
                            <div>
                                <Badge
                                    variant="outline"
                                    className={
                                        c.source === "sheet-sync"
                                            ? "border-primary/30 text-primary"
                                            : "text-muted-foreground"
                                    }
                                >
                                    {c.source === "sheet-sync" ? "Sheet sync" : "Manual"}
                                </Badge>
                            </div>
                        </Link>
                    ))
                )}
            </Card>

            <p className="text-xs text-muted-foreground">
                Any company added to the source sheet auto-appears here and on the Summary tab within the next sync window.
            </p>
        </div>
    );
}

function Metric({ label, value }: { label: string; value: number }) {
    return (
        <div className="rounded-md bg-muted/40 px-4 py-3">
            <p className="text-xs text-muted-foreground">{label}</p>
            <p className="font-serif text-2xl mt-0.5">{value}</p>
        </div>
    );
}

function countWithin(companies: Array<{ addedAt: string }>, days: number): number {
    const cutoff = Date.now() - days * 86_400_000;
    return companies.filter((c) => new Date(c.addedAt).getTime() >= cutoff).length;
}

function formatRelativeTime(d: Date): string {
    const diff = Date.now() - d.getTime();
    const minutes = Math.round(diff / 60_000);
    if (minutes < 1) return "just now";
    if (minutes < 60) return `${minutes} min ago`;
    const hours = Math.round(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.round(hours / 24);
    if (days < 7) return `${days}d ago`;
    return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}
