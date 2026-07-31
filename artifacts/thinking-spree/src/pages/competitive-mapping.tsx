// @ts-nocheck
/* ────────────────────────────────────────────────────────────────────────
   Thinking Spree — Competitive Mapping (v2)
   Flow: Data Feed → Fencing → Prioritize → Breakdown → Inspiration.
   2 AI stages (Fencing, Breakdown+Inspiration) run as async jobs; the UI polls
   progress and the "Research for [Company]" Google Sheet fills in live.
   All seeded demo data removed — every run is real, per company.
   ──────────────────────────────────────────────────────────────────────── */
import React, { useState, useEffect, useRef } from "react";
import {
  FileText, Search, ListOrdered, Layers, Route, Loader2, ExternalLink,
  Check, ChevronRight, Plus, Building2, Sparkles, X, ArrowRight, RefreshCw,
} from "lucide-react";
import { Layout } from "@/components/Layout";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");
const jf = (path: string, opts: any = {}) =>
  fetch(BASE + path, { credentials: "include", headers: { "content-type": "application/json" }, ...opts })
    .then((r) => { if (!r.ok) throw new Error(path + " " + r.status); return r.json(); });

const api = {
  createMap: (b: any) => jf("/api/competitive-maps", { method: "POST", body: JSON.stringify(b) }),
  listMaps: () => jf("/api/competitive-maps"),
  loadMap: (id: any) => jf(`/api/competitive-maps/${id}`),
  ingestDeck: (file: File) => {
    const fd = new FormData(); fd.append("file", file);
    return fetch(BASE + "/api/competitive-maps/ingest-deck", { method: "POST", credentials: "include", body: fd })
      .then((r) => { if (!r.ok) throw new Error("ingest-deck " + r.status); return r.json(); });
  },
  fence: (id: any) => jf(`/api/competitive-maps/${id}/fence`, { method: "POST", body: "{}" }),
  prioritize: (id: any, selected: any[]) => jf(`/api/competitive-maps/${id}/prioritize`, { method: "POST", body: JSON.stringify({ selected }) }),
  breakdown: (id: any, selected: any[]) => jf(`/api/competitive-maps/${id}/breakdown`, { method: "POST", body: JSON.stringify({ selected }) }),
  job: (jobId: any) => jf(`/api/competitive-maps/jobs/${jobId}`),
  inspSuggest: (id: any) => jf(`/api/competitive-maps/${id}/inspiration/suggest`, { method: "POST", body: "{}" }),
  inspAdd: (id: any, companyName: string) => jf(`/api/competitive-maps/${id}/inspiration`, { method: "POST", body: JSON.stringify({ companyName }) }),
};

const C = {
  bg: "#FCFBF7", ink: "#1B2233", navy: "#1D2E5C", gold: "#DFA23B", goldSoft: "#F6E6C6",
  success: "#2D8659", border: "#DCDFE6", muted: "#5E6472", card: "#FFFFFF", faint: "#F1F0EA", link: "#1D4E9B",
};
const serif = "'Instrument Serif', Georgia, serif";
const sans = "'Inter', ui-sans-serif, system-ui, sans-serif";

const STAGES = [
  { key: "feed", label: "Data Feed", icon: FileText, human: true },
  { key: "fencing", label: "Fencing", icon: Search, human: false },
  { key: "prioritize", label: "Prioritize", icon: ListOrdered, human: true },
  { key: "breakdown", label: "Breakdown", icon: Layers, human: false },
  { key: "inspiration", label: "Inspiration", icon: Route, human: true },
];

/* Poll a job until done/error. onTick(job) for progress. */
function pollJob(jobId: number, onTick: (j: any) => void): Promise<any> {
  return new Promise((resolve, reject) => {
    const tick = async () => {
      try {
        const j = await api.job(jobId);
        onTick(j);
        if (j.status === "done") return resolve(j);
        if (j.status === "error") return reject(new Error(j.error || "job failed"));
        setTimeout(tick, 1500);
      } catch (e) { setTimeout(tick, 2500); }
    };
    tick();
  });
}

