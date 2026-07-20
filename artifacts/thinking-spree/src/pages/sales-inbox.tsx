import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react";
import { Layout } from "@/components/Layout";
import { useToast } from "@/hooks/use-toast";
import {
  Mail, RefreshCw, Loader2, Search, Download, ChevronDown, Check,
  ArrowUpRight, Users, AlertTriangle, Clock,
} from "lucide-react";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");
const api = (p: string) => `${BASE}/api${p}`;
const GOLD = "var(--gold)";
const NAVY = "hsl(222 47% 20%)";

type Role = "founder" | "investor" | "partner" | "other";
type Contact = {
  id: number; email: string; name: string | null; company: string | null; domain: string | null;
  role: Role; roleLabel: string | null; roleSource: "ai" | "user"; confidence: number | null;
  emailsTotal: number; sentCount: number; receivedCount: number;
  lastContactAt: string | null; replyStatus: "replied" | "awaiting" | "none"; promotedLeadId: number | null;
};
type Stats = {
  contacts: number; emails: number; sent: number; received: number; replyRate: number;
  newWeek: number; cold: number; byRole: { role: Role; n: number }[]; lastSyncedAt: string | null;
};
type SyncState = { status: "idle" | "running" | "error"; phase?: string | null; processed: number; total: number; lastSyncedAt: string | null; message?: string | null };

const ROLE_META: Record<Role, { label: string; bg: string; fg: string }> = {
  founder: { label: "Founder", bg: "hsl(36 65% 94%)", fg: "#8A5A00" },
  investor: { label: "Investor", bg: "#E6F1FB", fg: "#0C447C" },
  partner: { label: "Partner", bg: "#E1F5EE", fg: "#0F6E56" },
  other: { label: "Other", bg: "#F1EFE8", fg: "#5F5E5A" },
};
const WINDOWS: { label: string; v: number | "all" }[] = [
  { label: "3 months", v: 3 }, { label: "6 months", v: 6 }, { label: "12 months", v: 12 },
  { label: "18 months", v: 18 }, { label: "24 months", v: 24 }, { label: "36 months", v: 36 }, { label: "All time", v: "all" },
];

function timeAgo(iso: string | null) {
  if (!iso) return "—";
  const d = (Date.now() - new Date(iso).getTime()) / 86400000;
  if (d < 1) return "today"; if (d < 2) return "1d ago"; if (d < 7) return `${Math.floor(d)}d ago`;
  if (d < 30) return `${Math.floor(d / 7)}w ago`; if (d < 365) return `${Math.floor(d / 30)}mo ago`;
  return `${Math.floor(d / 365)}y ago`;
}

