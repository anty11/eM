"use client";

import { useState } from "react";

const SOURCES = [
  { id: "diskv", label: "Register diskvalifikácií" },
  { id: "uvo", label: "ÚVO – zákaz účasti" },
  { id: "vszp", label: "VšZP – dlžníci" },
  { id: "union", label: "Union – dlžníci" },
];

/**
 * Diagnostika zdrojov pre správcu platformy: spustí dopyt do registra bez API a zobrazí všetky pokusy s výňatkami odpovedí
 * (formuláre, skripty, surové HTML), aby sa dali doladiť adresy a rozpoznávanie výsledku. Výstup sa kopíruje jedným tlačidlom.
 */
export default function DiagPanel() {
  const [source, setSource] = useState("diskv");
  const [ico, setIco] = useState("31322832");
  const [name, setName] = useState("");
  const [out, setOut] = useState("");
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  async function run(full = false) {
    setBusy(true);
    setOut("");
    setCopied(false);
    try {
      const url = full ? `/api/diag?ico=${encodeURIComponent(ico)}` : `/api/diag?source=${source}&ico=${encodeURIComponent(ico)}${name ? `&name=${encodeURIComponent(name)}` : ""}`;
      const r = await fetch(url);
      const txt = await r.text();
      try {
        setOut(JSON.stringify(JSON.parse(txt), null, 2));
      } catch {
        setOut(txt);
      }
    } catch (e) {
      setOut(`Chyba: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card">
      <h2>Diagnostika zdrojov</h2>
      <p className="hint" style={{ marginTop: 0 }}>
        Spustí dopyt zo servera do zvoleného registra a ukáže všetky pokusy aj s odpoveďou (formuláre, skripty, začiatok HTML). Výstup skopírujte
        a pošlite vývoju – podľa neho sa doladia adresy a rozpoznávanie výsledku. „Celková diagnostika“ overí dostupnosť všetkých zdrojov a spraví skúšobné preverenie.
      </p>
      <div className="contact-grid">
        <div className="field">
          <label>Register</label>
          <select value={source} onChange={(e) => setSource(e.target.value)}>
            {SOURCES.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
          </select>
        </div>
        <div className="field"><label>IČO</label><input value={ico} onChange={(e) => setIco(e.target.value)} inputMode="numeric" /></div>
        <div className="field"><label>Mená štatutárov (diskvalifikácie; oddelené bodkočiarkou)</label><input value={name} onChange={(e) => setName(e.target.value)} placeholder="Ing. Gabriel Szabó; Ferenc Horváth" /></div>
      </div>
      <div className="toolbar" style={{ marginTop: 4 }}>
        <button className="btn" disabled={busy} onClick={() => run(false)}>{busy ? "Overujem…" : "Spustiť dopyt"}</button>
        <button className="btn ghost" disabled={busy} onClick={() => run(true)}>Celková diagnostika</button>
        {out && (
          <button className="mbtn" onClick={() => { navigator.clipboard?.writeText(out); setCopied(true); }}>{copied ? "Skopírované" : "Kopírovať výstup"}</button>
        )}
      </div>
      {out && <pre className="diag-out">{out}</pre>}
    </section>
  );
}
