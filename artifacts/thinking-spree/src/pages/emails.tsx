import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react";
import { Layout } from "@/components/Layout";
import { useToast } from "@/hooks/use-toast";
import {
  Popover, PopoverTrigger, PopoverContent,
} from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  Mail, Link2, Sparkles, Loader2, Plus, Trash2, Pencil, Send, Bold,
  Highlighter, Link as LinkIcon, Eye, EyeOff, Check, X, Calendar as CalendarIcon,
  Clock, Users, ChevronDown, RefreshCw, FileText,
} from "lucide-react";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");
const api = (p: string) => `${BASE}/api${p}`;
const GOLD = "var(--gold)";

type Mode = "pre" | "post";
type Attendee = { email: string; name: string | null; organizer?: boolean; self?: boolean };
type Template = { id: number; kind: Mode; name: string; body: string };
type Extracted = {
  companyName: string | null; founderName: string | null; cohort: string | null;
  sheetUrl: string; attendees: Attendee[];
  calendarEvent: { summary: string; date: string | null; time: string | null } | null;
};

const HOURS = Array.from({ length: 12 }, (_, i) => i + 1);
const MINUTES = ["00", "15", "30", "45"];

export default function EmailsPage() {
  const initialMode = (new URLSearchParams(typeof window !== "undefined" ? window.location.search : "").get("mode") as Mode | null);
  const [mode, setMode] = useState<Mode>(initialMode === "post" ? "post" : "pre");

  useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    if (mode === "post") p.set("mode", "post"); else p.delete("mode");
    const qs = p.toString();
    window.history.replaceState(null, "", `${window.location.pathname}${qs ? `?${qs}` : ""}`);
  }, [mode]);

  return (
    <Layout>
      <div className="p-6 lg:p-8">
        <div className="mb-5">
          <div className="mb-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
            Sprint lifecycle · Communications
          </div>
          <div className="flex flex-wrap items-end justify-between gap-3">
            <h1 className="font-serif text-4xl leading-tight text-foreground">Emails</h1>
            <GmailStatus />
          </div>
          <div className="mt-4 inline-flex gap-1 rounded-xl border border-border p-1" style={{ background: "hsl(220 18% 94%)" }}>
            {(["pre", "post"] as Mode[]).map((m) => {
              const on = mode === m;
              return (
                <button key={m} onClick={() => setMode(m)}
                  className="rounded-lg px-4 py-2 text-sm font-medium transition-colors"
                  style={{ background: on ? "hsl(var(--card))" : "transparent", color: on ? "hsl(var(--primary))" : "hsl(var(--muted-foreground))" }}>
                  {m === "pre" ? "Pre-Sprint email" : "Post-Sprint email"}
                </button>
              );
            })}
          </div>
        </div>

        {/* key forces a clean reset of the whole workspace when switching modes */}
        <EmailWorkspace key={mode} mode={mode} />
      </div>
    </Layout>
  );
}

function GmailStatus() {
  const { data } = useQuery<{ connected: boolean; email?: string }>({
    queryKey: ["google-status-lite"],
    queryFn: async () => {
      try {
        const r = await customFetch(api("/google/status"), { credentials: "include" }) as any;
        const gmail = r?.services?.gmail ?? r?.gmail ?? null;
        return { connected: !!(r?.connected ?? gmail), email: r?.email ?? r?.googleEmail };
      } catch { return { connected: false }; }
    },
    staleTime: 60_000,
  });
  return (
    <span className="inline-flex items-center gap-2 text-xs text-muted-foreground">
      <span className="h-2 w-2 rounded-full" style={{ background: data?.connected ? "#1D9E75" : "hsl(0 60% 60%)" }} />
      {data?.connected ? `Gmail connected${data.email ? ` · ${data.email}` : ""}` : "Gmail not connected — Settings → Google"}
    </span>
  );
}

