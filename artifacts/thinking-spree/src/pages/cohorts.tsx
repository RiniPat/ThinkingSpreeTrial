// artifacts/thinking-spree/src/pages/cohorts.tsx
//
// Cohorts index — list of all cohorts the consultant has access to.
// Click a row to open the detail page.
//
// Wire into your Wouter router:
//   <Route path="/cohorts" component={CohortsPage} />
//   <Route path="/cohorts/:slug" component={CohortDetailPage} />

import { Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { ArrowUpRight, Layers, RefreshCw } from "lucide-react";
import { Card } from "@/components/ui/card";

type CohortRow = {
    id: number;
    name: string;
    slug: string;
    description: string | null;
    sourceSheetUrl: string | null;
    lastSyncedAt: string | null;
    lastSyncError: string | null;
    companyCount: number;
};

export default function CohortsPage() {
    const q = useQuery({
        queryKey: ["cohorts"],
        queryFn: async (): Promise<CohortRow[]> => {
            const r = await fetch("/api/cohorts");
            if (!r.ok) throw new Error("Failed to load cohorts");
            const j = (await r.json()) as { cohorts: CohortRow[] };
            return j.cohorts;
        },
    });

    return (
        <div className="max-w-5xl mx-auto p-6 space-y-6">
            <header className="flex items-end justify-between">
                <div>
                    <h1 className="font-serif text-3xl">Cohorts</h1>
                    <p className="text-sm text-muted-foreground mt-1">
                        Grouped sets of companies. Cohorts bound to a source sheet stay in
                        sync automatically.
                    </p>
                </div>
            </header>

            {q.isLoading ? (
                <p className="text-sm text-muted-foreground">Loading cohorts…</p>
            ) : q.error ? (
                <p className="text-sm text-destructive">{(q.error as Error).message}</p>
            ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {q.data?.map((c) => (
                        <CohortCard key={c.id} cohort={c} />
                    ))}
                </div>
            )}
        </div>
    );
}

function CohortCard({ cohort }: { cohort: CohortRow }) {
    const synced = cohort.lastSyncedAt
        ? new Date(cohort.lastSyncedAt).toLocaleString(undefined, {
            month: "short",
            day: "numeric",
            hour: "numeric",
            minute: "2-digit",
        })
        : null;

    return (
        <Link href={`/cohorts/${cohort.slug}`}>
            <Card className="group hover:border-primary/40 transition-colors cursor-pointer p-5">
                <div className="flex items-start justify-between gap-3">
                    <div className="flex items-start gap-3 min-w-0">
                        <div className="h-9 w-9 rounded-md bg-secondary flex items-center justify-center shrink-0">
                            <Layers className="h-4 w-4" />
                        </div>
                        <div className="min-w-0">
                            <h3 className="font-serif text-lg leading-tight truncate">{cohort.name}</h3>
                            {cohort.description ? (
                                <p className="text-xs text-muted-foreground mt-1 line-clamp-2">
                                    {cohort.description}
                                </p>
                            ) : null}
                        </div>
                    </div>
                    <ArrowUpRight className="h-4 w-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />
                </div>

                <div className="flex items-center gap-4 mt-4 text-xs text-muted-foreground">
                    <span className="font-mono">
                        <span className="text-foreground font-medium">{cohort.companyCount}</span> companies
                    </span>
                    {cohort.sourceSheetUrl ? (
                        <span className="inline-flex items-center gap-1.5">
                            <RefreshCw className="h-3 w-3" />
                            {cohort.lastSyncError
                                ? <span className="text-destructive">Sync error</span>
                                : synced
                                    ? `Synced ${synced}`
                                    : "Never synced"}
                        </span>
                    ) : (
                        <span className="text-muted-foreground/70">Manual</span>
                    )}
                </div>
            </Card>
        </Link>
    );
}
