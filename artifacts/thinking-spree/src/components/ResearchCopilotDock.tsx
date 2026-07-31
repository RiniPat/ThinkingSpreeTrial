// @ts-nocheck
/* ────────────────────────────────────────────────────────────────────────
   Research Copilot — a chat-first dock pinned to the dashboard.
   Consultants pick one of their saved Competitive-Mapping runs and ask
   questions; answers are grounded in that run and saved to the thread.
   Self-contained (inline styles); exported with a clean signature so the
   strictly-typed dashboard imports it cleanly.
   ──────────────────────────────────────────────────────────────────────── */
import React, { useState, useEffect, useRef } from "react";
import { MessageSquareText, X, Send, Loader2, ChevronDown, Bot } from "lucide-react";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");
const jf = (path: string, opts: any = {}) =>
  fetch(BASE + path, { credentials: "include", headers: { "content-type": "application/json" }, ...opts })
    .then((r) => { if (!r.ok) throw new Error(path + " " + r.status); return r.json(); });

const C = {
  navy: "#1D2E5C", ink: "#1B2233", gold: "#DFA23B", border: "#DCDFE6",
  muted: "#5E6472", card: "#FFFFFF", faint: "#F5F4EF", bg: "#FCFBF7",
};
const serif = "'Instrument Serif', Georgia, serif";
const sans = "'Inter', ui-sans-serif, system-ui, sans-serif";

