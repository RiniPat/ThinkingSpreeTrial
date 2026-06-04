/**
 * Email Composer dialog used by the Company detail page.
 *
 * Flow:
 *   1. Opens with kind="pre" or "post". If a draft was saved earlier (per
 *      company+kind), it's restored; otherwise it POSTs /generate-email so the
 *      consultant sees a Gemini draft immediately.
 *   2. Consultant edits To / Cc / subject / body. The draft is auto-saved to
 *      localStorage on every change, so switching browser tabs / navigating away
 *      and returning never loses work. The saved draft is cleared after a send.
 *   3. Recipients can be imported from a Google Calendar event (pulls the
 *      event's attendees) and the To / Cc fields suggest contacts as you type,
 *      Gmail-style.
 *   4. Actions: Send via Gmail, Save Draft, Copy.
 */
import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Loader2, Send, Save, Copy, Sparkles, X, AlertCircle, CheckCircle2, Mail,
  CalendarDays, RotateCcw, ChevronDown,
} from "lucide-react";
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

type Contact = { name: string; email: string; company: string | null };
type CalEvent = { id: string; title: string; startTime: string; endTime: string; attendees: string[] };

function tokens(value: string): string[] {
  return value.split(/[,;]/).map(s => s.trim()).filter(Boolean);
}

/** Remove our **bold** markers for plain-text contexts (e.g. Copy). */
function stripBold(value: string): string {
  return value.replace(/\*\*(.+?)\*\*/gs, "$1");
}

/**
 * Render a body string containing **bold** markers into React nodes, so the
 * consultant sees exactly how the email will look (bold Day/Date/Time, the
 * "T-Sprints" lead word, the recommendations line). Newlines are preserved.
 */
function renderBoldPreview(value: string): React.ReactNode[] {
  const parts = value.split(/(\*\*[^*]+?\*\*)/g);
  return parts.map((part, i) => {
    const m = /^\*\*([^*]+?)\*\*$/.exec(part);
    if (m) return <strong key={i}>{m[1]}</strong>;
    return <span key={i}>{part}</span>;
  });
}