/* ─────────────────────────── workspace ─────────────────────────────────── */
function EmailWorkspace({ mode }: { mode: Mode }) {
  const { toast } = useToast();
  const qc = useQueryClient();

  const [sheetUrl, setSheetUrl] = useState("");
  const [extracting, setExtracting] = useState(false);
  const [ex, setEx] = useState<Extracted | null>(null);
  const [companyName, setCompanyName] = useState("");
  const [founderName, setFounderName] = useState("");
  const [cohort, setCohort] = useState("");

  // recipient bucketing: email → "to" | "cc"
  const [people, setPeople] = useState<Attendee[]>([]);
  const [assign, setAssign] = useState<Record<string, "to" | "cc">>({});
  const [manualEmail, setManualEmail] = useState("");

  // post-sprint engagement
  const [engagement, setEngagement] = useState<"single" | "multi">("single");
  const [nextSprintNumber, setNextSprintNumber] = useState("");
  const [nextDate, setNextDate] = useState<Date | undefined>();
  const [tHour, setTHour] = useState("10");
  const [tMin, setTMin] = useState("00");
  const [tAmPm, setTAmPm] = useState<"AM" | "PM">("AM");

  const [selectedTemplateId, setSelectedTemplateId] = useState<number | null>(null);
  const [drafting, setDrafting] = useState(false);
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [preview, setPreview] = useState(false);
  const [sending, setSending] = useState(false);
  const bodyRef = useRef<HTMLTextAreaElement | null>(null);

  const templatesQ = useQuery<{ templates: Template[] }>({
    queryKey: ["email-templates", mode],
    queryFn: () => customFetch(api(`/email/templates?kind=${mode}`), { credentials: "include" }),
  });
  const templates = templatesQ.data?.templates ?? [];

  const to = useMemo(() => people.filter((p) => assign[p.email] === "to").map((p) => p.email), [people, assign]);
  const cc = useMemo(() => people.filter((p) => assign[p.email] === "cc").map((p) => p.email), [people, assign]);

  async function pullSheet() {
    if (!sheetUrl.trim()) { toast({ title: "Paste the T-Sheet link first", variant: "destructive" }); return; }
    setExtracting(true);
    try {
      const res = await fetch(api("/email/extract-sheet"), {
        method: "POST", credentials: "include", headers: { "content-type": "application/json" },
        body: JSON.stringify({ sheetUrl: sheetUrl.trim() }),
      });
      if (!res.ok) throw new Error((await res.json()).error || "Extraction failed");
      const data: Extracted = await res.json();
      setEx(data);
      setCompanyName(data.companyName ?? "");
      setFounderName(data.founderName ?? "");
      setCohort(data.cohort ?? "");
      setPeople(data.attendees ?? []);
      // default: non-self attendees → To
      const a: Record<string, "to" | "cc"> = {};
      for (const p of data.attendees ?? []) if (!p.self) a[p.email] = "to";
      setAssign(a);
      toast({ title: "Sheet read", description: "Review the fields and pick who to email." });
    } catch (e: any) {
      toast({ title: "Couldn’t read the sheet", description: e.message, variant: "destructive" });
    } finally { setExtracting(false); }
  }

  function addManual() {
    const addr = manualEmail.trim();
    if (!addr || !addr.includes("@")) { toast({ title: "Enter a valid email", variant: "destructive" }); return; }
    if (people.some((p) => p.email.toLowerCase() === addr.toLowerCase())) { setManualEmail(""); return; }
    setPeople((prev) => [...prev, { email: addr, name: null }]);
    setAssign((prev) => ({ ...prev, [addr]: "to" }));
    setManualEmail("");
  }
  function cycle(email: string) {
    setAssign((prev) => {
      const cur = prev[email];
      const next = cur === "to" ? "cc" : cur === "cc" ? undefined : "to";
      const copy = { ...prev };
      if (next) copy[email] = next; else delete copy[email];
      return copy;
    });
  }

  function timeString() {
    return `${tHour}:${tMin} ${tAmPm} IST`;
  }
  function dateString() {
    return nextDate ? nextDate.toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long", year: "numeric" }) : null;
  }

  async function generate() {
    if (!companyName.trim()) { toast({ title: "Company name is required", variant: "destructive" }); return; }
    setDrafting(true);
    try {
      const context: Record<string, unknown> = {
        companyName, founderName, cohort,
        sheetUrl: ex?.sheetUrl ?? sheetUrl,
        thinkingSheetUrl: ex?.sheetUrl ?? sheetUrl,
        sprintDate: ex?.calendarEvent?.date ?? null,
        sprintTime: ex?.calendarEvent?.time ?? null,
      };
      if (mode === "post") {
        context.engagementType = engagement;
        if (engagement === "multi") {
          context.nextSprintNumber = nextSprintNumber || null;
          context.nextSprintDate = dateString();
          context.nextSprintTime = timeString();
        }
      }
      const res = await fetch(api("/email/draft"), {
        method: "POST", credentials: "include", headers: { "content-type": "application/json" },
        body: JSON.stringify({ kind: mode, templateId: selectedTemplateId, context }),
      });
      if (!res.ok) throw new Error((await res.json()).error || "Draft failed");
      const d = await res.json();
      setSubject(d.subject); setBody(d.body); setPreview(false);
      toast({ title: "Draft ready", description: "Edit freely, then send." });
    } catch (e: any) {
      toast({ title: "Couldn’t draft the email", description: e.message, variant: "destructive" });
    } finally { setDrafting(false); }
  }

  function wrap(before: string, after: string, placeholder: string) {
    const el = bodyRef.current; if (!el) return;
    const start = el.selectionStart ?? 0, end = el.selectionEnd ?? 0;
    const sel = body.slice(start, end) || placeholder;
    const next = body.slice(0, start) + before + sel + after + body.slice(end);
    setBody(next);
    requestAnimationFrame(() => { el.focus(); el.selectionStart = start + before.length; el.selectionEnd = start + before.length + sel.length; });
  }
  function addLink() {
    const url = window.prompt("Link URL (https://…)"); if (!url) return;
    const el = bodyRef.current; if (!el) return;
    const start = el.selectionStart ?? 0, end = el.selectionEnd ?? 0;
    const sel = body.slice(start, end) || "link";
    const next = body.slice(0, start) + `[${sel}](${url})` + body.slice(end);
    setBody(next);
  }

  async function send() {
    if (!subject.trim() || !body.trim()) { toast({ title: "Nothing to send yet", variant: "destructive" }); return; }
    if (to.length === 0) { toast({ title: "Add at least one To recipient", variant: "destructive" }); return; }
    setSending(true);
    try {
      const res = await fetch(api("/email/send"), {
        method: "POST", credentials: "include", headers: { "content-type": "application/json" },
        body: JSON.stringify({ to, cc, subject, body }),
      });
      if (!res.ok) throw new Error((await res.json()).error || "Send failed");
      toast({ title: "Email sent", description: `To ${to.join(", ")}` });
    } catch (e: any) {
      toast({ title: "Couldn’t send", description: e.message, variant: "destructive" });
    } finally { setSending(false); }
  }

  return (
    <div className="grid grid-cols-1 gap-5 lg:grid-cols-[300px_minmax(0,1fr)_260px]">
      {/* LEFT — source + extracted + (post) engagement */}
      <div className="space-y-4">
        <Card>
          <SectionLabel icon={Link2}>Source · T-Sheet</SectionLabel>
          <div className="relative mt-2">
            <Link2 size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <input className="ts-input pl-8" placeholder="docs.google.com/spreadsheets/…" value={sheetUrl} onChange={(e) => setSheetUrl(e.target.value)} />
          </div>
          <button onClick={pullSheet} disabled={extracting}
            className="mt-2.5 inline-flex w-full items-center justify-center gap-2 rounded-lg px-3 py-2.5 text-sm font-semibold"
            style={{ background: GOLD, color: "hsl(222 38% 15%)" }}>
            {extracting ? <Loader2 size={15} className="animate-spin" /> : <Sparkles size={15} />}
            {extracting ? "Reading…" : "Pull data from T-Sheet"}
          </button>
        </Card>

        {ex && (
          <Card>
            <SectionLabel icon={Check} tone="ok">Extracted by AI</SectionLabel>
            <div className="mt-2 space-y-2.5">
              <Field label="Company"><input className="ts-input" value={companyName} onChange={(e) => setCompanyName(e.target.value)} /></Field>
              <Field label="Founder"><input className="ts-input" value={founderName} onChange={(e) => setFounderName(e.target.value)} /></Field>
              <Field label="Cohort"><input className="ts-input" value={cohort} onChange={(e) => setCohort(e.target.value)} /></Field>
            </div>
            {ex.calendarEvent && (
              <div className="mt-3 flex items-start gap-1.5 rounded-lg border border-border bg-muted/40 p-2 text-[11px] text-muted-foreground">
                <CalendarIcon size={13} className="mt-0.5 shrink-0" />
                <span>Matched invite: <span className="text-foreground">{ex.calendarEvent.summary}</span>{ex.calendarEvent.date ? ` · ${ex.calendarEvent.date}` : ""}{ex.calendarEvent.time ? `, ${ex.calendarEvent.time}` : ""}</span>
              </div>
            )}
            <p className="mt-2 flex items-center gap-1 text-[10px] text-muted-foreground"><Pencil size={11} /> Fields are editable if the AI mis-reads.</p>
          </Card>
        )}

        {mode === "post" && ex && (
          <Card>
            <SectionLabel icon={RefreshCw}>Engagement</SectionLabel>
            <div className="mt-2 grid grid-cols-2 gap-2">
              {(["single", "multi"] as const).map((v) => (
                <button key={v} onClick={() => setEngagement(v)}
                  className="rounded-lg border px-3 py-2 text-xs font-medium"
                  style={{ borderColor: engagement === v ? "var(--gold)" : "hsl(var(--border))", background: engagement === v ? "hsl(36 65% 96%)" : "hsl(var(--card))", color: "hsl(var(--foreground))" }}>
                  {v === "single" ? "Single sprint" : "Multi-sprint"}
                </button>
              ))}
            </div>
            {engagement === "multi" && (
              <div className="mt-3 space-y-2.5">
                <Field label="Next sprint number"><input className="ts-input" placeholder="e.g. 2" value={nextSprintNumber} onChange={(e) => setNextSprintNumber(e.target.value)} /></Field>
                <Field label="Next sprint date">
                  <Popover>
                    <PopoverTrigger asChild>
                      <button className="ts-input flex items-center justify-between text-left">
                        <span className={nextDate ? "text-foreground" : "text-muted-foreground"}>{nextDate ? dateString() : "Pick a date"}</span>
                        <CalendarIcon size={14} className="text-muted-foreground" />
                      </button>
                    </PopoverTrigger>
                    <PopoverContent className="w-auto p-0" align="start">
                      <Calendar mode="single" selected={nextDate} onSelect={setNextDate} />
                    </PopoverContent>
                  </Popover>
                </Field>
                <Field label="Next sprint time">
                  <div className="flex items-center gap-1.5">
                    <Clock size={14} className="text-muted-foreground" />
                    <select className="ts-input" style={{ width: "auto" }} value={tHour} onChange={(e) => setTHour(e.target.value)}>
                      {HOURS.map((h) => <option key={h} value={String(h)}>{h}</option>)}
                    </select>
                    <span className="text-muted-foreground">:</span>
                    <select className="ts-input" style={{ width: "auto" }} value={tMin} onChange={(e) => setTMin(e.target.value)}>
                      {MINUTES.map((m) => <option key={m} value={m}>{m}</option>)}
                    </select>
                    <select className="ts-input" style={{ width: "auto" }} value={tAmPm} onChange={(e) => setTAmPm(e.target.value as "AM" | "PM")}>
                      <option value="AM">AM</option><option value="PM">PM</option>
                    </select>
                  </div>
                </Field>
              </div>
            )}
          </Card>
        )}
      </div>

      {/* CENTER — recipients + draft editor */}
      <div className="min-w-0 space-y-4">
        {ex && (
          <Card>
            <SectionLabel icon={Users}>Recipients</SectionLabel>
            <p className="mt-1 text-[11px] text-muted-foreground">From the calendar invite. Tap a name to move it To → Cc → off.</p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {people.length === 0 && <span className="text-xs text-muted-foreground">No attendees found — add emails manually below.</span>}
              {people.map((p) => {
                const role = assign[p.email];
                return (
                  <button key={p.email} onClick={() => cycle(p.email)}
                    className="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs"
                    style={{
                      borderColor: role ? "var(--gold)" : "hsl(var(--border))",
                      background: role === "to" ? "hsl(36 65% 94%)" : role === "cc" ? "hsl(220 18% 94%)" : "transparent",
                      color: "hsl(var(--foreground))",
                    }}>
                    {role && <span className="rounded px-1 text-[9px] font-bold uppercase" style={{ background: role === "to" ? "var(--gold)" : "hsl(220 12% 70%)", color: "#fff" }}>{role}</span>}
                    <span className="max-w-[180px] truncate">{p.name ? `${p.name} · ${p.email}` : p.email}</span>
                  </button>
                );
              })}
            </div>
            <div className="mt-2.5 flex items-center gap-2">
              <input className="ts-input" placeholder="Add email manually" value={manualEmail}
                onChange={(e) => setManualEmail(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addManual(); } }} />
              <button onClick={addManual} className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-border px-3 py-2 text-xs font-medium hover:border-foreground/20"><Plus size={13} /> Add</button>
            </div>
          </Card>
        )}

        <Card className="flex min-h-[420px] flex-col">
          <div className="mb-2 flex items-center justify-between">
            <SectionLabel icon={FileText}>Draft</SectionLabel>
            <div className="flex items-center gap-1 rounded-lg p-0.5" style={{ background: "hsl(220 18% 94%)" }}>
              <ToolBtn title="Bold" onClick={() => wrap("**", "**", "bold text")}><Bold size={14} /></ToolBtn>
              <ToolBtn title="Highlight" onClick={() => wrap("==", "==", "highlight")}><Highlighter size={14} /></ToolBtn>
              <ToolBtn title="Add link" onClick={addLink}><LinkIcon size={14} /></ToolBtn>
              <ToolBtn title={preview ? "Edit" : "Preview"} onClick={() => setPreview((p) => !p)}>{preview ? <EyeOff size={14} /> : <Eye size={14} />}</ToolBtn>
            </div>
          </div>

          {!subject && !body && !drafting ? (
            <div className="flex flex-1 flex-col items-center justify-center rounded-xl border border-dashed border-border p-8 text-center">
              <Sparkles size={22} style={{ color: GOLD }} />
              <p className="mt-2 text-sm font-medium text-foreground">Pick a template, then generate</p>
              <p className="mt-1 max-w-xs text-xs text-muted-foreground">
                {ex ? "Choose a template on the right and hit Generate — the AI fills it in from the sheet." : "Pull a T-Sheet on the left to begin."}
              </p>
              <button onClick={generate} disabled={!ex || drafting}
                className="mt-4 inline-flex items-center gap-2 rounded-lg px-4 py-2.5 text-sm font-semibold disabled:opacity-50"
                style={{ background: GOLD, color: "hsl(222 38% 15%)" }}>
                <Sparkles size={15} /> Generate draft
              </button>
            </div>
          ) : (
            <div className="flex flex-1 flex-col overflow-hidden rounded-xl border border-border bg-card">
              <div className="flex items-center gap-2 border-b border-border px-3 py-2">
                <span className="w-14 text-[11px] text-muted-foreground">Subject</span>
                <input className="flex-1 bg-transparent text-sm font-medium text-foreground outline-none" value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="Subject line" />
              </div>
              {preview ? (
                <div className="flex-1 overflow-auto px-4 py-3 text-sm leading-relaxed"
                  dangerouslySetInnerHTML={{ __html: renderPreview(body) }} />
              ) : (
                <textarea ref={bodyRef} value={body} onChange={(e) => setBody(e.target.value)}
                  className="flex-1 resize-none bg-transparent px-4 py-3 text-sm leading-relaxed text-foreground outline-none"
                  placeholder="Your draft will appear here…" />
              )}
              <div className="flex items-center justify-between gap-2 border-t border-border px-3 py-2.5" style={{ background: "hsl(42 30% 99%)" }}>
                <span className="truncate text-[11px] text-muted-foreground">
                  {drafting ? "Drafting…" : to.length ? `To ${to.join(", ")}${cc.length ? ` · Cc ${cc.length}` : ""}` : "No recipients yet"}
                </span>
                <div className="flex shrink-0 items-center gap-2">
                  <button onClick={generate} disabled={drafting || !ex}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-1.5 text-xs font-medium hover:border-foreground/20 disabled:opacity-50">
                    {drafting ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />} Regenerate
                  </button>
                  <button onClick={send} disabled={sending}
                    className="inline-flex items-center gap-1.5 rounded-lg px-4 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
                    style={{ background: "hsl(222 52% 24%)" }}>
                    {sending ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />} Send email
                  </button>
                </div>
              </div>
            </div>
          )}
          <p className="mt-2 text-[10px] text-muted-foreground">Formatting: <code>**bold**</code>, <code>==highlight==</code>, <code>[text](url)</code> — rendered when sent.</p>
        </Card>
      </div>

      {/* RIGHT — templates */}
      <div>
        <TemplateRail
          mode={mode} templates={templates} loading={templatesQ.isLoading}
          selectedId={selectedTemplateId} onSelect={setSelectedTemplateId}
          onChanged={() => qc.invalidateQueries({ queryKey: ["email-templates", mode] })}
        />
      </div>
    </div>
  );
}