export function ResearchCopilotDock(): JSX.Element {
  const [open, setOpen] = useState(false);
  const [runs, setRuns] = useState<any[]>([]);
  const [runId, setRunId] = useState<number | null>(null);
  const [msgs, setMsgs] = useState<any[]>([]);
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const scrollRef = useRef<any>(null);

  useEffect(() => { if (open && !runs.length) jf("/api/competitive-maps").then((r) => setRuns(r?.maps || [])).catch(() => {}); }, [open]);
  useEffect(() => {
    if (runId == null) return;
    jf(`/api/competitive-maps/${runId}/copilot`).then((h) => setMsgs(Array.isArray(h) ? h : [])).catch(() => setMsgs([]));
  }, [runId]);
  useEffect(() => { if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight; }, [msgs, busy]);

  const send = async () => {
    const question = q.trim();
    if (!question || runId == null || busy) return;
    setQ(""); setMsgs((m) => [...m, { role: "user", text: question }]); setBusy(true);
    try {
      const r = await jf(`/api/competitive-maps/${runId}/copilot`, { method: "POST", body: JSON.stringify({ question }) });
      setMsgs((m) => [...m, { role: "ai", blocks: r.blocks || [] }]);
    } catch { setMsgs((m) => [...m, { role: "ai", blocks: [{ h: "", b: "Sorry — I couldn't answer that just now." }] }]); }
    finally { setBusy(false); }
  };

  const activeRun = runs.find((r) => r.id === runId);

  if (!open) {
    return (
      <button onClick={() => setOpen(true)} aria-label="Open Research Copilot"
        style={{ position: "fixed", right: 22, bottom: 22, zIndex: 60, display: "inline-flex", alignItems: "center", gap: 9,
          background: C.navy, color: "#fff", border: "none", borderRadius: 999, padding: "13px 18px", fontFamily: sans, fontSize: 14,
          fontWeight: 600, cursor: "pointer", boxShadow: "0 8px 24px rgba(20,27,43,.28)" }}>
        <MessageSquareText size={17} /> Research Copilot
      </button>
    );
  }

  return (
    <div style={{ position: "fixed", right: 22, bottom: 22, zIndex: 60, width: 380, maxWidth: "calc(100vw - 32px)", height: 560, maxHeight: "calc(100vh - 100px)",
      background: C.bg, border: `1px solid ${C.border}`, borderRadius: 16, boxShadow: "0 18px 48px rgba(20,27,43,.30)", display: "flex", flexDirection: "column", fontFamily: sans, overflow: "hidden" }}>
      {/* Header */}
      <div style={{ background: C.navy, color: "#fff", padding: "13px 16px", display: "flex", alignItems: "center", gap: 10 }}>
        <Bot size={18} />
        <div style={{ fontFamily: serif, fontSize: 18, flex: 1 }}>Research Copilot</div>
        <X size={18} style={{ cursor: "pointer" }} onClick={() => setOpen(false)} />
      </div>

      {/* Run picker */}
      <div style={{ padding: "10px 14px", borderBottom: `1px solid ${C.border}`, background: C.card }}>
        <div style={{ position: "relative" }}>
          <select value={runId ?? ""} onChange={(e) => setRunId(e.target.value ? Number(e.target.value) : null)}
            style={{ width: "100%", appearance: "none", padding: "9px 30px 9px 11px", border: `1px solid ${C.border}`, borderRadius: 9, fontSize: 13, background: "#fff", fontFamily: sans, color: C.ink, cursor: "pointer" }}>
            <option value="">Choose a research run…</option>
            {runs.map((r) => <option key={r.id} value={r.id}>{r.companyName} · {r.status}</option>)}
          </select>
          <ChevronDown size={15} color={C.muted} style={{ position: "absolute", right: 10, top: 11, pointerEvents: "none" }} />
        </div>
      </div>

      {/* Messages */}
      <div ref={scrollRef} style={{ flex: 1, overflowY: "auto", padding: 14 }}>
        {runId == null && (
          <div style={{ color: C.muted, fontSize: 13, textAlign: "center", marginTop: 40, lineHeight: 1.6 }}>
            Pick a saved research run above, then ask anything — market shape, a company's pricing, funding, positioning.
          </div>
        )}
        {runId != null && !msgs.length && (
          <div style={{ color: C.muted, fontSize: 13, textAlign: "center", marginTop: 30 }}>
            Ask about {activeRun?.companyName || "this run"} and its market.
          </div>
        )}
        {msgs.map((m, i) => m.role === "user" ? (
          <div key={i} style={{ display: "flex", justifyContent: "flex-end", marginBottom: 10 }}>
            <div style={{ background: C.navy, color: "#fff", padding: "9px 13px", borderRadius: "12px 12px 2px 12px", fontSize: 13, maxWidth: "85%" }}>{m.text}</div>
          </div>
        ) : (
          <div key={i} style={{ marginBottom: 12 }}>
            <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: "12px 12px 12px 2px", padding: "10px 13px", fontSize: 13, maxWidth: "92%" }}>
              {(m.blocks || []).map((b: any, k: number) => (
                <div key={k} style={{ marginBottom: k < m.blocks.length - 1 ? 8 : 0 }}>
                  {b.h && <div style={{ fontWeight: 700, color: C.navy, marginBottom: 2 }}>{b.h}</div>}
                  <div style={{ color: C.ink, lineHeight: 1.55 }}>{b.b}</div>
                </div>
              ))}
            </div>
          </div>
        ))}
        {busy && <div style={{ display: "inline-flex", alignItems: "center", gap: 7, color: C.muted, fontSize: 12 }}><Loader2 size={13} className="cop-spin" /> thinking…</div>}
      </div>

      {/* Composer */}
      <div style={{ borderTop: `1px solid ${C.border}`, padding: 10, background: C.card, display: "flex", gap: 8 }}>
        <input value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === "Enter" && send()}
          disabled={runId == null} placeholder={runId == null ? "Select a run first…" : "Ask the copilot…"}
          style={{ flex: 1, padding: "10px 12px", border: `1px solid ${C.border}`, borderRadius: 9, fontSize: 13, fontFamily: sans, background: runId == null ? C.faint : "#fff" }} />
        <button onClick={send} disabled={runId == null || busy || !q.trim()}
          style={{ background: runId != null && q.trim() ? C.navy : C.border, color: "#fff", border: "none", borderRadius: 9, width: 42, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}>
          {busy ? <Loader2 size={16} className="cop-spin" /> : <Send size={16} />}
        </button>
      </div>
      <style>{`.cop-spin{animation:copsp 1s linear infinite}@keyframes copsp{to{transform:rotate(360deg)}}`}</style>
    </div>
  );
}
