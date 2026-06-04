/**
 * Clean the Sheet dialog (Company page).
 *
 * The consultant pastes the post-sprint Fathom transcript; we POST it to
 * /companies/:id/clean-sheet, which uses AI to organise it into the company's
 * Google Sheet ("Actions taken so far" + Target Audience + suggestions below
 * the pink line). We then show a short report of what was written.
 *
 * Nothing in the sheet is deleted — notes are appended. The consultant should
 * review the live sheet afterwards (we surface an "Open Sheet" link).
 */
import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Wand2, Loader2, X, CheckCircle2, ExternalLink, Lightbulb, AlertCircle, ListChecks, Users2, Copy,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

export type Report = {
  spreadsheetId: string;
  wrote: boolean;
  writeError: string | null;
  actionsWritten: number;
  ideasTouched: string[];
  audienceRowsAdded: number;
  suggestionsAdded: number;
  targetTabFound: boolean;
  actionBlocks: { idea: string; row: number; block: string }[];
  unmatched: { idea: string; additions: string[] }[];
  extracted: {
    actions: { idea: string; additions: string[] }[];
    targetAudience: { audience: string; useCases: string; channels: string; recommendations: string }[];
    suggestions: string[];
  };
};

type Props = {
  companyId: number;
  companyName: string;
  open: boolean;
  sheetUrl: string | null;
  onClose: () => void;
  onDone?: () => void;
};