export default function SalesInboxPage() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [role, setRole] = useState<string>("all");
  const [status, setStatus] = useState<string>("all");
  const [search, setSearch] = useState("");
  const [debounced, setDebounced] = useState("");
  const [sort, setSort] = useState("recent");
  const [page, setPage] = useState(1);
  const [windowV, setWindowV] = useState<number | "all">(12);
  const pageSize = 25;

  useEffect(() => { const t = setTimeout(() => setDebounced(search), 300); return () => clearTimeout(t); }, [search]);
  useEffect(() => { setPage(1); }, [role, status, debounced, sort]);

  const syncQ = useQuery<SyncState>({
    queryKey: ["contacts-sync"],
    queryFn: () => customFetch(api("/contacts/sync-status"), { credentials: "include" }),
    refetchInterval: (q) => (q.state.data?.status === "running" ? 1500 : false),
  });
  const running = syncQ.data?.status === "running";
  useEffect(() => {
    if (syncQ.data?.status === "idle") { qc.invalidateQueries({ queryKey: ["contacts-list"] }); qc.invalidateQueries({ queryKey: ["contacts-stats"] }); }
  }, [syncQ.data?.status, syncQ.data?.lastSyncedAt]);

  const statsQ = useQuery<Stats>({ queryKey: ["contacts-stats"], queryFn: () => customFetch(api("/contacts/stats"), { credentials: "include" }) });
  const listQ = useQuery<{ contacts: Contact[]; total: number }>({
    queryKey: ["contacts-list", role, status, debounced, sort, page],
    queryFn: () => customFetch(api(`/contacts?role=${role}&status=${status}&search=${encodeURIComponent(debounced)}&sort=${sort}&page=${page}&pageSize=${pageSize}`), { credentials: "include" }),
  });

  async function startSync(incremental: boolean) {
    try {
      const res = await fetch(api("/contacts/sync"), {
        method: "POST", credentials: "include", headers: { "content-type": "application/json" },
        body: JSON.stringify({ windowMonths: windowV, incremental }),
      });
      if (res.status === 409) { toast({ title: "A sync is already running" }); return; }
      if (!res.ok) throw new Error((await res.json()).error || "Failed to start");
      toast({ title: incremental ? "Refreshing new mail…" : "Analysing your inbox…", description: "This runs in the background — keep working." });
      qc.invalidateQueries({ queryKey: ["contacts-sync"] });
    } catch (e: any) { toast({ title: "Couldn’t start", description: e.message, variant: "destructive" }); }
  }

  async function patchContact(id: number, body: Record<string, unknown>) {
    await fetch(api(`/contacts/${id}`), { method: "PATCH", credentials: "include", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    qc.invalidateQueries({ queryKey: ["contacts-list"] }); qc.invalidateQueries({ queryKey: ["contacts-stats"] });
  }
  async function promote(id: number) {
    try {
      const res = await fetch(api(`/contacts/${id}/promote`), { method: "POST", credentials: "include" });
      if (!res.ok) throw new Error((await res.json()).error || "Failed");
      toast({ title: "Promoted to pipeline" });
      qc.invalidateQueries({ queryKey: ["contacts-list"] });
    } catch (e: any) { toast({ title: "Couldn’t promote", description: e.message, variant: "destructive" }); }
  }

  const stats = statsQ.data;
  const total = listQ.data?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const roleCount = (r: Role) => stats?.byRole.find((x) => x.role === r)?.n ?? 0;
  const distTotal = Math.max(1, (stats?.byRole ?? []).reduce((a, b) => a + b.n, 0));

  return (
    <Layout>
      <div className="p-6 lg:p-8">
        {/* header */}
        <div className="mb-5">
          <div className="mb-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">Sales · Inbox CRM</div>
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <h1 className="font-serif text-4xl leading-tight text-foreground">Contacts &amp; inbox analytics</h1>
              <p className="mt-1 text-sm text-muted-foreground">
                {stats?.lastSyncedAt ? <>Synced {timeAgo(stats.lastSyncedAt)} · {stats.emails.toLocaleString()} emails analysed</> : "Not analysed yet — pick a window and run it."}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <div className="relative">
                <select value={String(windowV)} onChange={(e) => setWindowV(e.target.value === "all" ? "all" : Number(e.target.value))}
                  className="ts-input appearance-none pr-8" style={{ width: "auto" }}>
                  {WINDOWS.map((w) => <option key={String(w.v)} value={String(w.v)}>{w.label}</option>)}
                </select>
                <ChevronDown size={14} className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
              </div>
              <button onClick={() => startSync(false)} disabled={running}
                className="inline-flex items-center gap-2 rounded-lg border border-border bg-card px-3.5 py-2.5 text-sm font-medium text-foreground hover:border-foreground/20 disabled:opacity-50">
                Analyse window
              </button>
              <button onClick={() => startSync(true)} disabled={running}
                className="inline-flex items-center gap-2 rounded-lg px-4 py-2.5 text-sm font-semibold disabled:opacity-60" style={{ background: GOLD, color: "hsl(222 38% 15%)" }}>
                {running ? <Loader2 size={15} className="animate-spin" /> : <RefreshCw size={15} />}
                {running ? "Working…" : "Refresh"}
              </button>
            </div>
          </div>
          {running && (
            <div className="mt-3 rounded-lg border border-border bg-card p-3">
              <div className="mb-1.5 flex items-center justify-between text-xs text-muted-foreground">
                <span>{syncQ.data?.phase === "classifying" ? "Classifying contacts…" : "Scanning inbox…"}</span>
                <span>{syncQ.data?.processed ?? 0}{syncQ.data?.total ? ` / ${syncQ.data.total}` : ""}</span>
              </div>
              <div className="h-1.5 overflow-hidden rounded-full" style={{ background: "hsl(220 18% 92%)" }}>
                <div className="h-full rounded-full transition-all" style={{ width: `${syncQ.data?.total ? Math.min(100, ((syncQ.data.processed ?? 0) / syncQ.data.total) * 100) : 15}%`, background: GOLD }} />
              </div>
            </div>
          )}
          {syncQ.data?.status === "error" && <div className="mt-3 flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/5 p-2.5 text-xs text-destructive"><AlertTriangle size={13} /> {syncQ.data.message}</div>}
        </div>

        {/* stat tiles */}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Tile label="Contacts" value={stats?.contacts?.toLocaleString() ?? "—"} />
          <Tile label="Emails analysed" value={stats?.emails?.toLocaleString() ?? "—"} sub={stats ? `↑ ${stats.sent.toLocaleString()} · ↓ ${stats.received.toLocaleString()}` : undefined} />
          <Tile label="Reply rate" value={stats ? `${stats.replyRate}%` : "—"} accent="#0F6E56" />
          <Tile label="Going cold" value={stats?.cold?.toLocaleString() ?? "—"} sub="90+ days quiet" />
        </div>

        {/* role distribution */}
        {stats && stats.contacts > 0 && (
          <div className="mt-3 rounded-xl border border-border bg-card p-4">
            <div className="mb-2 flex justify-between text-[10px] font-semibold uppercase tracking-[0.1em] text-muted-foreground"><span>Contacts by role</span><span>AI-assigned · editable</span></div>
            <div className="flex h-3 overflow-hidden rounded-full">
              {(["founder", "investor", "partner", "other"] as Role[]).map((r) => {
                const w = (roleCount(r) / distTotal) * 100;
                return w > 0 ? <div key={r} title={`${ROLE_META[r].label} ${roleCount(r)}`} style={{ width: `${w}%`, background: ROLE_META[r].fg }} /> : null;
              })}
            </div>
            <div className="mt-2 flex flex-wrap gap-4 text-[11px] text-foreground">
              {(["founder", "investor", "partner", "other"] as Role[]).map((r) => (
                <span key={r}><span className="mr-1.5 inline-block h-2 w-2 rounded-sm" style={{ background: ROLE_META[r].fg }} />{ROLE_META[r].label} {roleCount(r)}</span>
              ))}
            </div>
          </div>
        )}

        {/* filters */}
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <div className="relative min-w-[180px] flex-1">
            <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <input className="ts-input pl-8" placeholder="Search name, email, company…" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <Chips value={role} onChange={setRole} options={[["all", "All"], ["founder", "Founders"], ["investor", "Investors"], ["partner", "Partners"], ["other", "Other"]]} />
          <Chips value={status} onChange={setStatus} options={[["all", "Any status"], ["awaiting", "Awaiting reply"], ["replied", "Replied"], ["cold", "Going cold"]]} />
          <div className="relative">
            <select value={sort} onChange={(e) => setSort(e.target.value)} className="ts-input appearance-none pr-8" style={{ width: "auto" }}>
              <option value="recent">Most recent</option><option value="emails">Most emails</option><option value="name">Name A–Z</option>
            </select>
            <ChevronDown size={14} className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
          </div>
          <button className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-2 text-xs font-medium text-foreground hover:border-foreground/20"><Download size={13} /> Export</button>
        </div>

        {/* table */}
        <div className="mt-3 overflow-hidden rounded-xl border border-border bg-card">
          <div className="grid grid-cols-[1fr_150px_110px_90px_120px] gap-2 border-b border-border px-4 py-2.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            <span>Contact</span><span>Role</span><span>Emails</span><span>Last contact</span><span>Status</span>
          </div>
          {listQ.isLoading ? (
            <div className="flex items-center justify-center gap-2 p-10 text-sm text-muted-foreground"><Loader2 size={15} className="animate-spin" /> Loading…</div>
          ) : (listQ.data?.contacts.length ?? 0) === 0 ? (
            <EmptyState analysed={!!stats?.contacts} onRun={() => startSync(false)} />
          ) : (
            listQ.data!.contacts.map((c) => (
              <ContactRow key={c.id} c={c} onRole={(role, roleLabel) => patchContact(c.id, { role, roleLabel })} onPromote={() => promote(c.id)} />
            ))
          )}
          {total > 0 && (
            <div className="flex items-center justify-between border-t border-border px-4 py-2.5 text-[11px] text-muted-foreground">
              <span>Showing {(page - 1) * pageSize + 1}–{Math.min(page * pageSize, total)} of {total.toLocaleString()}</span>
              <span className="flex gap-1.5">
                <button disabled={page <= 1} onClick={() => setPage((p) => p - 1)} className="rounded-md border border-border bg-card px-2.5 py-1 disabled:opacity-40">Prev</button>
                <button disabled={page >= pages} onClick={() => setPage((p) => p + 1)} className="rounded-md border border-border bg-card px-2.5 py-1 disabled:opacity-40">Next</button>
              </span>
            </div>
          )}
        </div>
      </div>
      <FieldStyles />
    </Layout>
  );
}

function Tile({ label, value, sub, accent }: { label: string; value: string; sub?: string; accent?: string }) {
  return (
    <div className="rounded-xl border border-border bg-card p-3.5">
      <div className="text-[11px] text-muted-foreground">{label}</div>
      <div className="mt-0.5 text-2xl font-semibold" style={{ color: accent ?? NAVY }}>{value}</div>
      {sub && <div className="mt-0.5 text-[10px] text-muted-foreground">{sub}</div>}
    </div>
  );
}

function Chips({ value, onChange, options }: { value: string; onChange: (v: string) => void; options: [string, string][] }) {
  return (
    <div className="inline-flex gap-0.5 rounded-lg p-0.5" style={{ background: "hsl(220 18% 94%)" }}>
      {options.map(([v, label]) => {
        const on = value === v;
        return <button key={v} onClick={() => onChange(v)} className="rounded-md px-2.5 py-1.5 text-xs font-medium"
          style={{ background: on ? "hsl(var(--card))" : "transparent", color: on ? "hsl(var(--primary))" : "hsl(var(--muted-foreground))" }}>{label}</button>;
      })}
    </div>
  );
}

function ContactRow({ c, onRole, onPromote }: { c: Contact; onRole: (role: Role, roleLabel?: string) => void; onPromote: () => void }) {
  const [label, setLabel] = useState(c.roleLabel ?? "");
  const meta = ROLE_META[c.role];
  const initials = (c.name ?? c.email).split(/[\s@.]+/).slice(0, 2).map((s) => s[0]?.toUpperCase()).join("");
  const statusMeta = c.replyStatus === "replied" ? { t: "Replied", c: "#0F6E56" } : c.replyStatus === "awaiting" ? { t: "Awaiting", c: "#8A5A00" } : { t: "—", c: "#8A8676" };
  return (
    <div className="grid grid-cols-[1fr_150px_110px_90px_120px] items-center gap-2 border-b border-border px-4 py-2.5 text-sm last:border-0 hover:bg-muted/30">
      <div className="flex min-w-0 items-center gap-2.5">
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold" style={{ background: meta.bg, color: meta.fg }}>{initials}</span>
        <div className="min-w-0">
          <div className="truncate font-medium text-foreground">{c.name || c.email.split("@")[0]}</div>
          <div className="truncate text-[11px] text-muted-foreground">{c.email}{c.company ? ` · ${c.company}` : ""}</div>
        </div>
      </div>
      <div className="flex items-center gap-1">
        <div className="relative">
          <select value={c.role} onChange={(e) => onRole(e.target.value as Role, label)}
            className="appearance-none rounded-md py-1 pl-2 pr-6 text-[11px] font-semibold" style={{ background: meta.bg, color: meta.fg, border: "none" }}>
            {(["founder", "investor", "partner", "other"] as Role[]).map((r) => <option key={r} value={r}>{ROLE_META[r].label}</option>)}
          </select>
          <ChevronDown size={11} className="pointer-events-none absolute right-1.5 top-1/2 -translate-y-1/2" style={{ color: meta.fg }} />
        </div>
        {c.roleSource === "ai"
          ? <span title={c.confidence ? `AI confidence ${Math.round(c.confidence * 100)}%` : "AI"} className="inline-flex items-center gap-0.5 text-[9px] text-muted-foreground"><span className="h-1.5 w-1.5 rounded-full" style={{ background: (c.confidence ?? 0) >= 0.75 ? "#1D9E75" : (c.confidence ?? 0) >= 0.5 ? "#EF9F27" : "#E24B4A" }} />AI</span>
          : <span className="inline-flex items-center gap-0.5 text-[9px]" style={{ color: "#0F6E56" }}><Check size={10} />You</span>}
      </div>
      <div className="text-foreground">{c.emailsTotal}<span className="text-[10px] text-muted-foreground"> ↑{c.sentCount} ↓{c.receivedCount}</span></div>
      <div className="text-[12px] text-muted-foreground">{timeAgo(c.lastContactAt)}</div>
      <div className="flex items-center justify-between gap-1">
        <span className="text-[11px] font-medium" style={{ color: statusMeta.c }}>{statusMeta.t}</span>
        {c.promotedLeadId
          ? <span className="inline-flex items-center gap-0.5 text-[10px] text-muted-foreground"><Check size={11} /> In pipeline</span>
          : <button onClick={onPromote} title="Promote to pipeline" className="inline-flex items-center gap-0.5 rounded-md border border-border px-1.5 py-1 text-[10px] text-foreground hover:border-foreground/30"><ArrowUpRight size={11} /></button>}
      </div>
      {c.role === "other" && (
        <div className="col-span-full -mt-1 pl-9">
          <input value={label} onChange={(e) => setLabel(e.target.value)} onBlur={() => label !== (c.roleLabel ?? "") && onRole("other", label)}
            placeholder="Add a custom label (e.g. Vendor, Press, Mentor)…" className="ts-input" style={{ maxWidth: 320, fontSize: 11, padding: "4px 8px" }} />
        </div>
      )}
    </div>
  );
}

function EmptyState({ analysed, onRun }: { analysed: boolean; onRun: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 p-12 text-center">
      <Mail size={22} style={{ color: GOLD }} />
      <p className="text-sm font-medium text-foreground">{analysed ? "No contacts match these filters" : "Analyse your inbox to build your CRM"}</p>
      <p className="max-w-sm text-xs text-muted-foreground">{analysed ? "Try clearing filters." : "We’ll read the sender/recipient of every email in your window, dedupe them into contacts, and let the AI suggest a role for each."}</p>
      {!analysed && <button onClick={onRun} className="mt-2 inline-flex items-center gap-2 rounded-lg px-4 py-2.5 text-sm font-semibold" style={{ background: GOLD, color: "hsl(222 38% 15%)" }}><RefreshCw size={15} /> Analyse inbox</button>}
    </div>
  );
}

function FieldStyles() {
  return <style>{`.ts-input{box-sizing:border-box;width:100%;height:36px;border:1px solid hsl(var(--border));border-radius:8px;background:#fff;padding:0 10px;font-size:13px;color:hsl(var(--foreground));outline:none}.ts-input:focus{border-color:var(--gold);box-shadow:0 0 0 3px hsl(36 65% 56% / .15)}`}</style>;
}
