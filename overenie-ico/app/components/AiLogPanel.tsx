"use client";

import { useEffect, useState } from "react";

interface Row {
  id: string;
  at: string;
  kind: "ai" | "flow";
  source: string;
  ico: string;
  company?: string;
  provider?: string;
  model?: string;
  result?: string;
  status?: string;
  rejected?: string;
  error?: string;
  ms: number;
  steps?: number;
  decidedBy?: string;
  pagesCount: number;
}

const NAMES: Record<string, string> = {
  vszp: "VšZP",
  union: "Union",
  ov: "Obchodný vestník",
  diskv: "Diskvalifikácie",
  uvo: "ÚVO",
  rpo: "RPO",
  ruz: "RÚZ",
  "fs-debtors": "FS dlžníci",
  "fs-vat": "FS DPH",
  "fs-ids": "FS index",
  "fs-dppo": "FS DPPO",
  socpoist: "Sociálna poisťovňa",
  insolvency: "REPLIK",
  rpvs: "RPVS",
};

/**
 * Administrácia → Záznam AI overení: posledné behy AI agenta a skriptovaných dopytov cez prehliadač so všetkým, čo videli a urobili.
 * „Súhrn na zdieľanie“ zloží za každý register úspešný postup a posledný neúspech so snímkami stránok – podklad na prevod na automatický dopyt.
 */
export default function AiLogPanel() {
  const [rows, setRows] = useState<Row[]>([]);
  const [total, setTotal] = useState(0);
  const [source, setSource] = useState("");
  const [out, setOut] = useState("");
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  async function load(src = source) {
    const r = await fetch(`/api/admin/ailog?limit=60${src ? `&source=${src}` : ""}`);
    const j = await r.json().catch(() => ({ runs: [], total: 0 }));
    setRows(j.runs || []);
    setTotal(j.total || 0);
  }
  useEffect(() => {
    load("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function show(url: string, t: string) {
    setBusy(true);
    setCopied(false);
    try {
      const j = await (await fetch(url)).json();
      setOut(JSON.stringify(j, null, 2));
      setTitle(t);
    } finally {
      setBusy(false);
    }
  }

  const sources = [...new Set(rows.map((r) => r.source))];
  const fmt = (r: Row) =>
    r.error ? "chyba" : r.rejected ? "zamietnuté" : r.result === "clean" ? "bez záznamu" : r.result === "found" ? "záznam" : "neviem";

  return (
    <section className="card">
      <h2>Záznam AI overení</h2>
      <p className="hint" style={{ marginTop: 0 }}>
        Každé „Overiť cez AI“ a každý automatický dopyt cez prehliadač (Union, Obchodný vestník) sa zaznamená: čo agent otvoril, ktoré polia vyplnil,
        na čo klikol, aké stránky videl a s akým výsledkom. „Súhrn na zdieľanie“ zloží za každý register posledný úspešný postup a posledný neúspech
        so snímkami stránok – skopírujte ho a pošlite vývoju; podľa neho sa AI overenie prevedie na rýchly automatický dopyt bez AI.
        Uchováva sa posledných 200 behov (len údaje z verejných registrov).
      </p>
      <div className="toolbar" style={{ marginTop: 4 }}>
        <select value={source} onChange={(e) => { setSource(e.target.value); load(e.target.value); }} style={{ font: "inherit", padding: "8px 10px", border: "1px solid var(--line)", borderRadius: 8, background: "var(--surface)", color: "var(--ink)" }}>
          <option value="">Všetky registre ({total})</option>
          {sources.map((s) => <option key={s} value={s}>{NAMES[s] || s}</option>)}
        </select>
        <button className="btn" disabled={busy} onClick={() => show(`/api/admin/ailog?summary=1${source ? `&source=${source}` : ""}`, "Súhrn na zdieľanie")}>Súhrn na zdieľanie</button>
        <button className="btn ghost" disabled={busy} onClick={() => load()}>Obnoviť</button>
        <button className="btn ghost" disabled={busy || !total} onClick={async () => { if (confirm("Vymazať celý záznam AI overení?")) { await fetch("/api/admin/ailog", { method: "DELETE" }); setOut(""); load(); } }}>Vymazať záznam</button>
      </div>

      {rows.length > 0 ? (
        <div style={{ overflowX: "auto" }}>
          <table className="mini" style={{ width: "100%", fontSize: 13, borderCollapse: "collapse", marginTop: 10 }}>
            <thead>
              <tr><th>Čas</th><th>Register</th><th>Druh</th><th>IČO</th><th>Výsledok</th><th>Model</th><th>Čas behu</th><th></th></tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td>{new Date(r.at).toLocaleString("sk-SK", { day: "numeric", month: "numeric", hour: "2-digit", minute: "2-digit" })}</td>
                  <td>{NAMES[r.source] || r.source}</td>
                  <td>{r.kind === "ai" ? "AI" : "skript"}</td>
                  <td>{r.ico}{r.company ? <small className="src"> {r.company}</small> : null}</td>
                  <td>
                    <span className={`pill ${r.error || r.rejected || !["clean", "found"].includes(r.result || "") ? "s-manual" : r.result === "found" ? "s-warning" : "s-ok"}`}>{fmt(r)}</span>
                    {r.rejected ? <small className="src" title={r.rejected}> {r.rejected.slice(0, 40)}…</small> : null}
                  </td>
                  <td><small>{r.decidedBy === "jev" ? "Jev" : [r.provider, r.model].filter(Boolean).join(" · ") || "–"}{r.steps ? ` · ${r.steps} kr.` : ""}</small></td>
                  <td>{(r.ms / 1000).toFixed(1)} s</td>
                  <td><button className="mbtn" disabled={busy} onClick={() => show(`/api/admin/ailog?id=${r.id}`, `Beh ${NAMES[r.source] || r.source} · ${r.ico}`)}>Detail</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="hint">Zatiaľ žiadne záznamy – vzniknú pri ďalšom „Overiť cez AI“ alebo preverení s registrami cez prehliadač.</p>
      )}

      {out && (
        <>
          <div className="toolbar" style={{ marginTop: 10 }}>
            <b style={{ alignSelf: "center" }}>{title}</b>
            <button className="mbtn" onClick={() => { navigator.clipboard?.writeText(out); setCopied(true); }}>{copied ? "Skopírované" : "Kopírovať"}</button>
            <button
              className="mbtn"
              onClick={() => {
                const a = document.createElement("a");
                a.href = URL.createObjectURL(new Blob([out], { type: "application/json" }));
                a.download = `zaznam-ai-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}.json`;
                a.click();
              }}
            >
              Stiahnuť JSON
            </button>
            <button className="mbtn" onClick={() => setOut("")}>Zavrieť</button>
          </div>
          <pre className="diag-out">{out}</pre>
        </>
      )}
    </section>
  );
}
