/**
 * Email Composer dialog used by the Company detail page.
 *
 * Flow:
 *   1. Opens with kind="pre" or "post"; immediately POSTs /generate-email
 *      so the consultant sees a draft as soon as the modal opens.
 *   2. Consultant can edit subject + body. Can also tweak "Additional notes"
 *      and click Regenerate to re-prompt Gemini.
 *   3. Three actions: Send via Gmail, Save Draft (no send), Copy to clipboard.
 *   4. On send, parent gets notified so it can refresh the timeline.
 */
import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Loader2, Send, Save, Copy, Sparkles, X, AlertCircle, CheckCircle2, Mail } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

type Props = {
  companyId: number;
  open: boolean;
  kind: "pre" | "post";
  founderEmail: string | null;
  founderName: string;
  companyName: string;
  onClose: () => void;
  onSent?: () => void;
};

type GenerateResponse = {
  subject: string;
  body: string;
  draftId: number;
  context: {
    toEmail: string | null;
    founderName: string;
    companyName: string;
    sprintDate: string | null;
    sprintTime: string | null;
  };
};

export function EmailComposer({
  companyId, open, kind, founderEmail, founderName, companyName, onClose, onSent,
}: Props) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [toEmail, setToEmail] = useState(founderEmail ?? "");
  const [cc, setCc] = useState("");
  const [extraNotes, setExtraNotes] = useState("");
  const [draftId, setDraftId] = useState<number | null>(null);
  const [sprintInfo, setSprintInfo] = useState<{ date: string | null; time: string | null }>({ date: null, time: null });

  // Generate immediately on open. Subsequent regenerations use the same fn.
  const generateMutation = useMutation({
    mutationFn: async (notes?: string) => {
      const res = await fetch(`${BASE}/api/companies/${companyId}/generate-email`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind, extraNotes: notes ?? "" }),
      });
      if (!res.ok) {
        const e = await res.json().catch(() => ({}));
        throw new Error(e?.error || `Generation failed (${res.status})`);
      }
      return (await res.json()) as GenerateResponse;
    },
    onSuccess: (data) => {
      setSubject(data.subject);
      setBody(data.body);
      setDraftId(data.draftId);
      setSprintInfo({ date: data.context.sprintDate, time: data.context.sprintTime });
      if (data.context.toEmail && !toEmail) setToEmail(data.context.toEmail);
    },
    onError: (err: any) => {
      toast({ title: "AI generation failed", description: err.message, variant: "destructive" });
    },
  });

  // Send via Gmail mutation
  const sendMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`${BASE}/api/companies/${companyId}/send-email`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind, subject, body, toEmail, cc, draftId }),
      });
      if (!res.ok) {
        const e = await res.json().catch(() => ({}));
        throw new Error(e?.error || `Send failed (${res.status})`);
      }
      return res.json();
    },
    onSuccess: (data) => {
      toast({
        title: "Email sent",
        description: data?.threaded
          ? `Sent to ${toEmail} as a reply to the pre-sprint email. Timeline updated.`
          : `Sent to ${toEmail} via Gmail. Timeline updated.`,
      });
      qc.invalidateQueries({ queryKey: ["company", companyId] });
      qc.invalidateQueries({ queryKey: ["companies"] });
      onSent?.();
      onClose();
    },
    onError: (err: any) => {
      toast({ title: "Send failed", description: err.message, variant: "destructive" });
    },
  });

  // Save draft without sending
  const saveDraftMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`${BASE}/api/companies/${companyId}/drafts`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind, subject, body, toEmail, draftId }),
      });
      if (!res.ok) throw new Error((await res.json()).error || "Save failed");
      return res.json();
    },
    onSuccess: (data) => {
      if (data.draftId) setDraftId(data.draftId);
      toast({ title: "Draft saved" });
    },
    onError: (err: any) => toast({ title: "Save failed", description: err.message, variant: "destructive" }),
  });

  // Auto-generate when the dialog opens (and clear when it closes).
  useEffect(() => {
    if (open) {
      setSubject(""); setBody(""); setDraftId(null); setExtraNotes("");
      setToEmail(founderEmail ?? "");
      setCc("");
      generateMutation.mutate(undefined);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, kind]);

  if (!open) return null;

  const generating = generateMutation.isPending;
  const sending = sendMutation.isPending;
  const saving = saveDraftMutation.isPending;
  const busy = generating || sending || saving;
  // Split on comma/semicolon, validate each, drop placeholders. At least one
  // real recipient is required to send.
  const validRecipients = toEmail
    .split(/[,;]/)
    .map(s => s.trim())
    .filter(s => s.includes("@") && !s.includes("@placeholder.local"));
  const hasPlaceholder = toEmail.includes("@placeholder.local");
  const canSend = !!subject && !!body && validRecipients.length > 0;

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
            <div className="rounded-md bg-primary/10 p-2">
              <Sparkles className="h-4 w-4 text-primary" />
            </div>
            <div>
              <h2 className="font-serif text-2xl text-foreground">
                {kind === "pre" ? "Pre-Sprint Email" : "Post-Sprint Email"}
              </h2>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {companyName} · {founderName} · drafted by Gemini
              </p>
            </div>
          </div>
          <button
            onClick={() => !busy && onClose()}
            className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        {/* Body */}
        <div className="max-h-[calc(100vh-16rem)] overflow-y-auto px-6 py-5 space-y-4">
          {/* Sprint date/time info banner (pre only) */}
          {kind === "pre" && (sprintInfo.date || sprintInfo.time) && (
            <div className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 flex items-center gap-2 text-xs text-emerald-800">
              <CheckCircle2 className="h-3.5 w-3.5" />
              Sprint time pulled from Google Calendar:
              {" "}<strong>{sprintInfo.date}{sprintInfo.time ? ` · ${sprintInfo.time}` : ""}</strong>
            </div>
          )}
          {kind === "pre" && !sprintInfo.date && !generating && (
            <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 flex items-center gap-2 text-xs text-amber-800">
              <AlertCircle className="h-3.5 w-3.5" />
              No matching calendar event found. The closing paragraph is softened — add the session details in your Google Calendar (with the company name in the title) and click Regenerate.
            </div>
          )}

          {/* To: */}
          <div>
            <label className="mb-1.5 block text-xs font-medium uppercase tracking-wider text-muted-foreground">
              To
            </label>
            <div className="relative">
              <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <input
                type="text"
                value={toEmail}
                onChange={(e) => setToEmail(e.target.value)}
                placeholder="founder@startup.com, cofounder@startup.com"
                className="w-full pl-9 pr-4 py-2 bg-background border border-input rounded-md text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring/20 focus:border-ring"
              />
            </div>
            <p className="mt-1 text-[11px] text-muted-foreground">
              Separate multiple recipients with a comma.
            </p>
            {hasPlaceholder && (
              <p className="mt-1 text-[11px] text-destructive">
                Update the founder email on the company page before sending.
              </p>
            )}
          </div>

          {/* Cc: */}
          <div>
            <label className="mb-1.5 block text-xs font-medium uppercase tracking-wider text-muted-foreground">
              Cc <span className="normal-case font-normal text-muted-foreground/70">(optional)</span>
            </label>
            <div className="relative">
              <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <input
                type="text"
                value={cc}
                onChange={(e) => setCc(e.target.value)}
                placeholder="mentor@thinkingspree.com, partner@fund.com"
                className="w-full pl-9 pr-4 py-2 bg-background border border-input rounded-md text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring/20 focus:border-ring"
              />
            </div>
          </div>

          {/* Subject */}
          <div>
            <label className="mb-1.5 block text-xs font-medium uppercase tracking-wider text-muted-foreground">
              Subject
            </label>
            {generating && !subject ? (
              <div className="h-10 rounded-md bg-muted animate-pulse" />
            ) : (
              <input
                type="text"
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                className="w-full px-3 py-2 bg-background border border-input rounded-md text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring/20 focus:border-ring"
              />
            )}
          </div>

          {/* Body */}
          <div>
            <label className="mb-1.5 block text-xs font-medium uppercase tracking-wider text-muted-foreground">
              Body
            </label>
            {generating && !body ? (
              <div className="space-y-2">
                <div className="h-3 rounded bg-muted animate-pulse w-full" />
                <div className="h-3 rounded bg-muted animate-pulse w-11/12" />
                <div className="h-3 rounded bg-muted animate-pulse w-4/5" />
                <div className="h-3 rounded bg-muted animate-pulse w-full" />
                <div className="h-3 rounded bg-muted animate-pulse w-3/4" />
                <p className="text-xs text-muted-foreground mt-2 flex items-center gap-2">
                  <Loader2 className="h-3 w-3 animate-spin" /> Gemini is drafting…
                </p>
              </div>
            ) : (
              <textarea
                value={body}
                onChange={(e) => setBody(e.target.value)}
                rows={14}
                className="w-full px-3 py-2 bg-background border border-input rounded-md text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring/20 focus:border-ring leading-relaxed font-mono text-[13px]"
              />
            )}
          </div>

          {/* Additional notes + regenerate */}
          <details className="rounded-md border border-border">
            <summary className="cursor-pointer px-3 py-2 text-xs font-medium text-muted-foreground hover:bg-muted">
              Additional notes for AI · Regenerate
            </summary>
            <div className="p-3 space-y-2 border-t border-border">
              <textarea
                value={extraNotes}
                onChange={(e) => setExtraNotes(e.target.value)}
                placeholder={
                  kind === "pre"
                    ? "e.g. emphasize that the founder is preparing for fundraise, mention prior partnerships..."
                    : "e.g. mention specific intro to Sequoia, follow-up in 2 weeks, reinforce confidence on GTM..."
                }
                rows={3}
                className="w-full px-3 py-2 bg-background border border-input rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-ring/20 focus:border-ring"
              />
              <button
                onClick={() => generateMutation.mutate(extraNotes)}
                disabled={busy}
                className="inline-flex items-center gap-2 rounded-md border border-border bg-background px-3 py-1.5 text-xs font-medium text-foreground hover:bg-muted disabled:opacity-60"
              >
                {generating ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
                Regenerate with these notes
              </button>
            </div>
          </details>
        </div>

        {/* Footer actions */}
        <footer className="flex flex-wrap items-center justify-end gap-2 border-t border-border px-6 py-3 bg-muted/30">
          <button
            onClick={async () => {
              await navigator.clipboard.writeText(`Subject: ${subject}\n\n${body}`);
              toast({ title: "Copied to clipboard" });
            }}
            disabled={busy || !body}
            className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-3 py-1.5 text-xs font-medium text-foreground hover:bg-muted disabled:opacity-60"
          >
            <Copy className="h-3.5 w-3.5" /> Copy
          </button>
          <button
            onClick={() => saveDraftMutation.mutate()}
            disabled={busy || !body}
            className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-3 py-1.5 text-xs font-medium text-foreground hover:bg-muted disabled:opacity-60"
          >
            {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
            Save Draft
          </button>
          <button
            onClick={() => sendMutation.mutate()}
            disabled={busy || !canSend}
            className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed"
            title={!canSend ? "Founder email required" : ""}
          >
            {sending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
            Send via Gmail
          </button>
        </footer>
      </div>
    </div>
  );
}