export default function CompetitiveMappingPage() {
  const [stage, setStage] = useState("feed");
  const [mapId, setMapId] = useState<number | null>(null);
  const [overview, setOverview] = useState<any>(null);
  const [sheetUrl, setSheetUrl] = useState<string | null>(null);
  const [needsGoogle, setNeedsGoogle] = useState(false);
  const [landscape, setLandscape] = useState<any>(null);
  const [selected, setSelected] = useState<any[]>([]);
  const [breakdown, setBreakdown] = useState<Record<string, any[]>>({});
  const [inspiration, setInspiration] = useState<Record<string, any>>({});
  const [saved, setSaved] = useState<any[]>([]);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<{ pct: number; msg: string } | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => { api.listMaps().then((r) => setSaved(r?.maps || [])).catch(() => {}); }, []);

  const openRun = async (id: number) => {
    try {
      const m = await api.loadMap(id);
      setMapId(m.id); setOverview(m.overview); setSheetUrl(m.sheetUrl);
      setLandscape(m.landscape); setSelected(m.selected || []);
      setBreakdown(m.breakdown || {}); setInspiration(m.inspiration || {});
      const order = ["feed_ready", "fencing", "fenced", "prioritized", "breaking_down", "broken_down", "inspiration", "done"];
      const map: any = { feed_ready: "fencing", fenced: "prioritize", prioritized: "breakdown", broken_down: "inspiration", inspiration: "inspiration", done: "inspiration" };
      setStage(map[m.status] || "fencing");
    } catch (e: any) { setErr(String(e.message || e)); }
  };

  return (
    <Layout>
      <div style={{ fontFamily: sans, color: C.ink, background: C.bg, minHeight: "100%" }}>
        <div style={{ maxWidth: 1240, margin: "0 auto", padding: "28px 28px 80px" }}>
          {/* Header */}
          <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 16, flexWrap: "wrap" }}>
            <div>
              <div style={{ fontSize: 11, letterSpacing: 2, textTransform: "uppercase", color: C.muted }}>Thinking Spree · Research</div>
              <h1 style={{ fontFamily: serif, fontSize: 40, margin: "6px 0 0", color: C.navy }}>
                Competitive Mapping{overview?.name ? <> · <span style={{ fontStyle: "italic" }}>{overview.name}</span></> : ""}
              </h1>
            </div>
            {sheetUrl && (
              <a href={sheetUrl} target="_blank" rel="noreferrer"
                 style={{ display: "inline-flex", alignItems: "center", gap: 8, background: C.success, color: "#fff", padding: "10px 16px", borderRadius: 10, textDecoration: "none", fontWeight: 600, fontSize: 14 }}>
                <ExternalLink size={16} /> Open Research Sheet
              </a>
            )}
          </div>

          {/* Stage ribbon */}
          <div style={{ display: "flex", gap: 8, margin: "22px 0 26px", flexWrap: "wrap" }}>
            {STAGES.map((s, i) => {
              const active = s.key === stage;
              const done = STAGES.findIndex((x) => x.key === stage) > i;
              return (
                <div key={s.key} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <div style={{
                    display: "flex", alignItems: "center", gap: 8, padding: "8px 14px", borderRadius: 999,
                    background: active ? C.navy : done ? C.goldSoft : C.card,
                    color: active ? "#fff" : C.ink, border: `1px solid ${active ? C.navy : C.border}`, fontSize: 13, fontWeight: 600,
                  }}>
                    <s.icon size={15} /> {s.label}
                    <span style={{ fontSize: 10, opacity: 0.7, marginLeft: 2 }}>{s.human ? "· you" : "· AI"}</span>
                  </div>
                  {i < STAGES.length - 1 && <ChevronRight size={14} color={C.muted} />}
                </div>
              );
            })}
          </div>

          {err && (
            <div style={{ background: "#FDECEC", border: "1px solid #F5C2C2", color: "#9B2C2C", padding: "10px 14px", borderRadius: 10, marginBottom: 16, fontSize: 13 }}>
              {err} <X size={14} style={{ cursor: "pointer", float: "right" }} onClick={() => setErr(null)} />
            </div>
          )}
          {needsGoogle && (
            <div style={{ background: C.goldSoft, border: `1px solid ${C.gold}`, color: "#7a5a12", padding: "10px 14px", borderRadius: 10, marginBottom: 16, fontSize: 13 }}>
              Connect Google in Settings to auto-create the "Research for [Company]" sheet. Research still runs; the sheet won't be written until Google is connected.
            </div>
          )}

          {progress && (
            <div style={{ marginBottom: 20 }}>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: C.muted, marginBottom: 6 }}>
                <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}><Loader2 size={13} className="spin" /> {progress.msg}</span>
                <span>{progress.pct}%</span>
              </div>
              <div style={{ height: 8, background: C.faint, borderRadius: 999, overflow: "hidden" }}>
                <div style={{ width: `${progress.pct}%`, height: "100%", background: C.gold, transition: "width .4s" }} />
              </div>
            </div>
          )}

          {stage === "feed" && (
            <DataFeed saved={saved} busy={busy} onOpen={openRun}
              onSubmit={async (form) => {
                setErr(null); setBusy(true);
                try {
                  const r = await api.createMap(form);
                  setMapId(r.id); setOverview(r.overview); setSheetUrl(r.sheetUrl); setNeedsGoogle(!!r.needsGoogle);
                  setStage("fencing");
                } catch (e: any) { setErr(e.message || "Data Feed failed"); }
                finally { setBusy(false); }
              }} />
          )}

          {stage === "fencing" && (
            <Fencing overview={overview} landscape={landscape} busy={busy}
              onRun={async () => {
                setErr(null); setBusy(true); setProgress({ pct: 5, msg: "Starting fencing…" });
                try {
                  const { jobId } = await api.fence(mapId);
                  await pollJob(jobId, (j) => setProgress({ pct: j.progress || 0, msg: j.message || "Working…" }));
                  const m = await api.loadMap(mapId); setLandscape(m.landscape);
                } catch (e: any) { setErr(e.message || "Fencing failed"); }
                finally { setBusy(false); setProgress(null); }
              }}
              onNext={() => setStage("prioritize")} />
          )}

          {stage === "prioritize" && (
            <Prioritize landscape={landscape} selected={selected} setSelected={setSelected} busy={busy}
              onConfirm={async () => {
                setErr(null); setBusy(true);
                try { await api.prioritize(mapId, selected); setStage("breakdown"); }
                catch (e: any) { setErr(e.message || "Prioritize failed"); }
                finally { setBusy(false); }
              }}
              onBack={() => setStage("fencing")} />
          )}

          {stage === "breakdown" && (
            <Breakdown selected={selected} breakdown={breakdown} busy={busy}
              onRun={async () => {
                setErr(null); setBusy(true); setProgress({ pct: 0, msg: "Starting breakdown…" });
                try {
                  const { jobId, total } = await api.breakdown(mapId, selected);
                  await pollJob(jobId, (j) => setProgress({ pct: total ? Math.round((j.progress / total) * 100) : j.progress, msg: j.message || "Working…" }));
                  const m = await api.loadMap(mapId); setBreakdown(m.breakdown || {});
                } catch (e: any) { setErr(e.message || "Breakdown failed"); }
                finally { setBusy(false); setProgress(null); }
              }}
              onNext={() => setStage("inspiration")} onBack={() => setStage("prioritize")} />
          )}

          {stage === "inspiration" && (
            <Inspiration mapId={mapId} inspiration={inspiration} setInspiration={setInspiration}
              onBack={() => setStage("breakdown")} setErr={setErr} sheetUrl={sheetUrl} />
          )}
        </div>
      </div>
      <style>{`.spin{animation:sp 1s linear infinite}@keyframes sp{to{transform:rotate(360deg)}}`}</style>
    </Layout>
  );
}

