import { useState } from "react";
import { useRoute, useLocation } from "wouter";
import {
  useGetSprint, useUpdateSprint, useDeleteSprint,
  useGeneratePreEmail, useGeneratePostEmail, useSendEmail,
  getGetSprintQueryKey, getListSprintsQueryKey, customFetch,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Layout } from "@/components/Layout";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import {
  ArrowLeft, Mail, Send, Edit2, Save, X, Trash2, CheckCircle, Clock, XCircle,
  Calendar, User, Link as LinkIcon, FileText, Sparkles, RefreshCw, ExternalLink,
  Hash, Video, FileSpreadsheet, Wand2, Check,
} from "lucide-react";

const BASE = (import.meta as any).env?.BASE_URL?.replace(/\/$/, "") ?? "";

type EmailDraft = { subject: string; body: string; to: string; toName: string; sprintId: number; emailType: "pre_sprint" | "post_sprint" };
type Tone = "professional" | "friendly" | "formal" | "concise";

const TONE_OPTIONS: { value: Tone; label: string; desc: string }[] = [
  { value: "professional", label: "Professional", desc: "Clear & supportive" },
  { value: "friendly", label: "Friendly", desc: "Warm & encouraging" },
  { value: "formal", label: "Formal", desc: "Structured & precise" },
  { value: "concise", label: "Concise", desc: "Short & direct" },
];

function EmailModal({
  draft, onClose, onSent, onRegenerate, isRegenerating,
}: {
  draft: EmailDraft; onClose: () => void; onSent: () => void;
  onRegenerate: (tone: Tone) => void; isRegenerating: boolean;
}) {
  const { toast } = useToast();
  const sendEmail = useSendEmail();
  const [subject, setSubject] = useState(draft.subject);
  const [body, setBody] = useState(draft.body);
  const [tone, setTone] = useState<Tone>("professional");
  const [prevDraft, setPrevDraft] = useState(draft);
  if (draft !== prevDraft) { setPrevDraft(draft); setSubject(draft.subject); setBody(draft.body); }

  function handleSend() {
    sendEmail.mutate({ data: { to: draft.to, subject, body, sprintId: draft.sprintId, emailType: draft.emailType } }, {
      onSuccess: () => { toast({ title: "Email sent", description: `Sent to ${draft.to}` }); onSent(); onClose(); },
      onError: (err: unknown) => toast({ title: "Error sending email", description: err instanceof Error ? err.message : "Failed", variant: "destructive" }),
    });
  }

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
      <div className="bg-card border border-card-border rounded-xl shadow-2xl w-full max-w-2xl max-h-[92vh] flex flex-col">
        <div className="flex items-center justify-between p-5 border-b border-border flex-shrink-0">
          <div>
            <div className="flex items-center gap-2">
              <Sparkles size={15} className="text-primary" />
              <h2 className="font-semibold text-foreground">
                {draft.emailType === "pre_sprint" ? "Pre-Sprint Invitation" : "Post-Sprint Summary"}
              </h2>
            </div>
            <p className="text-xs text-muted-foreground mt-0.5">To: {draft.toName} &lt;{draft.to}&gt;</p>
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground"><X size={18} /></button>
        </div>
        {/* Tone selector */}
        <div className="px-5 pt-4 pb-3 border-b border-border flex-shrink-0">
          <p className="text-xs font-medium text-muted-foreground mb-2">Email tone</p>
          <div className="flex gap-2 flex-wrap items-center">
            {TONE_OPTIONS.map((t) => (
              <button key={t.value} onClick={() => setTone(t.value)}
                className={`px-3 py-1.5 rounded-md text-xs font-medium transition border ${tone === t.value ? "bg-primary text-primary-foreground border-primary" : "border-border text-muted-foreground hover:bg-muted"}`}>
                {t.label}
              </button>
            ))}
            <button onClick={() => onRegenerate(tone)} disabled={isRegenerating}
              className="ml-auto flex items-center gap-1.5 px-3 py-1.5 bg-muted border border-border rounded-md text-xs font-medium text-foreground hover:bg-muted/80 transition disabled:opacity-50">
              <RefreshCw size={12} className={isRegenerating ? "animate-spin" : ""} />
              {isRegenerating ? "Regenerating..." : "Regenerate"}
            </button>
          </div>
        </div>
        <div className="p-5 space-y-4 flex-1 overflow-y-auto">
          <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg px-4 py-2.5 flex items-center gap-2">
            <Mail size={14} className="text-amber-600 dark:text-amber-400 flex-shrink-0" />
            <p className="text-xs text-amber-700 dark:text-amber-400 font-medium">Review carefully before sending — this will be delivered to the founder.</p>
          </div>
          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1">Subject</label>
            <input value={subject} onChange={e => setSubject(e.target.value)}
              className="w-full px-3 py-2 bg-background border border-input rounded-md text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring" />
          </div>
          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1">Body</label>
            <textarea value={body} onChange={e => setBody(e.target.value)} rows={15}
              className="w-full px-3 py-2 bg-background border border-input rounded-md text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring font-mono resize-y" />
          </div>
        </div>
        <div className="p-5 border-t border-border flex gap-3 flex-shrink-0">
          <button onClick={onClose} className="flex-1 py-2.5 border border-border rounded-md text-sm font-medium text-muted-foreground hover:bg-muted transition">Cancel</button>
          <button onClick={handleSend} disabled={sendEmail.isPending}
            className="flex-1 py-2.5 bg-primary text-primary-foreground rounded-md text-sm font-semibold hover:opacity-90 transition disabled:opacity-50 flex items-center justify-center gap-2">
            <Send size={14} />{sendEmail.isPending ? "Sending..." : "Send Email"}
          </button>
        </div>
      </div>
    </div>
  );
}

