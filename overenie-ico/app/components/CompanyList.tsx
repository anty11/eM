"use client";

import { useEffect, useMemo, useState } from "react";
import type { CompanyRecord } from "@/lib/companies";
import { STALE_DAYS, agoLabel } from "@/lib/ago";
import type { Me } from "./Header";

type Row = CompanyRecord & { days: number; stale: boolean };

const VERDICT: Record<string, { short: string; cls: string }> = {
  recommended: { short: "Odporúčame", cls: "s-ok" },
  caution: { short: "S výhradou", cls: "s-warning" },
  not_recommended: { short: "Neodporúčame", cls: "s-critical" },
};

const fmt = (iso: string) => new Date(iso).toLocaleString("sk-SK", { dateStyle: "medium", timeStyle: "short" });

/**
 * Databáza preverených spoločností – zoradená od posledného preverenia.
 * Pri každej firme je vek preverenia; po 180 dňoch červený ako podnet na opakované preverenie.
 */
export default function CompanyList({ me }: { me?: Me | null }) {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [err, setErr] = useState("");
  const [mine, setMine] = useState(false);
  const [q, setQ] = useState("");
  const [onlyStale, setOnlyStale] = useState(false);

  async function load() {
    setErr("");
    try {
      const r = await fetch("/api/companies");
      if (!r.ok) throw new Error(`Chyba ${r.status}`);
      setRows(await r.json());
    } catch (e) {
      setErr((e as Error).message);
    }
  }
  useEffect(() => {
    load();
  }, []);

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return (rows || [])
      .filter((r) => !mine || r.lastBy === me?.email)
      .filter((r) => !onlyStale || r.stale)
      .filter((r) => !needle || r.ico.includes(needle) || r.name.toLowerCase().includes(needle) || r.lastBy.toLowerCase().includes(needle));
  }, [rows, mine, onlyStale, q, me]);

  const staleCount = (rows || []).filter((r) => r.stale).length;

  async function remove(ico: string, name: string) {
    if (!confirm(`Odstrániť ${name || ico} zo zoznamu preverených spoločností?`)) return;
    const r = await fetch(`/api/companies?ico=${ico}`, { method: "DELETE" });
    if (r.ok) setRows((s) => (s || []).filter((x) => x.ico !== ico));
    else setErr("Odstránenie zlyhalo.");
  }

  return (
    <section className="card companies">
      <h2>Preverené spoločnosti</h2>
      <p className="hint" style={{ marginTop: 0 }}>
        Všetky spoločnosti, ktoré kancelária preverila, od najnovšieho preverenia. Preverenie staršie ako {STALE_DAYS} dní je označené červeným – odporúčame ho zopakovať.
        {staleCount > 0 && <> <b className="f-critical">{staleCount} {staleCount === 1 ? "spoločnosť čaká" : staleCount < 5 ? "spoločnosti čakajú" : "spoločností čaká"} na opakované preverenie.</b></>}
      </p>
      <div className="filters">
        <input placeholder="Hľadať názov, IČO alebo kolegu" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Hľadať" />
        <label className="check-row"><input type="checkbox" checked={mine} onChange={(e) => setMine(e.target.checked)} /><span>Len moje preverenia</span></label>
        <label className="check-row"><input type="checkbox" checked={onlyStale} onChange={(e) => setOnlyStale(e.target.checked)} /><span>Len na opakované preverenie</span></label>
        <button className="mbtn" onClick={load}>Obnoviť zoznam</button>
      </div>
      {err && <div className="err">{err}</div>}
      {rows === null ? (
        <p className="loading">Načítavam…</p>
      ) : shown.length === 0 ? (
        <p className="hint">{rows.length === 0 ? "Zatiaľ nebola preverená žiadna spoločnosť. Preverte prvú na stránke Preverenie." : "Žiadna spoločnosť nezodpovedá filtru."}</p>
      ) : (
        <div className="tbl-wrap">
          <table className="tbl">
            <thead>
              <tr>
                <th>Spoločnosť</th>
                <th>IČO</th>
                <th>Výsledok</th>
                <th>Posledné preverenie</th>
                <th>Preveril</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {shown.map((r) => {
                const v = VERDICT[r.verdict] || { short: r.verdict || "–", cls: "s-info" };
                return (
                  <tr key={r.ico} className={r.stale ? "stale" : ""}>
                    <td><a href={`/app?ico=${r.ico}`}>{r.name || "Neznámy subjekt"}</a>{r.count > 1 && <span className="src"> · {r.count}× preverené</span>}</td>
                    <td style={{ fontVariantNumeric: "tabular-nums" }}>{r.ico}</td>
                    <td><span className={`pill ${v.cls}`}>{v.short}</span> <span className="src">{r.score}/100</span></td>
                    <td>
                      <span className={`ago ${r.stale ? "f-critical" : ""}`} title={fmt(r.lastAt)}>
                        {r.stale ? "⚠ " : ""}overené {agoLabel(r.days)}
                      </span>
                      <div className="src">{fmt(r.lastAt)}{r.stale ? " · odporúčame opakované preverenie" : ""}</div>
                    </td>
                    <td className="src">{r.lastBy}</td>
                    <td>
                      <div className="row-actions">
                        <a className={`mbtn ${r.stale ? "on-found" : ""}`} href={`/app?ico=${r.ico}`} title="Spustí nové preverenie vo verejných registroch">↻ Preveriť znova</a>
                        {me?.role === "admin" && <button className="mbtn" onClick={() => remove(r.ico, r.name)} title="Odstrániť zo zoznamu">Odstrániť</button>}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