/* ── Stage 1: Data Feed ─────────────────────────────────────────────────── */
function DataFeed({ onSubmit, busy, saved, onOpen }: any) {
  const [form, setForm] = useState({ companyName: "", website: "", tsheetUrl: "", deck: "", deckText: "" });
  const [uploading, setUploading] = useState(false);
  const ok = form.companyName.trim() && form.website.trim() && form.tsheetUrl.trim();
  const field = (k: string, label: string, ph: string, required = true) => (
    <div style={{ marginBottom: 14 }}>
      <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: C.muted, marginBottom: 6 }}>
        {label} {required && <span style={{ color: C.gold }}>*</span>}
      </label>
      <input value={(form as any)[k]} placeholder={ph}
        onChange={(e) => setForm((f) => ({ ...f, [k]: e.target.value }))}
        style={{ width: "100%", padding: "11px 13px", border: `1px solid ${C.border}`, borderRadius: 9, fontSize: 14, fontFamily: sans, boxSizing: "border-box" }} />
    </div>
  );
  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 340px", gap: 24 }}>
      <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 14, padding: 24 }}>
        <h2 style={{ fontFamily: serif, fontSize: 24, margin: "0 0 4px", color: C.navy }}>Feed the research</h2>
        <p style={{ fontSize: 13, color: C.muted, margin: "0 0 20px" }}>
          Name, T-Sheet link and website are required. The AI + Scrapling pull the rest and create your Google Sheet.
        </p>
        {field("companyName", "Company name", "e.g. Quintinno Labs")}
        {field("tsheetUrl", "T-Sheet link (Google Drive)", "https://docs.google.com/spreadsheets/…")}
        {field("website", "Company website", "https://company.com")}
        <div style={{ marginBottom: 18 }}>
          <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: C.muted, marginBottom: 6 }}>Pitch deck (PDF, optional)</label>
          <label style={{ display: "inline-flex", alignItems: "center", gap: 8, padding: "9px 13px", border: `1px dashed ${C.border}`, borderRadius: 9, fontSize: 13, cursor: "pointer", color: C.muted }}>
            {uploading ? <Loader2 size={14} className="spin" /> : <Plus size={14} />}
            {form.deck || "Upload pitch deck"}
            <input type="file" accept=".pdf,.docx" style={{ display: "none" }}
              onChange={async (e) => {
                const file = e.target.files?.[0]; if (!file) return;
                setUploading(true);
                try { const r = await api.ingestDeck(file); setForm((f) => ({ ...f, deck: file.name, deckText: r?.text || "" })); }
                catch {} finally { setUploading(false); }
              }} />
          </label>
        </div>
        <button disabled={!ok || busy} onClick={() => onSubmit(form)}
          style={{ display: "inline-flex", alignItems: "center", gap: 8, background: ok && !busy ? C.navy : C.border, color: "#fff", border: "none", padding: "12px 20px", borderRadius: 10, fontSize: 14, fontWeight: 600, cursor: ok && !busy ? "pointer" : "not-allowed" }}>
          {busy ? <Loader2 size={16} className="spin" /> : <Sparkles size={16} />} Start · scrape & build overview
        </button>
      </div>
      <div>
        <div style={{ fontSize: 12, fontWeight: 700, color: C.muted, textTransform: "uppercase", letterSpacing: 1, marginBottom: 10 }}>Your saved research</div>
        {(!saved || !saved.length) && <div style={{ fontSize: 13, color: C.muted }}>No runs yet.</div>}
        {(saved || []).map((s: any) => (
          <div key={s.id} onClick={() => onOpen(s.id)}
            style={{ display: "flex", alignItems: "center", gap: 10, background: C.card, border: `1px solid ${C.border}`, borderRadius: 10, padding: "10px 12px", marginBottom: 8, cursor: "pointer" }}>
            {s.logo ? <img src={s.logo} style={{ width: 26, height: 26, borderRadius: 6, objectFit: "contain" }} /> : <Building2 size={20} color={C.muted} />}
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 13, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{s.companyName}</div>
              <div style={{ fontSize: 11, color: C.muted }}>{s.status}</div>
            </div>
            <ChevronRight size={15} color={C.muted} style={{ marginLeft: "auto" }} />
          </div>
        ))}
      </div>
    </div>
  );
}