/** A recipient input with Gmail-style contact suggestions on the current token. */
function RecipientField({
  value, onChange, contacts, placeholder,
}: { value: string; onChange: (v: string) => void; contacts: Contact[]; placeholder?: string }) {
  const [open, setOpen] = useState(false);
  const lastToken = (value.split(/[,;]/).pop() ?? "").trim().toLowerCase();
  const chosen = new Set(tokens(value).map(s => s.toLowerCase()));
  const suggestions = lastToken.length >= 1
    ? contacts
        .filter(c =>
          !chosen.has(c.email.toLowerCase()) &&
          (c.email.toLowerCase().includes(lastToken) ||
           c.name.toLowerCase().includes(lastToken) ||
           (c.company ?? "").toLowerCase().includes(lastToken)))
        .slice(0, 6)
    : [];

  function pick(email: string) {
    const idx = Math.max(value.lastIndexOf(","), value.lastIndexOf(";"));
    const head = idx >= 0 ? value.slice(0, idx + 1) + " " : "";
    onChange(head + email + ", ");
    setOpen(true);
  }

  return (
    <div className="relative">
      <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
      <input
        type="text"
        value={value}
        onChange={(e) => { onChange(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        placeholder={placeholder}
        className="w-full pl-9 pr-4 py-2 bg-background border border-input rounded-md text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring/20 focus:border-ring"
      />
      {open && suggestions.length > 0 && (
        <ul className="absolute left-0 right-0 z-30 mt-1 max-h-56 overflow-auto rounded-md border border-border bg-card shadow-lg">
          {suggestions.map(c => (
            <li key={c.email}>
              <button
                type="button"
                onMouseDown={(e) => { e.preventDefault(); pick(c.email); }}
                className="w-full text-left px-3 py-2 hover:bg-muted flex flex-col"
              >
                <span className="text-sm text-foreground">
                  {c.name || c.email}{c.company ? <span className="text-muted-foreground"> · {c.company}</span> : null}
                </span>
                <span className="text-[11px] text-muted-foreground">{c.email}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

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
  const [restored, setRestored] = useState(false);
  const [showCal, setShowCal] = useState(false);

  const draftKey = `emailDraft:${companyId}:${kind}`;
  // When true, the next generate result only updates sprint info (used after we
  // restore a saved draft and just want the calendar banner, not new text).
  const skipApplyRef = useRef(false);

  // Contacts for recipient suggestions (loaded once, cached).
  const { data: contactsData } = useQuery<{ contacts: Contact[] }>({
    queryKey: ["contacts"],
    queryFn: () => fetch(`${BASE}/api/contacts`, { credentials: "include" }).then(r => r.ok ? r.json() : { contacts: [] }),
    staleTime: 5 * 60_000,
    enabled: open,
  });
  const contacts = contactsData?.contacts ?? [];

  // Upcoming calendar events (for importing recipients).
  const { data: calEvents } = useQuery<CalEvent[]>({
    queryKey: ["composer-calendar-events"],
    queryFn: () => fetch(`${BASE}/api/calendar/events?days=14`, { credentials: "include" }).then(r => r.ok ? r.json() : []),
    staleTime: 60_000,
    enabled: open,
  });

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
      setSprintInfo({ date: data.context.sprintDate, time: data.context.sprintTime });
      // If we only ran generate to fetch sprint info for a restored draft,
      // don't overwrite the restored subject/body/draft.
      if (skipApplyRef.current) {
        skipApplyRef.current = false;
        if (data.context.toEmail && !toEmail) setToEmail(data.context.toEmail);
        return;
      }
      setSubject(data.subject);
      setBody(data.body);
      setDraftId(data.draftId);
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
      try { localStorage.removeItem(draftKey); } catch { /* ignore */ }
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

  // On open: restore a saved draft if present, otherwise auto-generate.
  useEffect(() => {
    if (!open) return;
    let didRestore = false;
    try {
      const raw = localStorage.getItem(draftKey);
      if (raw) {
        const d = JSON.parse(raw);
        if (d && (d.subject || d.body || d.toEmail || d.cc)) {
          setSubject(d.subject ?? "");
          setBody(d.body ?? "");
          setToEmail(d.toEmail ?? (founderEmail ?? ""));
          setCc(d.cc ?? "");
          setExtraNotes(d.extraNotes ?? "");
          setDraftId(d.draftId ?? null);
          didRestore = true;
        }
      }
    } catch { /* ignore */ }

    setRestored(didRestore);
    if (didRestore) {
      // Pull sprint info for the banner without overwriting the restored text.
      skipApplyRef.current = true;
      generateMutation.mutate(undefined);
    } else {
      setSubject(""); setBody(""); setDraftId(null); setExtraNotes("");
      setToEmail(founderEmail ?? ""); setCc("");
      skipApplyRef.current = false;
      generateMutation.mutate(undefined);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, kind]);

  // Auto-save the draft on every change while open.
  useEffect(() => {
    if (!open) return;
    try {
      localStorage.setItem(draftKey, JSON.stringify({ subject, body, toEmail, cc, extraNotes, draftId }));
    } catch { /* ignore */ }
  }, [open, draftKey, subject, body, toEmail, cc, extraNotes, draftId]);

  if (!open) return null;

  const generating = generateMutation.isPending;
  const sending = sendMutation.isPending;
  const saving = saveDraftMutation.isPending;
  const busy = generating || sending || saving;

  const validRecipients = tokens(toEmail).filter(s => s.includes("@") && !s.includes("@placeholder.local"));
  const hasPlaceholder = toEmail.includes("@placeholder.local");
  const canSend = !!subject && !!body && validRecipients.length > 0;

  function importEventRecipients(ev: CalEvent) {
    const emails = (ev.attendees ?? []).filter(e => e && e.includes("@") && !e.includes("@placeholder.local"));
    if (emails.length === 0) { toast({ title: "No attendees on that event" }); return; }

    // Decide which attendee is the founder — they go in To:, everyone else in Cc:.
    //  1) exact match against the company's founder email (most reliable),
    //  2) the known founder email even if absent from the invite,
    //  3) heuristic: an attendee whose local-part matches a name token,
    //  4) fall back to the first attendee.
    const validFounderEmail = founderEmail && founderEmail.includes("@") && !founderEmail.includes("@placeholder.local")
      ? founderEmail.trim()
      : null;

    const lower = emails.map(e => e.toLowerCase());
    let founderAddr: string | null = null;

    if (validFounderEmail) {
      const idx = lower.indexOf(validFounderEmail.toLowerCase());
      founderAddr = idx >= 0 ? emails[idx] : validFounderEmail;
    } else {
      const nameTokens = founderName.toLowerCase().split(/\s+/).filter(t => t.length >= 3);
      const guess = emails.find(e => {
        const local = e.split("@")[0].toLowerCase();
        return nameTokens.some(t => local.includes(t));
      });
      founderAddr = guess ?? emails[0];
    }

    const founderLower = founderAddr!.toLowerCase();
    const others = emails.filter(e => e.toLowerCase() !== founderLower);

    // To: just the founder (merged so a manual entry isn't clobbered).
    const toMerged = Array.from(new Set([founderAddr!, ...tokens(toEmail)]));
    setToEmail(toMerged.join(", ") + (toMerged.length ? ", " : ""));

    // Cc: every other attendee, merged with whatever was already in Cc,
    // and never duplicating the founder.
    const ccMerged = Array.from(new Set([...tokens(cc), ...others]))
      .filter(e => e.toLowerCase() !== founderLower);
    setCc(ccMerged.join(", ") + (ccMerged.length ? ", " : ""));

    if (!subject && ev.title) setSubject(kind === "post" ? `Re: ${ev.title}` : ev.title);
    setShowCal(false);
    toast({
      title: `Founder set as To · ${others.length} in Cc`,
      description: `From "${ev.title}"`,
    });
  }

  // When the restored draft has no AI text yet (regeneration only fills sprint
  // info), keep the user's restored content. We achieve that by NOT applying
  // generate results over non-empty restored fields handled in onSuccess via the
  // `!toEmail` guard for email; for subject/body we simply let regenerate fill
  // only if the user explicitly clicks Regenerate. To honor restore, skip the
  // auto-applied subject/body when guard is set:
  // (handled by clearing guard once the user edits)

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
          {restored && (
            <div className="rounded-md border border-blue-200 bg-blue-50 px-3 py-2 flex items-center justify-between gap-2 text-xs text-blue-800 dark:border-blue-900/40 dark:bg-blue-900/20 dark:text-blue-300">
              <span className="flex items-center gap-2"><Save className="h-3.5 w-3.5" /> Restored your in-progress draft.</span>
              <button
                onClick={() => {
                  try { localStorage.removeItem(draftKey); } catch { /* ignore */ }
                  setRestored(false); setSubject(""); setBody(""); setDraftId(null);
                  setToEmail(founderEmail ?? ""); setCc(""); setExtraNotes("");
                  generateMutation.mutate(undefined);
                }}
                className="inline-flex items-center gap-1 font-medium underline hover:no-underline"
              >
                <RotateCcw className="h-3 w-3" /> Discard & regenerate
              </button>
            </div>
          )}

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

          {/* Import recipients from a calendar event */}
          <div className="rounded-md border border-border">
            <button
              type="button"
              onClick={() => setShowCal(v => !v)}
              className="w-full flex items-center justify-between px-3 py-2 text-xs font-medium text-foreground hover:bg-muted"
            >
              <span className="flex items-center gap-2"><CalendarDays className="h-3.5 w-3.5 text-primary" /> Import recipients from a calendar event</span>
              <ChevronDown className={`h-3.5 w-3.5 transition-transform ${showCal ? "rotate-180" : ""}`} />
            </button>
            {showCal && (
              <div className="border-t border-border max-h-48 overflow-auto">
                <p className="px-3 pt-2 text-[11px] text-muted-foreground">
                  Importing puts the <span className="font-medium text-foreground">founder in To</span> and everyone else in <span className="font-medium text-foreground">Cc</span>.
                </p>
                {(calEvents ?? []).length === 0 ? (
                  <p className="px-3 py-3 text-xs text-muted-foreground">No upcoming events found (next 14 days), or Calendar isn't connected.</p>
                ) : (
                  <ul className="divide-y divide-border">
                    {(calEvents ?? []).map(ev => (
                      <li key={ev.id}>
                        <button
                          type="button"
                          onClick={() => importEventRecipients(ev)}
                          className="w-full text-left px-3 py-2 hover:bg-muted"
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-sm text-foreground truncate">{ev.title}</span>
                            <span className="text-[11px] text-muted-foreground shrink-0">
                              {ev.attendees?.length ? `${ev.attendees.length} attendee${ev.attendees.length > 1 ? "s" : ""}` : "no attendees"}
                            </span>
                          </div>
                          <div className="text-[11px] text-muted-foreground">
                            {ev.startTime ? new Date(ev.startTime).toLocaleString() : ""}
                          </div>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </div>

          {/* To: */}
          <div>
            <label className="mb-1.5 block text-xs font-medium uppercase tracking-wider text-muted-foreground">To</label>
            <RecipientField value={toEmail} onChange={setToEmail} contacts={contacts}
              placeholder="founder@startup.com, cofounder@startup.com" />
            <p className="mt-1 text-[11px] text-muted-foreground">Separate multiple recipients with a comma. Start typing for suggestions.</p>
            {hasPlaceholder && (
              <p className="mt-1 text-[11px] text-destructive">Update the founder email on the company page before sending.</p>
            )}
          </div>

          {/* Cc: */}
          <div>
            <label className="mb-1.5 block text-xs font-medium uppercase tracking-wider text-muted-foreground">
              Cc <span className="normal-case font-normal text-muted-foreground/70">(optional)</span>
            </label>
            <RecipientField value={cc} onChange={setCc} contacts={contacts}
              placeholder="mentor@thinkingspree.com, partner@fund.com" />
          </div>

          {/* Subject */}
          <div>
            <label className="mb-1.5 block text-xs font-medium uppercase tracking-wider text-muted-foreground">Subject</label>
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
            <label className="mb-1.5 block text-xs font-medium uppercase tracking-wider text-muted-foreground">Body</label>
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
            {!generating && body && (
              <div className="mt-2 rounded-md border border-border bg-muted/30">
                <div className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground border-b border-border">
                  Formatted preview · how the founder sees it
                </div>
                <div className="px-3 py-2.5 text-[13px] leading-relaxed text-foreground whitespace-pre-wrap">
                  {renderBoldPreview(body)}
                </div>
                <p className="px-3 pb-2 text-[11px] text-muted-foreground">
                  Wrap text in <code className="font-mono">**double asterisks**</code> to bold it. Bold renders in the sent email.
                </p>
              </div>
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
              await navigator.clipboard.writeText(`Subject: ${subject}\n\n${stripBold(body)}`);
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