/* ─────────────────────────── template rail ─────────────────────────────── */
function TemplateRail({ mode, templates, loading, selectedId, onSelect, onChanged }: {
  mode: Mode; templates: Template[]; loading: boolean;
  selectedId: number | null; onSelect: (id: number) => void; onChanged: () => void;
}) {
  const { toast } = useToast();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Template | null>(null);
  const [name, setName] = useState("");
  const [body, setBody] = useState("");

  function openNew() { setEditing(null); setName(""); setBody(""); setDialogOpen(true); }
  function openEdit(t: Template) { setEditing(t); setName(t.name); setBody(t.body); setDialogOpen(true); }

  const save = useMutation({
    mutationFn: async () => {
      if (!name.trim() || !body.trim()) throw new Error("Name and body are required");
      const url = editing ? api(`/email/templates/${editing.id}`) : api("/email/templates");
      const res = await fetch(url, {
        method: editing ? "PATCH" : "POST", credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(editing ? { name, body } : { kind: mode, name, body }),
      });
      if (!res.ok) throw new Error((await res.json()).error || "Save failed");
    },
    onSuccess: () => { setDialogOpen(false); onChanged(); toast({ title: editing ? "Template updated" : "Template added" }); },
    onError: (e: any) => toast({ title: "Couldn’t save template", description: e.message, variant: "destructive" }),
  });

  const del = useMutation({
    mutationFn: async (id: number) => {
      const res = await fetch(api(`/email/templates/${id}`), { method: "DELETE", credentials: "include" });
      if (!res.ok) throw new Error((await res.json()).error || "Delete failed");
    },
    onSuccess: () => { onChanged(); toast({ title: "Template deleted" }); },
    onError: (e: any) => toast({ title: "Couldn’t delete", description: e.message, variant: "destructive" }),
  });

  return (
    <div className="rounded-xl border border-border p-3" style={{ background: "hsl(42 24% 97%)" }}>
      <SectionLabel icon={FileText}>Templates</SectionLabel>
      <div className="mt-2 space-y-2">
        {loading && <div className="text-xs text-muted-foreground">Loading…</div>}
        {!loading && templates.length === 0 && (
          <div className="rounded-lg border border-dashed border-border p-3 text-xs text-muted-foreground">
            No {mode === "pre" ? "pre-sprint" : "post-sprint"} templates yet. Add one — it stays until you delete it.
          </div>
        )}
        {templates.map((t) => {
          const on = selectedId === t.id;
          return (
            <div key={t.id} onClick={() => onSelect(t.id)}
              className="group cursor-pointer rounded-lg border p-2.5"
              style={{ borderColor: on ? "var(--gold)" : "hsl(var(--border))", borderWidth: on ? 1.5 : 1, background: on ? "hsl(36 65% 96%)" : "hsl(var(--card))" }}>
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium" style={{ color: on ? "hsl(30 55% 32%)" : "hsl(var(--foreground))" }}>{t.name}</div>
                  <div className="mt-0.5 line-clamp-2 text-[11px] text-muted-foreground">{t.body.slice(0, 90)}</div>
                </div>
                <div className="flex shrink-0 gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
                  <button onClick={(e) => { e.stopPropagation(); openEdit(t); }} className="rounded p-1 text-muted-foreground hover:text-foreground" title="Edit"><Pencil size={12} /></button>
                  <button onClick={(e) => { e.stopPropagation(); if (confirm(`Delete “${t.name}”?`)) del.mutate(t.id); }} className="rounded p-1 text-muted-foreground hover:text-destructive" title="Delete"><Trash2 size={12} /></button>
                </div>
              </div>
            </div>
          );
        })}
      </div>
      <button onClick={openNew} className="mt-2.5 inline-flex w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-border py-2 text-xs font-medium text-foreground hover:border-foreground/30">
        <Plus size={14} /> New template
      </button>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="font-serif text-xl">{editing ? "Edit template" : `New ${mode === "pre" ? "pre-sprint" : "post-sprint"} template`}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <Field label="Template name"><input className="ts-input" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Need Assessment intro" /></Field>
            <Field label="Template body">
              <textarea className="ts-input min-h-[220px] font-mono text-xs leading-relaxed" value={body} onChange={(e) => setBody(e.target.value)}
                placeholder={"Hi [Founder's Name],\n\n… use [merge fields] like [Name of the company], [Cohort], [Day], [Date of Sprint]. The AI fills them from the sheet + calendar."} />
            </Field>
            <p className="text-[11px] text-muted-foreground">Use square-bracket placeholders. The AI replaces them and keeps your wording.</p>
          </div>
          <DialogFooter>
            <button onClick={() => setDialogOpen(false)} className="rounded-lg border border-border px-4 py-2 text-sm hover:border-foreground/20">Cancel</button>
            <button onClick={() => save.mutate()} disabled={save.isPending}
              className="inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold" style={{ background: GOLD, color: "hsl(222 38% 15%)" }}>
              {save.isPending ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />} {editing ? "Save changes" : "Add template"}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/* ─────────────────────────── small pieces ──────────────────────────────── */
function Card({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <div className={`rounded-xl border border-border bg-card p-4 ${className}`}>{children}<FieldStyles /></div>;
}
function SectionLabel({ children, icon: Icon, tone }: { children: React.ReactNode; icon: React.ElementType; tone?: "ok" }) {
  return (
    <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
      <Icon size={13} style={{ color: tone === "ok" ? "#1D9E75" : "currentColor" }} /> {children}
    </div>
  );
}
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[10px] font-medium uppercase tracking-wide text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}
function ToolBtn({ children, title, onClick }: { children: React.ReactNode; title: string; onClick: () => void }) {
  return (
    <button type="button" title={title} onClick={onClick}
      className="flex h-7 w-7 items-center justify-center rounded-md text-foreground/80 hover:bg-white hover:text-foreground">
      {children}
    </button>
  );
}

/** Client-side mirror of the server's markup → HTML for the Preview toggle. */
function renderPreview(body: string): string {
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return body.replace(/\r\n/g, "\n").split(/\n{2,}/).map((para) => {
    let x = esc(para);
    x = x.replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2" style="color:#1d4ed8;text-decoration:underline;">$1</a>');
    x = x.replace(/==(.+?)==/gs, '<mark style="background:#fde68a;padding:0 2px;">$1</mark>');
    x = x.replace(/\*\*(.+?)\*\*/gs, "<strong>$1</strong>");
    x = x.replace(/\n/g, "<br>");
    return `<p style="margin:0 0 12px 0;">${x}</p>`;
  }).join("");
}

function FieldStyles() {
  return (
    <style>{`
      .ts-input { width:100%; box-sizing:border-box; border:1px solid hsl(var(--border)); border-radius:8px;
        background:#fff; padding:8px 10px; font-size:13px; color:hsl(var(--foreground)); outline:none; }
      .ts-input:focus { border-color: var(--gold); box-shadow: 0 0 0 3px hsl(36 65% 56% / 0.15); }
    `}</style>
  );
}