export function CleanSheetDialog({ companyId, companyName, open, sheetUrl, onClose, onDone }: Props) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [transcript, setTranscript] = useState("");
  const [fathomLink, setFathomLink] = useState("");
  const [report, setReport] = useState<Report | null>(null);

  const runMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`${BASE}/api/companies/${companyId}/clean-sheet`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ transcript, fathomLink }),
      });
      if (!res.ok) {
        const e = await res.json().catch(() => ({}));
        throw new Error(e?.error || `Clean failed (${res.status})`);
      }
      return res.json() as Promise<{ report: Report; sheetUrl: string }>;
    },
    onSuccess: (data) => {
      setReport(data.report);
      toast({
        title: data.report.wrote ? "Sheet cleaned" : "Cleaned — saved to dashboard",
        description: data.report.wrote
          ? `Wrote ${data.report.actionsWritten} idea note(s), ${data.report.audienceRowsAdded} audience row(s), ${data.report.suggestionsAdded} suggestion(s) to the sheet.`
          : "Couldn't edit the Google Sheet — recommendations saved to this company's dashboard.",
        variant: data.report.wrote ? undefined : "destructive",
      });
      qc.invalidateQueries({ queryKey: ["company", companyId] });
      onDone?.();
    },
    onError: (err: any) => toast({ title: "Clean failed", description: err.message, variant: "destructive" }),
  });

  if (!open) return null;
  const busy = runMutation.isPending;
  const wordCount = transcript.trim() ? transcript.trim().split(/\s+/).length : 0;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: "rgba(15, 23, 42, 0.55)", backdropFilter: "blur(4px)" }}
      onMouseDown={(e) => { if (e.target === e.currentTarget && !busy) onClose(); }}
    >
      <div className="relative w-full max-w-3xl rounded-xl border border-border bg-card shadow-2xl"
           onMouseDown={(e) => e.stopPropagation()}>
        {/* Header */}
        <header className="flex items-start justify-between gap-4 border-b border-border px-6 py-4">
          <div className="flex items-start gap-3">
            <div className="rounded-md bg-primary/10 p-2"><Wand2 className="h-4 w-4 text-primary" /></div>
            <div>
              <h2 className="font-serif text-2xl text-foreground">Clean the Sheet</h2>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {companyName} · organise the Fathom transcript into the T-Sheet
              </p>
            </div>
          </div>
          <button onClick={() => !busy && onClose()} className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground">
            <X className="h-4 w-4" />
          </button>
        </header>

        <div className="max-h-[calc(100vh-16rem)] overflow-y-auto px-6 py-5 space-y-4">
          {!report ? (
            <>
              <div className="rounded-md border border-border bg-muted/30 px-3 py-2.5 text-xs text-muted-foreground leading-relaxed">
                Paste the post-sprint Fathom transcript. The AI condenses it into 3–4 word phrases and appends them to
                the <span className="font-medium text-foreground">Actions taken so far</span> column (per Idea/Product),
                fills the <span className="font-medium text-foreground">Target Audience</span> tab, and lists anything
                still missing <span className="font-medium text-foreground">below the pink line</span>. Existing content is never deleted.
              </div>

              <div>
                <label className="mb-1.5 block text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  Fathom transcript <span className="text-destructive">*</span>
                </label>
                <textarea
                  value={transcript}
                  onChange={(e) => setTranscript(e.target.value)}
                  rows={12}
                  placeholder="Paste the full transcript text here…"
                  className="w-full px-3 py-2 bg-background border border-input rounded-md text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring/20 focus:border-ring leading-relaxed font-mono text-[13px]"
                />
                <p className="mt-1 text-[11px] text-muted-foreground">{wordCount.toLocaleString()} words</p>
              </div>

              <div>
                <label className="mb-1.5 block text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  Fathom link <span className="normal-case font-normal text-muted-foreground/70">(optional, saved on the company)</span>
                </label>
                <input
                  type="url"
                  value={fathomLink}
                  onChange={(e) => setFathomLink(e.target.value)}
                  placeholder="https://fathom.video/share/…"
                  className="w-full px-3 py-2 bg-background border border-input rounded-md text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring/20 focus:border-ring"
                />
              </div>

              {!sheetUrl && (
                <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 flex items-center gap-2 text-xs text-amber-800">
                  <AlertCircle className="h-3.5 w-3.5" />
                  No Google Sheet is linked to this company. Add the sheet URL (Edit) before cleaning.
                </div>
              )}
            </>
          ) : (
            <CleanedReportBody report={report} />
          )}
        </div>

        {/* Footer */}
        <footer className="flex flex-wrap items-center justify-end gap-2 border-t border-border px-6 py-3 bg-muted/30">
          {sheetUrl && (
            <a href={sheetUrl} target="_blank" rel="noreferrer"
               className="mr-auto inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-3 py-1.5 text-xs font-medium text-foreground hover:bg-muted">
              <ExternalLink className="h-3.5 w-3.5" /> Open Sheet
            </a>
          )}
          {!report ? (
            <>
              <button onClick={() => !busy && onClose()} disabled={busy}
                className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-3 py-1.5 text-xs font-medium text-foreground hover:bg-muted disabled:opacity-60">
                Cancel
              </button>
              <button onClick={() => runMutation.mutate()} disabled={busy || !sheetUrl || transcript.trim().length < 40}
                className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed"
                title={!sheetUrl ? "Link a Google Sheet first" : transcript.trim().length < 40 ? "Paste the transcript" : ""}>
                {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Wand2 className="h-3.5 w-3.5" />}
                {busy ? "Cleaning…" : "Clean the Sheet"}
              </button>
            </>
          ) : (
            <button onClick={() => { setReport(null); setTranscript(""); setFathomLink(""); onClose(); }}
              className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:opacity-90">
              <CheckCircle2 className="h-3.5 w-3.5" /> Done
            </button>
          )}
        </footer>
      </div>
    </div>
  );
}

