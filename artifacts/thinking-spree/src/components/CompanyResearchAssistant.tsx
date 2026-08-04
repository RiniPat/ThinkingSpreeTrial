// @ts-nocheck
/* ────────────────────────────────────────────────────────────────────────
   Company Research Assistant — pinned to the Competitive Mapping screen and
   ALWAYS bound to the company currently being analysed (mapId). It is
   specialised for that company: answers are grounded server-side in the run's
   overview + industry landscape, and it seeds tappable "deep-dive" prompts the
   consultant can opt into (the industry, the company's problems, competitors,
   economics, risks). Refreshes its suggestions as the run advances.
   ──────────────────────────────────────────────────────────────────────── */
import React, { useState, useEffect, useRef } from "react";
import { X, Send, Loader2, Bot, Sparkles, RefreshCw, ChevronDown } from "lucide-react";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");
const jf = (path: string, opts: any = {}) =>
  fetch(BASE + path, { credentials: "include", headers: { "content-type": "application/json" }, ...opts })
    .then((r) => { if (!r.ok) throw new Error(path + " " + r.status); return r.json(); });

const C = {
  navy: "#1D2E5C", ink: "#1B2233", gold: "#DFA23B", goldSoft: "#F6E6C6", border: "#DCDFE6",
  muted: "#5E6472", card: "#FFFFFF", faint: "#F5F4EF", bg: "#FCFBF7",
};
const serif = "'Instrument Serif', Georgia, serif";
const sans = "'Inter', ui-sans-serif, system-ui, sans-serif";