/* ── Stage 2: Fencing (industry landscape) ──────────────────────────────── */
function Fencing({ overview, landscape, onRun, onNext, busy }: any) {
  const has = landscape && (landscape.companies?.length || landscape.metrics?.length);
  return (
    <div>
      {overview && (
        <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: 18, marginBottom: 18, display: "flex", gap: 14, alignItems: "center" }}>
          {overview.logo && <img src={overview.logo} style={{ width: 44, height: 44, borderRadius: 8, objectFit: "contain" }} />}
          <div>
            <div style={{ fontFamily: serif, fontSize: 20, color: C.navy }}>{overview.name}</div>
            <div style={{ fontSize: 13, color: C.muted }}>{overview.tagline}</div>
          </div>
        </div>
      )}
      {!has ? (
        <div style={{ textAlign: "center", padding: "40px 20px", background: C.card, border: `1px dashed ${C.border}`, borderRadius: 14 }}>
          <Search size={28} color={C.gold} />
          <h3 style={{ fontFamily: serif, fontSize: 22, margin: "12px 0 4px", color: C.navy }}>Fence the industry</h3>
          <p style={{ fontSize: 13, color: C.muted, maxWidth: 460, margin: "0 auto 18px" }}>
            The AI maps the whole market — quantified metrics plus every company in the space — so you can become an expert fast. The complete per-company breakdown comes later.
          </p>
          <button disabled={busy} onClick={onRun}
            style={{ background: C.navy, color: "#fff", border: "none", padding: "12px 22px", borderRadius: 10, fontSize: 14, fontWeight: 600, cursor: busy ? "wait" : "pointer", display: "inline-flex", alignItems: "center", gap: 8 }}>
            {busy ? <Loader2 size={16} className="spin" /> : <Sparkles size={16} />} Run Fencing
          </button>
        </div>
      ) : (
        <>
          {landscape.summary && <p style={{ fontSize: 14, color: C.ink, background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: 16, marginBottom: 16 }}>{landscape.summary}</p>}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(200px,1fr))", gap: 12, marginBottom: 22 }}>
            {(landscape.metrics || []).map((m: any, i: number) => (
              <div key={i} style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 10, padding: 14 }}>
                <div style={{ fontSize: 12, color: C.muted }}>{m.label}</div>
                <div style={{ fontFamily: serif, fontSize: 22, color: C.navy }}>{m.value}</div>
                {m.note && <div style={{ fontSize: 11, color: C.muted }}>{m.note}</div>}
              </div>
            ))}
          </div>
          <div style={{ fontSize: 13, fontWeight: 700, color: C.muted, marginBottom: 10 }}>
            {landscape.companies?.length || 0} companies mapped
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(240px,1fr))", gap: 10, marginBottom: 24 }}>
            {(landscape.companies || []).map((c: any, i: number) => (
              <div key={i} style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 10, padding: 12 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                  <div style={{ fontWeight: 600, fontSize: 14 }}>{c.name}</div>
                  <span style={{ fontSize: 10, color: C.muted }}>{c.type}</span>
                </div>
                <div style={{ fontSize: 11, color: C.muted, marginTop: 2 }}>{c.size}{c.hq ? ` · ${c.hq}` : ""}</div>
                {c.note && <div style={{ fontSize: 12, color: C.ink, marginTop: 6 }}>{c.note}</div>}
              </div>
            ))}
          </div>
          <div style={{ display: "flex", gap: 10 }}>
            <button onClick={onRun} disabled={busy} style={ghostBtn}>{busy ? <Loader2 size={15} className="spin" /> : <RefreshCw size={15} />} Re-run</button>
            <button onClick={onNext} style={primaryBtn}>Prioritize <ArrowRight size={15} /></button>
          </div>
        </>
      )}
    </div>
  );
}