export function CleanedReportBody({ report }: { report: Report }) {
  const { toast } = useToast();
  const copy = async (text: string, label: string) => {
    try { await navigator.clipboard.writeText(text); toast({ title: `${label} copied` }); }
    catch { toast({ title: "Copy failed", variant: "destructive" }); }
  };

  return (
    <div className="space-y-4">
      {report.wrote ? (
        <div className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2.5 flex items-center gap-2 text-sm text-emerald-800 dark:border-emerald-900/40 dark:bg-emerald-900/20 dark:text-emerald-300">
          <CheckCircle2 className="h-4 w-4" />
          Written to the Google Sheet — open it to review.
        </div>
      ) : (
        <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2.5 text-sm text-amber-800 dark:border-amber-900/40 dark:bg-amber-900/20 dark:text-amber-300">
          <div className="flex items-start gap-2">
            <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0" />
            <div>
              <p className="font-medium">Couldn't edit the Google Sheet — saved here instead.</p>
              {report.writeError && <p className="mt-0.5 text-xs">{report.writeError}</p>}
              <p className="mt-1 text-xs">Copy the blocks below into the sheet, or give the connected Google account Editor access and run again to write directly. This output is also kept on the company dashboard.</p>
            </div>
          </div>
        </div>
      )}

      <div className="grid grid-cols-3 gap-3">
        {[
          { label: "Idea notes", value: report.actionsWritten, Icon: ListChecks },
          { label: "Audience rows", value: report.audienceRowsAdded, Icon: Users2 },
          { label: "Suggestions", value: report.suggestionsAdded, Icon: Lightbulb },
        ].map(({ label, value, Icon }) => (
          <div key={label} className="rounded-lg border border-border bg-background p-3 text-center">
            <Icon className="mx-auto mb-1 h-4 w-4 text-primary" />
            <p className="text-xl font-bold text-foreground tabular-nums">{value}</p>
            <p className="text-[11px] text-muted-foreground">{label}</p>
          </div>
        ))}
      </div>

      {/* When not written, show the exact text to paste into the Actions column. */}
      {!report.wrote && report.actionBlocks.length > 0 && (
        <div>
          <p className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Actions taken so far — paste into the matching idea row
          </p>
          <div className="space-y-2">
            {report.actionBlocks.map((b, i) => (
              <div key={i} className="rounded-md border border-border bg-background">
                <div className="flex items-center justify-between gap-2 border-b border-border px-2.5 py-1.5">
                  <span className="text-xs font-medium text-foreground truncate">{b.idea} <span className="text-muted-foreground">· row {b.row}</span></span>
                  <button onClick={() => copy(b.block, "Block")} className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] text-primary hover:bg-primary/10">
                    <Copy className="h-3 w-3" /> Copy
                  </button>
                </div>
                <pre className="whitespace-pre-wrap px-2.5 py-2 text-[12px] text-foreground font-sans">{b.block}</pre>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* When written, just summarise the appended phrases. */}
      {report.wrote && report.extracted.actions.length > 0 && (
        <div>
          <p className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Actions appended</p>
          <div className="space-y-2">
            {report.extracted.actions.map((a, i) => (
              <div key={i} className="rounded-md border border-border bg-background p-2.5">
                <p className="text-xs font-medium text-foreground">{a.idea}</p>
                <ul className="mt-1 flex flex-wrap gap-1">
                  {a.additions.map((p, j) => (
                    <li key={j} className="rounded bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">{p}</li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>
      )}

      {report.extracted.targetAudience.length > 0 && (
        <div>
          <p className="mb-1.5 flex items-center justify-between text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Target Audience{!report.targetTabFound && <span className="normal-case font-normal text-amber-600">no audience tab found — copy manually</span>}
          </p>
          <div className="overflow-hidden rounded-md border border-border">
            <table className="w-full text-[12px]">
              <thead className="bg-muted/50 text-muted-foreground">
                <tr><th className="px-2 py-1 text-left font-medium">Audience</th><th className="px-2 py-1 text-left font-medium">Use cases</th><th className="px-2 py-1 text-left font-medium">Channels</th><th className="px-2 py-1 text-left font-medium">Recommendation</th></tr>
              </thead>
              <tbody>
                {report.extracted.targetAudience.map((t, i) => (
                  <tr key={i} className="border-t border-border">
                    <td className="px-2 py-1 text-foreground">{t.audience}</td>
                    <td className="px-2 py-1 text-muted-foreground">{t.useCases}</td>
                    <td className="px-2 py-1 text-muted-foreground">{t.channels}</td>
                    <td className="px-2 py-1 text-muted-foreground">{t.recommendations}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {report.extracted.suggestions.length > 0 && (
        <div>
          <p className="mb-1.5 flex items-center justify-between text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Suggestions {report.wrote ? "(written below the pink line)" : "(missing data to confirm)"}
            <button onClick={() => copy(report.extracted.suggestions.map(s => `- ${s}`).join("\n"), "Suggestions")} className="inline-flex items-center gap-1 normal-case font-normal text-primary hover:underline">
              <Copy className="h-3 w-3" /> Copy all
            </button>
          </p>
          <ul className="space-y-1">
            {report.extracted.suggestions.map((s, i) => (
              <li key={i} className="flex items-start gap-2 text-xs text-foreground">
                <Lightbulb className="mt-0.5 h-3 w-3 flex-shrink-0 text-amber-500" /> {s}
              </li>
            ))}
          </ul>
        </div>
      )}

      {report.unmatched.length > 0 && (
        <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          <p className="font-medium">Couldn't place {report.unmatched.length} item(s) against an idea row — added under the closest match. Review the sheet.</p>
        </div>
      )}
    </div>
  );
}
