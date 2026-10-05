"use client";

import { useState } from "react";

const SOURCES = [
  { id: "rpo", label: "Obchodný register / RPO (API ŠÚ SR)" },
  { id: "orsr", label: "Obchodný register SR (orsr.sk) – záloha identifikácie" },
  { id: "ruz", label: "Register účtovných závierok (API)" },
  { id: "fs", label: "Finančná správa – zoznamy a stĺpce (API)" },
  { id: "fs-debtors", label: "FS – daňoví dlžníci" },
  { id: "fs-vat", label: "FS – DPH a dôvody na zrušenie" },
  { id: "fs-ids", label: "FS – index daňovej spoľahlivosti" },
  { id: "fs-dppo", label: "FS – daňové priznanie PO" },
  { id: "socpoist", label: "Sociálna poisťovňa – dlžníci (index)" },
  { id: "insolvency", label: "REPLIK – konkurzy a likvidácie" },
  { id: "rpvs", label: "RPVS – partneri verejného sektora" },
  { id: "news", label: "Médiá" },
  { id: "diskv", label: "Register diskvalifikácií (bez API)" },
  { id: "uvo", label: "ÚVO – zákaz účasti (bez API)" },
  { id: "vszp", label: "VšZP – dlžníci (bez API)" },
  { id: "union", label: "Union – dlžníci (bez API)" },
  { id: "ov", label: "Obchodný vestník (index + stránka)" },
  { id: "cre", label: "CRE – dostupnosť" },
  { id: "dovera", label: "Dôvera – dostupnosť (len informatívne)" },
  { id: "browser", label: "Prehliadač na serveri (agent AI) – spustenie a vstupné stránky registrov" },
  { id: "ov-browser", label: "Obchodný vestník cez prehliadač (skript bez AI)" },
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

  const [progress, setProgress] = useState("");

  async function fetchText(url: string) {
    // serverová funkcia má limit 120 s – klient čaká najviac 150 s a potom zrozumiteľne skončí
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 150000);
    let r: Response;
    try {
      r = await fetch(url, { signal: ctrl.signal });
    } catch (e) {
      throw new Error((e as Error).name === "AbortError" ? "Server neodpovedal do 150 s (limit funkcie je 120 s) – skúste zdroj samostatne." : (e as Error).message);
    } finally {
      clearTimeout(t);
    }
    const txt = await r.text();
    try {
      return JSON.parse(txt);
    } catch {
      return { raw: txt };
    }
  }
  const sourceUrl = (id: string) => `/api/diag?source=${id}&ico=${encodeURIComponent(ico)}${name ? `&name=${encodeURIComponent(name)}` : ""}`;

  async function run(mode: "one" | "full" | "all") {
    setBusy(true);
    setOut("");
    setCopied(false);
    try {
      if (mode === "all") {
        const all: Record<string, unknown> = { ico, name, at: new Date().toISOString(), version: "diag-all" };
        for (const s of SOURCES) {
          setProgress(`${s.label}…`);
          try {
            all[s.id] = await fetchText(sourceUrl(s.id));
          } catch (e) {
            all[s.id] = { error: (e as Error).message };
          }
          setOut(JSON.stringify(all, null, 2));
        }
        setProgress("");
        return;
      }
      const j = await fetchText(mode === "full" ? `/api/diag?ico=${encodeURIComponent(ico)}` : sourceUrl(source));
      setOut(JSON.stringify(j, null, 2));
    } catch (e) {
      setOut(`Chyba: ${(e as Error).message}`);
    } finally {
      setBusy(false);
      setProgress("");
    }
  }

  return (
    <section className="card">
      <h2>Diagnostika zdrojov</h2>
      <p className="hint" style={{ marginTop: 0 }}>
        Pre každý zdroj spustí zo servera skutočný dopyt pre zadané IČO a ukáže surovú odpoveď (pri registroch bez API aj formuláre, skripty a začiatok HTML)
        spolu s výsledkom kontroly. „Spustiť všetky zdroje“ prejde zdroje postupne (asi 1 – 3 minúty) a zloží jeden výstup – ten skopírujte a pošlite vývoju.
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
        <button className="btn" disabled={busy} onClick={() => run("one")}>{busy && !progress ? "Overujem…" : "Spustiť zvolený zdroj"}</button>
        <button className="btn" disabled={busy} onClick={() => run("all")}>{progress ? `Prebieha: ${progress}` : "Spustiť všetky zdroje"}</button>
        <button className="btn ghost" disabled={busy} onClick={() => run("full")}>Dostupnosť a skúšobné preverenie</button>
        {out && (
          <>
            <button className="mbtn" onClick={() => { navigator.clipboard?.writeText(out); setCopied(true); }}>{copied ? "Skopírované" : "Kopírovať výstup"}</button>
            <button
              className="mbtn"
              onClick={() => {
                const a = document.createElement("a");
                a.href = URL.createObjectURL(new Blob([out], { type: "application/json" }));
                a.download = `diagnostika-${ico}-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}.json`;
                a.click();
              }}
            >
              Stiahnuť JSON
            </button>
          </>
        )}
      </div>
      {out && <pre className="diag-out">{out}</pre>}
    </section>
  );
}