export function CompanyResearchAssistant({ mapId, subject, stage }: {
  mapId: number | null; subject?: string; stage?: string;
}): JSX.Element | null {
  const [open, setOpen] = useState(true);
  const [msgs, setMsgs] = useState<any[]>([]);
  const [prompts, setPrompts] = useState<string[]>([]);
  const [loadingPrompts, setLoadingPrompts] = useState(false);
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const scrollRef = useRef<any>(null);

  // Load saved thread + tailored prompts whenever the active run changes.
  useEffect(() => {
    if (mapId == null) { setMsgs([]); setPrompts([]); return; }
    jf(`/api/competitive-maps/${mapId}/copilot`).then((h) => setMsgs(Array.isArray(h) ? h : [])).catch(() => setMsgs([]));
    loadPrompts();
  }, [mapId]);
  // Refresh suggestions when the stage advances (new landscape/breakdown to mine).
  useEffect(() => { if (mapId != null) loadPrompts(); }, [stage]);
  useEffect(() => { if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight; }, [msgs, busy]);

  const loadPrompts = () => {
    if (mapId == null) return;
    setLoadingPrompts(true);
    jf(`/api/competitive-maps/${mapId}/copilot/suggest`)
      .then((r) => setPrompts(Array.isArray(r?.prompts) ? r.prompts : []))
      .catch(() => setPrompts([]))
      .finally(() => setLoadingPrompts(false));
  };

  const ask = async (question: string) => {
    const text = (question || "").trim();
    if (!text || mapId == null || busy) return;
    setQ(""); setMsgs((m) => [...m, { role: "user", text }]); setBusy(true);
    try {
      const r = await jf(`/api/competitive-maps/${mapId}/copilot`, { method: "POST", body: JSON.stringify({ question: text }) });
      setMsgs((m) => [...m, { role: "ai", blocks: r.blocks || [] }]);
    } catch { setMsgs((m) => [...m, { role: "ai", blocks: [{ h: "", b: "Sorry — I couldn't answer that just now." }] }]); }
    finally { setBusy(false); }
  };

  // Collapsed pill — still "present", one tap to reopen.
  if (!open) {
    return (
      <button onClick={() => setOpen(true)} aria-label="Open Research Assistant"
        style={{ position: "fixed", right: 22, bottom: 22, zIndex: 60, display: "inline-flex", alignItems: "center", gap: 9,
          background: C.navy, color: "#fff", border: "none", borderRadius: 999, padding: "13px 18px", fontFamily: sans, fontSize: 14,
          fontWeight: 600, cursor: "pointer", boxShadow: "0 8px 24px rgba(20,27,43,.28)" }}>
        <Bot size={17} /> Research Assistant
      </button>
    );
  }

  return (
    <div style={{ position: "fixed", right: 22, bottom: 22, zIndex: 60, width: 400, maxWidth: "calc(100vw - 32px)", height: 600, maxHeight: "calc(100vh - 90px)",
      background: C.bg, border: `1px solid ${C.border}`, borderRadius: 16, boxShadow: "0 18px 48px rgba(20,27,43,.30)", display: "flex", flexDirection: "column", fontFamily: sans, overflow: "hidden" }}>
      {/* Header */}
      <div style={{ background: C.navy, color: "#fff", padding: "13px 16px", display: "flex", alignItems: "center", gap: 10 }}>
        <Bot size={18} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontFamily: serif, fontSize: 18, lineHeight: 1.1 }}>Research Assistant</div>
          <div style={{ fontSize: 11, opacity: 0.75, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
            {subject ? `Specialised for ${subject}` : "Feed a company to begin"}
          </div>
        </div>
        <ChevronDown size={18} style={{ cursor: "pointer" }} onClick={() => setOpen(false)} />
      </div>

      {/* Messages */}
      <div ref={scrollRef} style={{ flex: 1, overflowY: "auto", padding: 14 }}>
        {mapId == null && (
          <div style={{ color: C.muted, fontSize: 13, textAlign: "center", marginTop: 40, lineHeight: 1.6 }}>
            Start a run in <b>Data Feed</b> and I'll specialise myself for that company — its problems, its industry, its competitors.
          </div>
        )}

        {mapId != null && !msgs.length && (
          <div style={{ color: C.muted, fontSize: 13, textAlign: "center", marginTop: 10, marginBottom: 12, lineHeight: 1.6 }}>
            Ask me anything about {subject || "this company"} and its market — or start with a deep-dive below.
          </div>
        )}

        {msgs.map((m, i) => m.role === "user" ? (
          <div key={i} style={{ display: "flex", justifyContent: "flex-end", marginBottom: 10 }}>
            <div style={{ background: C.navy, color: "#fff", padding: "9px 13px", borderRadius: "12px 12px 2px 12px", fontSize: 13, maxWidth: "85%" }}>{m.text}</div>
          </div>
        ) : (
          <div key={i} style={{ marginBottom: 12 }}>
            <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: "12px 12px 12px 2px", padding: "10px 13px", fontSize: 13, maxWidth: "94%" }}>
              {(m.blocks || []).map((b: any, k: number) => (
                <div key={k} style={{ marginBottom: k < m.blocks.length - 1 ? 8 : 0 }}>
                  {b.h && <div style={{ fontWeight: 700, color: C.navy, marginBottom: 2 }}>{b.h}</div>}
                  <div style={{ color: C.ink, lineHeight: 1.55 }}>{b.b}</div>
                </div>
              ))}
            </div>
          </div>
        ))}
        {busy && <div style={{ display: "inline-flex", alignItems: "center", gap: 7, color: C.muted, fontSize: 12 }}><Loader2 size={13} className="cra-spin" /> thinking…</div>}
      </div>

      {/* Suggested deep-dive prompts */}
      {mapId != null && (
        <div style={{ borderTop: `1px solid ${C.border}`, background: C.faint, padding: "10px 12px 4px" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
            <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: 0.5, textTransform: "uppercase", color: C.muted, display: "inline-flex", alignItems: "center", gap: 5 }}>
              <Sparkles size={12} color={C.gold} /> Deep dives
            </span>
            <button onClick={loadPrompts} disabled={loadingPrompts} title="Refresh suggestions"
              style={{ background: "none", border: "none", cursor: "pointer", color: C.muted, display: "inline-flex" }}>
              {loadingPrompts ? <Loader2 size={13} className="cra-spin" /> : <RefreshCw size={13} />}
            </button>
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, maxHeight: 96, overflowY: "auto", paddingBottom: 6 }}>
            {(prompts.length ? prompts : []).map((p, i) => (
              <button key={i} onClick={() => ask(p)} disabled={busy}
                style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 999, padding: "6px 11px", fontSize: 12, color: C.ink, cursor: busy ? "wait" : "pointer", textAlign: "left", lineHeight: 1.3 }}>
                {p}
              </button>
            ))}
            {!prompts.length && !loadingPrompts && <span style={{ fontSize: 12, color: C.muted }}>No suggestions yet.</span>}
          </div>
        </div>
      )}

      {/* Composer */}
      <div style={{ borderTop: `1px solid ${C.border}`, padding: 10, background: C.card, display: "flex", gap: 8 }}>
        <input value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === "Enter" && ask(q)}
          disabled={mapId == null} placeholder={mapId == null ? "Start a run first…" : "Ask the assistant…"}
          style={{ flex: 1, padding: "10px 12px", border: `1px solid ${C.border}`, borderRadius: 9, fontSize: 13, fontFamily: sans, background: mapId == null ? C.faint : "#fff" }} />
        <button onClick={() => ask(q)} disabled={mapId == null || busy || !q.trim()}
          style={{ background: mapId != null && q.trim() ? C.navy : C.border, color: "#fff", border: "none", borderRadius: 9, width: 42, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}>
          {busy ? <Loader2 size={16} className="cra-spin" /> : <Send size={16} />}
        </button>
      </div>
      <style>{`.cra-spin{animation:crasp 1s linear infinite}@keyframes crasp{to{transform:rotate(360deg)}}`}</style>
    </div>
  );
}
