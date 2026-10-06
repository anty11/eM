"use client";

import { useEffect, useMemo, useState } from "react";
import { withOrg } from "./org";
import type { ArchiveEntry } from "@/lib/seal";

const VERDICT: Record<string, { short: string; cls: string }> = {
  recommended: { short: "Odporúčame", cls: "s-ok" },
  caution: { short: "S výhradou", cls: "s-warning" },
  not_recommended: { short: "Neodporúčame", cls: "s-critical" },
};
const fmt = (iso: string) => new Date(iso).toLocaleString("sk-SK", { dateStyle: "medium", timeStyle: "short" });

/** Archív zapečatených protokolov firmy: číslo, overovací kód, dátum, verdikt, odkaz na overenie a znova otvorenie protokolu. */
export default function SealArchive() {
  const [rows, setRows] = useState<ArchiveEntry[] | null>(null);
  const [err, setErr] = useState("");
  const [q, setQ] = useState("");
  useEffect(() => {
    fetch(withOrg("/api/protocol/archive"))
      .then(async (r) => {
        if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || `Chyba ${r.status}`);
        setRows(await r.json());
      })
      .catch((e) => setErr((e as Error).message));
  }, []);
  const shown = useMemo(() => {
    const f = q.trim().toLowerCase();
    return (rows || []).filter((r) => !f || `${r.scanId} ${r.code} ${r.ico} ${r.company || ""} ${r.by}`.toLowerCase().includes(f));
  }, [rows, q]);

  return (
    <section className="card">
      <h2>Archív zapečatených protokolov</h2>
      <p className="hint" style={{ marginTop: 0 }}>
        Každé „Uložiť PDF protokol“ tu zanechá záznam s číslom a overovacím kódom. Protokol sa dá znova otvoriť a stiahnuť v zapečatenej podobe
        (pečate spred zavedenia archívu majú len kód, obsah uložený nemajú).
      </p>
      <div className="filters"><input placeholder="Hľadať číslo, kód, IČO, firmu…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Hľadať v archíve" /></div>
      {err && <div className="err">{err}</div>}
      {!rows && !err && <p>Načítavam…</p>}
      {rows && !shown.length && <p>{rows.length ? "Nič sa nenašlo." : "Zatiaľ žiadny zapečatený protokol."}</p>}
      {shown.length > 0 && (
        <div className="tbl-wrap">
          <table className="tbl" style={{ marginTop: 10 }}>
            <thead>
              <tr><th>Zapečatené</th><th>Firma</th><th>Verdikt</th><th>Číslo protokolu</th><th>Overovací kód</th><th>Vypracoval</th><th></th></tr>
            </thead>
            <tbody>
              {shown.map((r) => (
                <tr key={`${r.scanId}#${r.seq}`}>
                  <td>{fmt(r.sealedAt)}{r.seq > 1 ? <div className="src">pečať #{r.seq}</div> : null}</td>
                  <td>{r.company || "–"}<div className="src">IČO {r.ico}</div></td>
                  <td><span className={`pill ${VERDICT[r.verdict]?.cls || ""}`}>{VERDICT[r.verdict]?.short || r.verdict} · {r.score}</span></td>
                  <td className="mono">{r.scanId}</td>
                  <td className="mono"><b>{r.code}</b></td>
                  <td>{r.by}</td>
                  <td style={{ whiteSpace: "nowrap" }}>
                    {r.stored && <a href={`/protokol/${r.scanId}/${r.seq}`}>otvoriť</a>}
                    {r.stored ? " · " : ""}
                    <a href={`/overit/${r.scanId}/${r.code}`} target="_blank" rel="noreferrer">overiť ↗</a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