function FieldEditor({ label, value, field, sprintId, multiline = false, isUrl = false }: {
  label: string; value: string | null | undefined; field: string; sprintId: number; multiline?: boolean; isUrl?: boolean;
}) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const updateSprint = useUpdateSprint();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value ?? "");

  function save() {
    updateSprint.mutate({ id: sprintId, data: { [field]: draft || null } }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getGetSprintQueryKey(sprintId) });
        toast({ title: "Saved" });
        setEditing(false);
      },
      onError: () => toast({ title: "Error saving", variant: "destructive" }),
    });
  }

  return (
    <div className="group">
      {label && (
        <div className="flex items-center justify-between mb-1.5">
          <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">{label}</label>
          {!editing && (
            <button onClick={() => { setDraft(value ?? ""); setEditing(true); }}
              className="opacity-0 group-hover:opacity-100 p-1 text-muted-foreground hover:text-primary transition">
              <Edit2 size={12} />
            </button>
          )}
        </div>
      )}
      {!label && !editing && (
        <button onClick={() => { setDraft(value ?? ""); setEditing(true); }}
          className="absolute top-0 right-0 opacity-0 group-hover:opacity-100 p-1 text-muted-foreground hover:text-primary transition">
          <Edit2 size={12} />
        </button>
      )}
      {editing ? (
        <div className="space-y-2">
          {multiline ? (
            <textarea value={draft} onChange={e => setDraft(e.target.value)} rows={4} autoFocus
              className="w-full px-3 py-2 bg-background border border-input rounded-md text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring resize-y" />
          ) : (
            <input type={isUrl ? "url" : "text"} value={draft} onChange={e => setDraft(e.target.value)} autoFocus
              placeholder={isUrl ? "https://..." : ""}
              className="w-full px-3 py-2 bg-background border border-input rounded-md text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring" />
          )}
          <div className="flex gap-2">
            <button onClick={save} disabled={updateSprint.isPending}
              className="flex items-center gap-1 px-3 py-1.5 bg-primary text-primary-foreground rounded-md text-xs font-medium hover:opacity-90 transition">
              <Save size={12} /> {updateSprint.isPending ? "Saving..." : "Save"}
            </button>
            <button onClick={() => setEditing(false)}
              className="flex items-center gap-1 px-3 py-1.5 border border-border rounded-md text-xs font-medium text-muted-foreground hover:bg-muted transition">
              <X size={12} /> Cancel
            </button>
          </div>
        </div>
      ) : (
        <div className="flex items-start gap-2 group/val">
          {value ? (
            isUrl ? (
              <a href={value} target="_blank" rel="noreferrer"
                className="flex items-center gap-1.5 text-sm text-primary hover:underline break-all">
                <ExternalLink size={13} className="flex-shrink-0 mt-0.5" />{value}
              </a>
            ) : (
              <p className="text-sm text-foreground whitespace-pre-wrap flex-1">{value}</p>
            )
          ) : (
            <button onClick={() => { setDraft(""); setEditing(true); }}
              className="text-sm text-muted-foreground italic hover:text-primary transition flex items-center gap-1">
              <Edit2 size={12} />{isUrl ? "Add link..." : "Click to add..."}
            </button>
          )}
          {value && !editing && (
            <button onClick={() => { setDraft(value ?? ""); setEditing(true); }}
              className="opacity-0 group-hover/val:opacity-100 flex-shrink-0 p-1 text-muted-foreground hover:text-primary transition mt-0.5">
              <Edit2 size={11} />
            </button>
          )}
        </div>
      )}
    </div>
  );
}

