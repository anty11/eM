"use client";

import { useRef, useState } from "react";
import { selectedOrg, withOrg } from "./org";
import { summarizeLoad, type LoadRun } from "@/lib/loadtest";

const DEFAULT_ICOS = "31322832, 47244895, 57434352, 47960833, 36277151, 35703130, 53165012, 35757442";
const fmtS = (ms?: number) => (typeof ms === "number" ? `${(ms / 1000).toFixed(1)} s` : "–");

/**
 * Záťažová skúška pre správcu platformy: z prehliadača spustí N preverení naraz cez /api/check (naostro – skutočné registre,
 * každé vo vlastnej funkcii na Verceli), bez zápisu do zoznamu firiem a auditu. Postupné vlny (napr. 5 → 10 → 25 → 50)
 * ukážu, pri akej súbežnosti začne niektorý register odmietať alebo spomaľovať.
 */
export default function LoadTestPanel() {
  const [icos, setIcos] = useState(DEFAULT_ICOS);
  const [waves, setWaves] = useState("5, 10, 25, 50");
  const [pause, setPause] = useState(30);
  const [runs, setRuns] = useState<LoadRun[]>([]);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [copied, setCopied] = useState(false);
  const abort = useRef<AbortController | null>(null);
  const live = useRef<LoadRun[]>([]);

  const flush = () => setRuns([...live.current]);

  async function one(ico: string, wave: number, signal: AbortSignal) {
    const run: LoadRun = { ico, wave, startedAt: Date.now(), done: false, sources: [] };
    live.current.push(run);
    try {
      const r = await fetch(withOrg(`/api/check?ico=${ico}&stream=1&fresh=1&loadtest=1`), { signal });
      run.httpStatus = r.status;
      if (!r.ok || !r.body) {
        run.error = ((await r.json().catch(() => ({}))) as any).error || `HTTP ${r.status}`;
        return;
      }
      const reader = r.body.getReader();
      const dec = new TextDecoder();
      let buf = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let i: number;
        while ((i = buf.indexOf("\n")) >= 0) {
          const line = buf.slice(0, i).trim();
          buf = buf.slice(i + 1);
          if (!line) continue;
          const ev = JSON.parse(line);
          if (run.firstMs === undefined && ev.type !== "ping") run.firstMs = Date.now() - run.startedAt;
          if (ev.type === "start") {
            run.instance = ev.instance;
            run.region = ev.region;
          } else if (ev.type === "check" && ev.check) {
            const c = ev.check;
            run.sources = [...run.sources.filter((s) => s.id !== c.id), { id: c.id, status: c.status, ms: c.durationMs, summary: c.status === "manual" && (c.data?.autoNote || c.data?.autoError) ? `${c.data.autoNote || c.data.autoError}` : c.summary }];
          } else if (ev.type === "done") {
            run.done = true;
            run.totalMs = Date.now() - run.startedAt;
            run.verdict = ev.report?.verdict?.level;
            for (const c of ev.report?.checks || []) run.sources = [...run.sources.filter((s) => s.id !== c.id), { id: c.id, status: c.status, ms: c.durationMs, summary: c.status === "manual" && (c.data?.autoNote || c.data?.autoError) ? `${c.data.autoNote || c.data.autoError}` : c.summary }];
          } else if (ev.type === "error") run.error = ev.error;
        }
        flush();
      }
      if (!run.done && !run.error) run.error = "spojenie sa skončilo bez výsledku";
    } catch (e) {
      run.error = (e as Error).name === "AbortError" ? "zastavené" : (e as Error).message;
    } finally {
      flush();
    }
  }

  async function start() {
    if (!selectedOrg()) return setStatus("Najprv v hlavičke zvoľte firmu – preverenia bežia v jej mene (do zoznamu firiem sa nezapíšu).");
    const list = icos.split(/[\s,;]+/).filter((x) => /^\d{6,8}$/.test(x));
    const sizes = waves.split(/[\s,;→>]+/).map(Number).filter((n) => n > 0 && n <= 50);
    if (!list.length || !sizes.length) return setStatus("Zadajte aspoň jedno IČO a veľkosť vlny (1 – 50).");
    if (!confirm(`Spustí sa ${sizes.reduce((a, b) => a + b, 0)} skutočných preverení vo vlnách ${sizes.join(" → ")}. Registre dostanú skutočné dopyty. Pokračovať?`)) return;
    live.current = [];
    setRuns([]);
    setBusy(true);
    abort.current = new AbortController();
    try {
      for (let w = 0; w < sizes.length; w++) {
        if (abort.current.signal.aborted) break;
        setStatus(`Vlna ${w + 1}/${sizes.length}: ${sizes[w]} preverení naraz…`);
        await Promise.all(Array.from({ length: sizes[w] }, (_, i) => one(list[i % list.length], w + 1, abort.current!.signal)));
        const waveRuns = live.current.filter((r) => r.wave === w + 1);
        const s = summarizeLoad(waveRuns);
        if (s.throttledSources.length >= 3 || s.failed > waveRuns.length / 2) {
          setStatus(`Zastavené po vlne ${w + 1}: registre začali odmietať (${s.throttledSources.join(", ") || "veľa chýb"}) – ďalšie vlny by ich zbytočne zaťažili.`);
          return;
        }
        if (w < sizes.length - 1) {
          setStatus(`Vlna ${w + 1} hotová – pauza ${pause} s pred ďalšou vlnou…`);
          await new Promise((r) => setTimeout(r, pause * 1000));
        }
      }
      setStatus("Hotovo.");
    } finally {
      setBusy(false);
    }
  }

  const waveNums = [...new Set(runs.map((r) => r.wave))];
  const report = { at: new Date().toISOString(), icos, waves, waves_summary: waveNums.map((w) => ({ wave: w, ...summarizeLoad(runs.filter((r) => r.wave === w)) })),
    failedRuns: runs.filter((r) => !r.done).map((r) => ({ wave: r.wave, ico: r.ico, http: r.httpStatus, error: r.error, afterMs: Date.now() - r.startedAt, lastSources: r.sources.length })) };

  return (
    <section className="card">
      <h2>Záťažová skúška</h2>
      <p className="hint" style={{ marginTop: 0 }}>
        Spustí z tohto prehliadača viac preverení naraz – naostro, so skutočnými dopytmi do registrov, každé vo vlastnej funkcii na Verceli.
        Do zoznamu firiem ani auditu sa nezapíšu. Vlny idú postupne s pauzou; ak začnú registre odmietať, skúška sa sama zastaví.
        Odporúčame mimo pracovnej špičky a najviac raz za deň.
      </p>
      <div className="field"><label>IČO (striedajú sa)</label><input value={icos} onChange={(e) => setIcos(e.target.value)} /></div>
      <div className="filters">
        <div className="field"><label>Vlny (súbežné preverenia, max. 50)</label><input value={waves} onChange={(e) => setWaves(e.target.value)} /></div>
        <div className="field"><label>Pauza medzi vlnami (s)</label><input type="number" min={5} max={300} value={pause} onChange={(e) => setPause(Number(e.target.value) || 30)} /></div>
      </div>
      <div className="toolbar">
        <button className="btn" disabled={busy} onClick={start}>Spustiť skúšku</button>
        {busy && <button className="btn ghost" onClick={() => abort.current?.abort()}>Zastaviť</button>}
        {runs.length > 0 && (
          <button className="mbtn" onClick={() => { navigator.clipboard?.writeText(JSON.stringify(report, null, 2)); setCopied(true); setTimeout(() => setCopied(false), 1500); }}>
            {copied ? "Skopírované" : "Kopírovať výsledok"}
          </button>
        )}
        {status && <span className="src">{status}</span>}
      </div>

      {waveNums.map((w) => {
        const wr = runs.filter((r) => r.wave === w);
        const s = summarizeLoad(wr);
        return (
          <div key={w} style={{ marginTop: 16 }}>
            <h3 style={{ margin: "0 0 6px" }}>
              Vlna {w}: {wr.length} naraz · hotových {s.done}, neúspešných {s.failed} · celé preverenie p50 {fmtS(s.totalMs.p50)}, p95 {fmtS(s.totalMs.p95)}, max {fmtS(s.totalMs.max)} ·
              prvý výsledok p50 {fmtS(s.firstMs.p50)} · inštancií {s.instances || "?"}{s.regions.length ? ` (${s.regions.join(", ")})` : ""}
            </h3>
            {s.throttledSources.length > 0 && <div className="f-critical">Obmedzovanie / časové limity: {s.throttledSources.join(", ")}</div>}
            <div className="tbl-wrap">
              <table className="tbl">
                <thead><tr><th>Zdroj</th><th>OK</th><th>Nedostupný</th><th>Manuálne</th><th>Limit/blok.</th><th>priemer</th><th>p95</th><th>Ukážka chyby</th></tr></thead>
                <tbody>
                  {s.sources.map((x) => (
                    <tr key={x.id}>
                      <td>{x.id}</td>
                      <td>{x.ok}/{x.runs}</td>
                      <td className={x.errors ? "f-critical" : ""}>{x.errors}</td>
                      <td>{x.manual}</td>
                      <td className={x.throttled ? "f-critical" : ""}>{x.throttled}</td>
                      <td>{fmtS(x.avgMs)}</td>
                      <td>{fmtS(x.p95Ms)}</td>
                      <td className="src">{x.samples[0] || ""}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {wr.some((r) => r.error) && <div className="src">Chyby behov: {[...new Set(wr.map((r) => r.error).filter(Boolean))].slice(0, 3).join(" · ")}</div>}
          </div>
        );
      })}
    </section>
  );
}