/* ── Stage 3: Prioritize ────────────────────────────────────────────────── */
function Prioritize({ landscape, selected, setSelected, onConfirm, onBack, busy }: any) {
  const companies = landscape?.companies || [];
  const isSel = (name: string) => selected.some((s: any) => s.name === name);
  const toggle = (c: any) => setSelected((cur: any[]) =>
    cur.some((s) => s.name === c.name) ? cur.filter((s) => s.name !== c.name)
      : [...cur, { name: c.name, website: c.website, rank: cur.length + 1 }]);
  return (
    <div>
      <h2 style={{ fontFamily: serif, fontSize: 24, color: C.navy, margin: "0 0 4px" }}>Shortlist for breakdown</h2>
      <p style={{ fontSize: 13, color: C.muted, margin: "0 0 18px" }}>Pick the 7–10 companies worth a deep decode. Selected: {selected.length}</p>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(240px,1fr))", gap: 10, marginBottom: 22 }}>
        {companies.map((c: any, i: number) => {
          const on = isSel(c.name);
          return (
            <div key={i} onClick={() => toggle(c)}
              style={{ cursor: "pointer", background: on ? C.goldSoft : C.card, border: `1.5px solid ${on ? C.gold : C.border}`, borderRadius: 10, padding: 12, display: "flex", gap: 10, alignItems: "center" }}>
              <div style={{ width: 20, height: 20, borderRadius: 5, border: `1.5px solid ${on ? C.gold : C.border}`, background: on ? C.gold : "#fff", display: "flex", alignItems: "center", justifyContent: "center" }}>
                {on && <Check size={13} color="#fff" />}
              </div>
              <div>
                <div style={{ fontWeight: 600, fontSize: 14 }}>{c.name}</div>
                <div style={{ fontSize: 11, color: C.muted }}>{c.type}{c.size ? ` · ${c.size}` : ""}</div>
              </div>
            </div>
          );
        })}
      </div>
      <div style={{ display: "flex", gap: 10 }}>
        <button onClick={onBack} style={ghostBtn}>Back</button>
        <button onClick={onConfirm} disabled={!selected.length || busy} style={{ ...primaryBtn, opacity: selected.length ? 1 : 0.5 }}>
          {busy ? <Loader2 size={15} className="spin" /> : null} Confirm {selected.length} → Breakdown <ArrowRight size={15} />
        </button>
      </div>
    </div>
  );
}