export default function SprintDetailPage() {
  const [, params] = useRoute("/sprints/:id");
  const [, setLocation] = useLocation();
  const id = parseInt(params?.id ?? "0");
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const { data: sprint, isLoading } = useGetSprint(id, { query: { enabled: !!id, queryKey: getGetSprintQueryKey(id) } });
  const deleteSprint = useDeleteSprint();
  const generatePre = useGeneratePreEmail();
  const generatePost = useGeneratePostEmail();
  const updateSprint = useUpdateSprint();
  const [emailDraft, setEmailDraft] = useState<EmailDraft | null>(null);
  const [sheetPreDraft, setSheetPreDraft] = useState<EmailDraft | null>(null);
  const [lastEmailType, setLastEmailType] = useState<"pre_sprint" | "post_sprint">("pre_sprint");

  function handleDelete() {
    if (!confirm("Delete this T-Sprint? This cannot be undone.")) return;
    deleteSprint.mutate({ id }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListSprintsQueryKey() });
        toast({ title: "Sprint deleted" });
        setLocation("/sprints");
      },
      onError: () => toast({ title: "Error deleting sprint", variant: "destructive" }),
    });
  }

  function handleStatusChange(status: string) {
    updateSprint.mutate({ id, data: { status: status as "scheduled" | "completed" | "cancelled" } }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getGetSprintQueryKey(id) });
        toast({ title: "Status updated" });
      },
      onError: () => toast({ title: "Error updating status", variant: "destructive" }),
    });
  }

  function handleGeneratePre(tone: Tone = "professional") {
    setLastEmailType("pre_sprint");
    generatePre.mutate({ id, data: { tone } }, {
      onSuccess: (d) => setEmailDraft(d as EmailDraft),
      onError: () => toast({ title: "Error generating email", variant: "destructive" }),
    });
  }

  function handleGeneratePost(tone: Tone = "professional") {
    setLastEmailType("post_sprint");
    generatePost.mutate({ id, data: { tone } }, {
      onSuccess: (d) => setEmailDraft(d as EmailDraft),
      onError: () => toast({ title: "Error generating email", variant: "destructive" }),
    });
  }

  function handleRegenerate(tone: Tone) {
    if (lastEmailType === "pre_sprint") handleGeneratePre(tone);
    else handleGeneratePost(tone);
  }

  const isGenerating = generatePre.isPending || generatePost.isPending;

  if (isLoading) {
    return (
      <Layout>
        <div className="p-6 max-w-4xl mx-auto space-y-4">
          <Skeleton className="h-10 w-48" />
          <Skeleton className="h-32 rounded-xl" />
          <Skeleton className="h-64 rounded-xl" />
        </div>
      </Layout>
    );
  }

  if (!sprint) {
    return (
      <Layout>
        <div className="p-6 text-center">
          <p className="text-muted-foreground">Sprint not found</p>
          <button onClick={() => setLocation("/sprints")} className="mt-3 text-primary text-sm hover:underline">Back to sprints</button>
        </div>
      </Layout>
    );
  }

  const statusConfig: Record<string, { icon: React.ElementType; color: string; bg: string }> = {
    scheduled: { icon: Clock, color: "text-blue-600 dark:text-blue-400", bg: "bg-blue-100 dark:bg-blue-900/30" },
    completed: { icon: CheckCircle, color: "text-green-600 dark:text-green-400", bg: "bg-green-100 dark:bg-green-900/30" },
    cancelled: { icon: XCircle, color: "text-red-600 dark:text-red-400", bg: "bg-red-100 dark:bg-red-900/30" },
  };
  const sc = statusConfig[sprint.status] ?? statusConfig.scheduled;

  return (
    <Layout>
      <div className="p-6 max-w-4xl mx-auto">
        {/* Header */}
        <div className="mb-6">
          <button onClick={() => setLocation("/sprints")} className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition mb-4">
            <ArrowLeft size={14} />Back to sprints
          </button>
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div>
              <h1 className="text-2xl font-bold text-foreground">{sprint.companyName}</h1>
              <div className="flex items-center gap-3 mt-1.5 flex-wrap text-sm text-muted-foreground">
                <span className="flex items-center gap-1"><User size={13} />{sprint.founderName}</span>
                <span className="flex items-center gap-1"><Calendar size={13} />{sprint.scheduledDate}{sprint.scheduledTime ? ` at ${sprint.scheduledTime}` : ""}</span>
                <span className="flex items-center gap-1"><User size={13} />{sprint.consultantName}</span>
                {(sprint as any).sprintNumber != null && <span className="flex items-center gap-1"><Hash size={13} />Session {(sprint as any).sprintNumber}</span>}
                {(sprint as any).sessionType && <span className="px-2 py-0.5 bg-muted rounded-full text-xs">{(sprint as any).sessionType}</span>}
                {sprint.meetLink && (
                  <a href={sprint.meetLink} target="_blank" rel="noreferrer" className="flex items-center gap-1 text-primary hover:underline">
                    <LinkIcon size={13} />Join Meet
                  </a>
                )}
              </div>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <div className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium ${sc.bg} ${sc.color}`}>
                <sc.icon size={12} />{sprint.status}
              </div>
              <select value={sprint.status} onChange={e => handleStatusChange(e.target.value)}
                className="px-3 py-1.5 bg-background border border-border rounded-md text-xs font-medium text-foreground focus:outline-none focus:ring-2 focus:ring-ring">
                <option value="scheduled">Mark Scheduled</option>
                <option value="completed">Mark Completed</option>
                <option value="cancelled">Mark Cancelled</option>
              </select>
              <button onClick={handleDelete} className="p-2 text-muted-foreground hover:text-destructive hover:bg-destructive/10 rounded-md transition">
                <Trash2 size={15} />
              </button>
            </div>
          </div>
        </div>

        {/* Session Links: T-Sheet + Fathom */}
        <div className="bg-card border border-card-border rounded-xl p-5 mb-6">
          <div className="flex items-center gap-2 mb-4">
            <LinkIcon size={15} className="text-primary" />
            <h2 className="font-semibold text-sm text-foreground">Session Links</h2>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
            <div>
              <div className="flex items-center gap-1.5 mb-1">
                <FileText size={12} className="text-primary" />
                <span className="text-xs font-semibold text-foreground">T-Sheet (Thinking Sheet)</span>
              </div>
              <p className="text-xs text-muted-foreground mb-2">Google Sheet with the full analysis template for this founder.</p>
              <FieldEditor label="" value={(sprint as any).tsheetUrl} field="tsheetUrl" sprintId={id} isUrl />
            </div>
            <div>
              <div className="flex items-center gap-1.5 mb-1">
                <Video size={12} className="text-primary" />
                <span className="text-xs font-semibold text-foreground">Fathom Recording</span>
              </div>
              <p className="text-xs text-muted-foreground mb-2">Link to the Fathom session recording.</p>
              <FieldEditor label="" value={(sprint as any).fathomUrl} field="fathomUrl" sprintId={id} isUrl />
            </div>
          </div>
        </div>

        {/* Email Actions */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-6">
          <div className="bg-card border border-card-border rounded-xl p-5">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <Mail size={16} className="text-primary" />
                <span className="font-medium text-sm text-foreground">Pre-Sprint Invitation</span>
              </div>
              {sprint.preEmailSentAt && (
                <span className="text-xs text-green-600 dark:text-green-400 flex items-center gap-1"><CheckCircle size={11} />Sent</span>
              )}
            </div>
            <p className="text-xs text-muted-foreground mb-3">AI generates a personalized invitation email for the founder.</p>
            <button onClick={() => handleGeneratePre()} disabled={isGenerating}
              className="w-full py-2 bg-primary text-primary-foreground rounded-md text-sm font-medium hover:opacity-90 transition disabled:opacity-50 flex items-center justify-center gap-1.5">
              <Sparkles size={13} />{generatePre.isPending ? "Generating..." : "Generate Pre-Sprint Email"}
            </button>
          </div>

          <div className="bg-card border border-card-border rounded-xl p-5">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <Send size={16} className="text-primary" />
                <span className="font-medium text-sm text-foreground">Post-Sprint Summary</span>
              </div>
              {sprint.postEmailSentAt && (
                <span className="text-xs text-green-600 dark:text-green-400 flex items-center gap-1"><CheckCircle size={11} />Sent</span>
              )}
            </div>
            <p className="text-xs text-muted-foreground mb-3">AI generates a summary email with strengths, goals, and action steps.</p>
            <button onClick={() => handleGeneratePost()} disabled={isGenerating}
              className="w-full py-2 bg-primary text-primary-foreground rounded-md text-sm font-medium hover:opacity-90 transition disabled:opacity-50 flex items-center justify-center gap-1.5">
              <Sparkles size={13} />{generatePost.isPending ? "Generating..." : "Generate Post-Sprint Email"}
            </button>
          </div>
        </div>

        {/* AI from Google Sheet — drafts BOTH emails from a sheet of session notes */}
        <SheetAiPanel sprintId={id} founderEmail={sprint.founderName ? "" : undefined}
          onDrafts={(pre, post) => {
            // Default to opening the post draft; consultant can swap via the chip.
            setLastEmailType("post_sprint");
            setEmailDraft({ ...post, sprintId: id, emailType: "post_sprint" } as EmailDraft);
            // Stash pre for one-click swap
            setSheetPreDraft({ ...pre, sprintId: id, emailType: "pre_sprint" } as EmailDraft);
          }}
        />

        {/* AI Summary Update — proposes patches to founder summary fields */}
        <AiSummaryUpdatePanel sprintId={id} founderId={sprint.founderId} onApplied={() => {
          queryClient.invalidateQueries({ queryKey: getGetSprintQueryKey(id) });
          // also clear the cached incubator detail since founder fields changed
          queryClient.invalidateQueries({ queryKey: ["/api/incubators"] });
        }} />

        {/* Analysis Fields */}
        <div className="bg-card border border-card-border rounded-xl p-6">
          <div className="flex items-center gap-2 mb-5">
            <FileText size={16} className="text-primary" />
            <h2 className="font-semibold text-foreground">Sprint Analysis</h2>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <FieldEditor label="Strengths" value={sprint.strengths} field="strengths" sprintId={id} multiline />
            <FieldEditor label="Gaps" value={sprint.gaps} field="gaps" sprintId={id} multiline />
            <FieldEditor label="SWOT Analysis" value={sprint.swotAnalysis} field="swotAnalysis" sprintId={id} multiline />
            <FieldEditor label="Next Goal" value={sprint.nextGoal} field="nextGoal" sprintId={id} multiline />
            <FieldEditor label="Actionable Steps" value={sprint.actionableSteps} field="actionableSteps" sprintId={id} multiline />
            <FieldEditor label="Mentorship Recommendation" value={sprint.mentorshipRecommendation} field="mentorshipRecommendation" sprintId={id} multiline />
            <FieldEditor label="Market Connections" value={sprint.marketConnections} field="marketConnections" sprintId={id} multiline />
          </div>
        </div>
      </div>

      {emailDraft && (
        <EmailModal
          draft={emailDraft}
          onClose={() => setEmailDraft(null)}
          onSent={() => queryClient.invalidateQueries({ queryKey: getGetSprintQueryKey(id) })}
          onRegenerate={handleRegenerate}
          isRegenerating={isGenerating}
        />
      )}
    </Layout>
  );
}

// ─── SheetAiPanel ─────────────────────────────────────────────────────────
// Paste a Google Sheet link with the consultant's session notes for this
// founder — calls the AI route that returns BOTH a pre-sprint and a
// post-sprint email draft. Consultant edits/sends from the existing modal.
function SheetAiPanel({
  sprintId,
  onDrafts,
}: {
  sprintId: number;
  /** Unused — placeholder for future targeting */
  founderEmail?: string;
  onDrafts: (pre: EmailDraft, post: EmailDraft) => void;
}) {
  const { toast } = useToast();
  const [sheetUrl, setSheetUrl] = useState("");
  const [tone, setTone] = useState<Tone>("professional");
  const [busy, setBusy] = useState(false);
  const [lastPreview, setLastPreview] = useState<string | null>(null);

  async function run() {
    if (!sheetUrl.trim()) {
      toast({ title: "Paste a Google Sheet link first", variant: "destructive" });
      return;
    }
    setBusy(true);
    try {
      const r = await customFetch<{
        pre: EmailDraft; post: EmailDraft; sheetPreview?: string;
      }>(`${BASE}/api/ai/sheet-emails`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ sheetUrl, sprintId, tone }),
      });
      onDrafts(r.pre, r.post);
      setLastPreview(r.sheetPreview ?? null);
      toast({ title: "Drafts ready", description: "Review and edit before sending." });
    } catch (err: any) {
      toast({ title: "Could not generate", description: err?.message ?? "Failed", variant: "destructive" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="bg-card border border-card-border rounded-xl p-5 mb-6">
      <div className="flex items-center gap-2 mb-1">
        <FileSpreadsheet size={16} className="text-primary" />
        <h2 className="font-semibold text-sm text-foreground">Draft from Google Sheet</h2>
        <span className="text-[10px] text-muted-foreground bg-muted px-1.5 py-0.5 rounded">AI · editable</span>
      </div>
      <p className="text-xs text-muted-foreground mb-3">
        Paste a Google Sheet link with the session notes. AI will draft BOTH the pre-sprint
        invitation and the post-sprint summary email. You review and edit before anything sends.
      </p>
      <div className="grid grid-cols-1 md:grid-cols-[1fr_auto_auto] gap-2 mb-3">
        <input
          value={sheetUrl}
          onChange={e => setSheetUrl(e.target.value)}
          placeholder="https://docs.google.com/spreadsheets/d/..."
          className="px-3 py-2 bg-background border border-input rounded-md text-sm text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:ring-2 focus:ring-ring"
        />
        <select value={tone} onChange={e => setTone(e.target.value as Tone)}
          className="px-3 py-2 bg-background border border-input rounded-md text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring">
          {TONE_OPTIONS.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
        </select>
        <button onClick={run} disabled={busy}
          className="px-4 py-2 bg-primary text-primary-foreground rounded-md text-sm font-medium hover:opacity-90 transition disabled:opacity-50 flex items-center gap-1.5 justify-center">
          <Wand2 size={14} />{busy ? "Generating…" : "Draft both emails"}
        </button>
      </div>
      <p className="text-[11px] text-muted-foreground/70">
        Tip: Make sure the sheet is shared with your Google account, and Sheets is connected under Settings → Integrations.
      </p>
      {lastPreview && (
        <details className="mt-3 group">
          <summary className="text-[11px] text-muted-foreground hover:text-foreground cursor-pointer">
            What the AI read from the sheet
          </summary>
          <pre className="mt-2 text-[10px] bg-background border border-border rounded p-2 max-h-40 overflow-auto whitespace-pre-wrap break-words text-muted-foreground">{lastPreview}</pre>
        </details>
      )}
    </div>
  );
}

// ─── AiSummaryUpdatePanel ────────────────────────────────────────────────
// AI proposes patches to the founder's Summary Sheet fields based on either
// a Google Sheet link or pasted notes. Consultant reviews per-field and
// applies via PATCH /founders/:id.
function AiSummaryUpdatePanel({
  sprintId,
  founderId,
  onApplied,
}: {
  sprintId: number;
  founderId: number;
  onApplied: () => void;
}) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  type Proposal = { founderId: number; sprintId: number; current: Record<string, any>; proposed: Record<string, any>; changedKeys: string[] };
  const [sheetUrl, setSheetUrl] = useState("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [proposal, setProposal] = useState<Proposal | null>(null);
  // Per-field accept toggles — default all checked, consultant can untick
  const [accept, setAccept] = useState<Record<string, boolean>>({});
  const [edits, setEdits] = useState<Record<string, any>>({});
  const [applying, setApplying] = useState(false);

  async function run() {
    if (!sheetUrl.trim() && !notes.trim()) {
      toast({ title: "Provide a sheet link or paste notes first", variant: "destructive" });
      return;
    }
    setBusy(true);
    setProposal(null);
    try {
      const r = await customFetch<Proposal>(`${BASE}/api/ai/sprints/${sprintId}/summary-update`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ sheetUrl: sheetUrl || undefined, notes: notes || undefined }),
      });
      setProposal(r);
      const initialAccept: Record<string, boolean> = {};
      const initialEdits: Record<string, any> = {};
      for (const k of r.changedKeys) {
        initialAccept[k] = true;
        initialEdits[k] = r.proposed[k];
      }
      setAccept(initialAccept);
      setEdits(initialEdits);
      if (r.changedKeys.length === 0) {
        toast({ title: "Nothing new to update", description: "AI didn't find any field changes worth proposing." });
      } else {
        toast({ title: `${r.changedKeys.length} field${r.changedKeys.length === 1 ? "" : "s"} proposed`, description: "Review below before applying." });
      }
    } catch (err: any) {
      toast({ title: "Could not generate", description: err?.message ?? "Failed", variant: "destructive" });
    } finally {
      setBusy(false);
    }
  }

  async function applyAll() {
    if (!proposal) return;
    const patch: Record<string, any> = {};
    for (const k of proposal.changedKeys) {
      if (accept[k]) patch[k] = edits[k];
    }
    if (Object.keys(patch).length === 0) {
      toast({ title: "No fields selected", variant: "destructive" });
      return;
    }
    setApplying(true);
    try {
      await customFetch(`${BASE}/api/founders/${founderId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(patch),
      });
      toast({ title: `Applied ${Object.keys(patch).length} field${Object.keys(patch).length === 1 ? "" : "s"}` });
      setProposal(null);
      setSheetUrl("");
      setNotes("");
      onApplied();
    } catch (err: any) {
      toast({ title: "Apply failed", description: err?.message ?? "Failed", variant: "destructive" });
    } finally {
      setApplying(false);
    }
  }

  const FIELD_LABELS: Record<string, string> = {
    goalSetting: "Goal Setting",
    keyStrength: "Key Strength",
    gap: "Gaps",
    marketAccess: "Market Access",
    idealCustomerList: "Ideal Customer List",
    mentorRecommendation: "Mentor Recommendation",
    observationsTs: "Observations by TS",
    currentProblem: "Current Problem",
    suggestedNextStep: "Suggested Next Step",
    nextFiveSprints: "Next 5 Sprints",
    tSprintIntervention: "T-Sprint Intervention",
    tasks: "Tasks",
    revenueLast12Months: "Revenue (Last 12m)",
    revenueLastMonthMrr: "MRR (Last Month)",
    fundAskCr: "Fund Ask (Cr)",
    currentBurn: "Current Burn",
    fundraiseNotes: "Fundraise Notes",
  };

  return (
    <div className="bg-card border border-card-border rounded-xl p-5 mb-6">
      <div className="flex items-center gap-2 mb-1">
        <Sparkles size={16} className="text-primary" />
        <h2 className="font-semibold text-sm text-foreground">Update Summary Sheet with AI</h2>
        <span className="text-[10px] text-muted-foreground bg-muted px-1.5 py-0.5 rounded">AI · review-before-apply</span>
      </div>
      <p className="text-xs text-muted-foreground mb-3">
        AI reads your session notes (paste below, OR link a Google Sheet) and proposes patches
        to this founder's Summary Sheet fields. Nothing is saved until you click <em>Apply selected</em>.
      </p>

      <div className="grid grid-cols-1 gap-2 mb-3">
        <input
          value={sheetUrl}
          onChange={e => setSheetUrl(e.target.value)}
          placeholder="https://docs.google.com/spreadsheets/d/...  (optional)"
          className="px-3 py-2 bg-background border border-input rounded-md text-sm text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:ring-2 focus:ring-ring"
        />
        <textarea
          value={notes}
          onChange={e => setNotes(e.target.value)}
          rows={3}
          placeholder="…or paste your raw session notes here"
          className="px-3 py-2 bg-background border border-input rounded-md text-sm text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:ring-2 focus:ring-ring resize-y"
        />
        <div className="flex gap-2">
          <button onClick={run} disabled={busy}
            className="px-4 py-2 bg-primary text-primary-foreground rounded-md text-sm font-medium hover:opacity-90 transition disabled:opacity-50 flex items-center gap-1.5">
            <Wand2 size={14} />{busy ? "Analyzing…" : "Propose updates"}
          </button>
          {proposal && proposal.changedKeys.length > 0 && (
            <button onClick={applyAll} disabled={applying}
              className="px-4 py-2 bg-emerald-600 text-white rounded-md text-sm font-medium hover:opacity-90 transition disabled:opacity-50 flex items-center gap-1.5">
              <Check size={14} />{applying ? "Applying…" : `Apply selected (${Object.values(accept).filter(Boolean).length})`}
            </button>
          )}
        </div>
      </div>

      {/* Proposed patches review */}
      {proposal && proposal.changedKeys.length > 0 && (
        <div className="border-t border-border pt-3 mt-3 space-y-3">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Proposed changes</p>
          {proposal.changedKeys.map(k => (
            <div key={k} className="bg-background border border-border rounded-lg p-3">
              <div className="flex items-start justify-between gap-3 mb-2">
                <label className="flex items-center gap-2 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={accept[k] ?? true}
                    onChange={e => setAccept(a => ({ ...a, [k]: e.target.checked }))}
                    className="rounded border-input"
                  />
                  <span className="text-sm font-medium text-foreground">{FIELD_LABELS[k] ?? k}</span>
                </label>
              </div>
              {proposal.current[k] && (
                <div className="text-[10px] text-muted-foreground mb-1">
                  <span className="font-semibold uppercase tracking-wide">Current: </span>
                  <span className="line-through opacity-60">{String(proposal.current[k])}</span>
                </div>
              )}
              <textarea
                value={String(edits[k] ?? "")}
                onChange={e => setEdits(ed => ({ ...ed, [k]: e.target.value }))}
                rows={2}
                disabled={!(accept[k] ?? true)}
                className="w-full px-2.5 py-1.5 bg-background border border-input rounded text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring resize-y disabled:opacity-50"
              />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