/* ── Stage 4: Breakdown ─────────────────────────────────────────────────── */
function Breakdown({ selected, breakdown, onRun, onNext, onBack, busy }: any) {
  const done = Object.keys(breakdown || {}).length;
  return (
    <div>
      <h2 style={{ fontFamily: serif, fontSize: 24, color: C.navy, margin: "0 0 4px" }}>Deep breakdown</h2>
      <p style={{ fontSize: 13, color: C.muted, margin: "0 0 18px" }}>
        For each of your {selected.length} companies, the AI directs Scrapling to pull the site + product shots, then writes the full 46-column decode to a dedicated sheet tab.
      </p>
      {!done ? (
        <div style={{ textAlign: "center", padding: "36px 20px", background: C.card, border: `1px dashed ${C.border}`, borderRadius: 14 }}>
          <Layers size={28} color={C.gold} />
          <div style={{ margin: "12px 0 18px", fontSize: 13, color: C.muted }}>{selected.map((s: any) => s.name).join(" · ")}</div>
          <button disabled={busy} onClick={onRun} style={{ ...primaryBtn, justifyContent: "center" }}>
            {busy ? <Loader2 size={16} className="spin" /> : <Sparkles size={16} />} Run Breakdown
          </button>
        </div>
      ) : (
        <>
          {Object.entries(breakdown).map(([company, rows]: any) => (
            <div key={company} style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: 16, marginBottom: 14 }}>
              <div style={{ fontFamily: serif, fontSize: 18, color: C.navy, marginBottom: 10 }}>{company} · {rows.length} product{rows.length !== 1 ? "s" : ""}</div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(180px,1fr))", gap: 10 }}>
                {rows.map((r: any, i: number) => (
                  <div key={i} style={{ border: `1px solid ${C.border}`, borderRadius: 8, overflow: "hidden" }}>
                    {r.image ? <img src={r.image} style={{ width: "100%", height: 96, objectFit: "cover", background: C.faint }} onError={(e: any) => { e.target.style.display = "none"; }} /> : <div style={{ height: 96, background: C.faint }} />}
                    <div style={{ padding: 8 }}>
                      <div style={{ fontSize: 13, fontWeight: 600 }}>{r.product}</div>
                      <div style={{ fontSize: 11, color: C.muted, marginTop: 2 }}>{r.seg} · {r.pricing || r.revenue || ""}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
          <div style={{ display: "flex", gap: 10 }}>
            <button onClick={onBack} style={ghostBtn}>Back</button>
            <button onClick={onRun} disabled={busy} style={ghostBtn}>{busy ? <Loader2 size={15} className="spin" /> : <RefreshCw size={15} />} Re-run</button>
            <button onClick={onNext} style={primaryBtn}>Inspiration <ArrowRight size={15} /></button>
          </div>
        </>
      )}
    </div>
  );
}

/* ── Stage 5: Inspiration ───────────────────────────────────────────────── */
function Inspiration({ mapId, inspiration, setInspiration, onBack, setErr, sheetUrl }: any) {
  const [suggestions, setSuggestions] = useState<Record<string, any>>({});
  const [active, setActive] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const keys = Object.keys(inspiration || {});
  useEffect(() => { if (keys.length && !active) setActive(keys[0]); }, [inspiration]);

  const build = async (companyName: string) => {
    setAdding(true); setErr(null);
    try {
      const t = await api.inspAdd(mapId, companyName);
      const id = (t.who || companyName).toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 16);
      setInspiration((c: any) => ({ ...c, [id]: { ...t, generated: true } })); setActive(id); setName("");
    } catch (e: any) { setErr(e.message || "Inspiration failed"); }
    finally { setAdding(false); }
  };
  const suggest = async () => {
    setAdding(true);
    try { const r = await api.inspSuggest(mapId); setSuggestions(r?.items || {}); }
    catch (e: any) { setErr(e.message || "suggest failed"); }
    finally { setAdding(false); }
  };
  const cur = active ? inspiration[active] : null;

  return (
    <div>
      <h2 style={{ fontFamily: serif, fontSize: 24, color: C.navy, margin: "0 0 4px" }}>Inspiration journeys</h2>
      <p style={{ fontSize: 13, color: C.muted, margin: "0 0 16px" }}>
        Pick 1–2 leaders that ran the same journey and out-scaled the company. The AI builds a phased timeline tab (product, positioning, funding, growth, customers).
      </p>

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 16, alignItems: "center" }}>
        <button onClick={suggest} disabled={adding} style={ghostBtn}>{adding ? <Loader2 size={15} className="spin" /> : <Sparkles size={15} />} Suggest leaders</button>
        {Object.values(suggestions).map((s: any, i: number) => (
          <button key={i} onClick={() => build(s.who)} style={{ ...ghostBtn, borderStyle: "dashed" }}><Plus size={14} /> {s.who}</button>
        ))}
        <div style={{ display: "inline-flex", gap: 6 }}>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Add a company…"
            style={{ padding: "8px 11px", border: `1px solid ${C.border}`, borderRadius: 8, fontSize: 13 }} />
          <button onClick={() => name.trim() && build(name.trim())} disabled={adding || !name.trim()} style={primaryBtn}><Plus size={14} /> Build</button>
        </div>
      </div>

      {keys.length > 0 && (
        <div style={{ display: "flex", gap: 8, marginBottom: 12, flexWrap: "wrap" }}>
          {keys.map((k) => (
            <button key={k} onClick={() => setActive(k)}
              style={{ padding: "7px 14px", borderRadius: 999, border: `1px solid ${active === k ? C.navy : C.border}`, background: active === k ? C.navy : C.card, color: active === k ? "#fff" : C.ink, fontSize: 13, fontWeight: 600, cursor: "pointer" }}>
              {inspiration[k].who}
            </button>
          ))}
        </div>
      )}

      {cur && (
        <div style={{ overflowX: "auto", border: `1px solid ${C.border}`, borderRadius: 12, marginBottom: 22 }}>
          <table style={{ borderCollapse: "collapse", width: "100%", fontSize: 13 }}>
            <thead>
              <tr style={{ background: C.navy, color: "#fff" }}>
                {["Timeline & Phase", "Product & Capability", "Marketing & Positioning", "Funding / Investment", "Quantified Growth", "Key Customers / Partners"].map((h) => (
                  <th key={h} style={{ padding: "10px 12px", textAlign: "left", fontWeight: 600, minWidth: 150 }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {(cur.phases || []).map((p: any, i: number) => (
                <tr key={i} style={{ borderTop: `1px solid ${C.border}`, background: i % 2 ? C.faint : "#fff" }}>
                  <td style={cellS}>{p.era}</td><td style={cellS}>{p.product}</td><td style={cellS}>{p.market}</td>
                  <td style={cellS}>{p.funding}</td><td style={cellS}>{p.growth}</td><td style={cellS}>{p.customers}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div style={{ display: "flex", gap: 10 }}>
        <button onClick={onBack} style={ghostBtn}>Back</button>
        {sheetUrl && <a href={sheetUrl} target="_blank" rel="noreferrer" style={{ ...primaryBtn, textDecoration: "none" }}><ExternalLink size={15} /> Open the finished sheet</a>}
      </div>
    </div>
  );
}

const primaryBtn: any = { display: "inline-flex", alignItems: "center", gap: 8, background: C.navy, color: "#fff", border: "none", padding: "10px 18px", borderRadius: 10, fontSize: 14, fontWeight: 600, cursor: "pointer" };
const ghostBtn: any = { display: "inline-flex", alignItems: "center", gap: 8, background: C.card, color: C.ink, border: `1px solid ${C.border}`, padding: "10px 16px", borderRadius: 10, fontSize: 14, fontWeight: 600, cursor: "pointer" };
const cellS: any = { padding: "10px 12px", verticalAlign: "top", lineHeight: 1.5 };
