"use client";

import { useEffect, useState } from "react";
import type { ErrRecord } from "@/lib/errlog";

interface Summary {
  source: string;
  errors: number;
  retryOk: number;
  retryFail: number;
  deadlines: number;
  cold: number;
  messages: string[];
}

const KIND: Record<ErrRecord["kind"], string> = { error: "chyba", deadline: "limit", "retry-ok": "opakovanie OK", "retry-fail": "opakovanie zlyhalo" };

/**
 * Administrácia → Chyby zdrojov: každé zlyhanie kontroly ostane zapísané, aj keď sa pri opakovaní „samo opraví“.
 * Súhrn za zdroj: koľko chýb, koľko z nich pri studenom štarte, koľko opakovaní uspelo, najčastejšie správy – podklad na odstránenie príčiny.
 */
export default function ErrorLogPanel() {
  const [rows, setRows] = useState<ErrRecord[]>([]);
  const [summary, setSummary] = useState<Summary[]>([]);
  const [total, setTotal] = useState(0);
  const [copied, setCopied] = useState(false);

  async function load() {
    const r = await fetch("/api/admin/errlog?limit=120");
    const j = await r.json().catch(() => ({ errors: [], summary: [], total: 0 }));
    setRows(j.errors || []);
    setSummary(j.summary || []);
    setTotal(j.total || 0);
  }
  useEffect(() => {
    load();
  }, []);

  const text = () =>
    [
      `Chyby zdrojov – ${new Date().toLocaleString("sk-SK")} (${total} záznamov)`,
      ...summary.map((s) => `${s.source}: chýb ${s.errors} (studený štart ${s.cold}), limit ${s.deadlines}, opakovanie OK ${s.retryOk} / zlyhalo ${s.retryFail}; ${s.messages.join(" | ")}`),
      "",
      ...rows.slice(0, 60).map((r) => `${new Date(r.at).toLocaleString("sk-SK")} ${KIND[r.kind]} ${r.source} ${r.ico} ${r.ms ? `${r.ms} ms` : ""} ${r.cold ? "[studený štart]" : ""} ${r.where || ""}: ${r.message}`),
    ].join("\n");

  return (
    <section className="card">
      <h2>Chyby zdrojov</h2>
      <p className="hint" style={{ marginTop: 0 }}>
        Každé zlyhanie kontroly ostane zapísané, aj keď sa pri „Skúsiť znova“ alebo ďalšom preverení samo opraví. Súhrn ukáže, ktorý zdroj padá
        prechodne (studený štart funkcie, limit, pomalý register) a s akou správou – to je podklad na odstránenie príčiny.
      </p>
      {summary.length ? (
        <table className="mini" style={{ width: "100%", fontSize: 13, borderCollapse: "collapse" }}>
          <thead>
            <tr>
              <th style={{ textAlign: "left" }}>Zdroj</th>
              <th>Chýb</th>
              <th title="prvá chyba po štarte inštancie funkcie">Studený štart</th>
              <th>Limit</th>
              <th>Opakovanie OK / zlyhalo</th>
              <th style={{ textAlign: "left" }}>Najčastejšie správy</th>
            </tr>
          </thead>
          <tbody>
            {summary.map((s) => (
              <tr key={s.source}>
                <td>{s.source}</td>
                <td style={{ textAlign: "center" }}>{s.errors}</td>
                <td style={{ textAlign: "center" }}>{s.cold}</td>
                <td style={{ textAlign: "center" }}>{s.deadlines}</td>
                <td style={{ textAlign: "center" }}>
                  {s.retryOk} / {s.retryFail}
                </td>
                <td style={{ fontSize: 12 }}>{s.messages.join(" · ")}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p className="hint">Zatiaľ žiadne chyby.</p>
      )}
      {rows.length > 0 && (
        <details style={{ marginTop: 8 }}>
          <summary>Posledné záznamy ({Math.min(rows.length, 120)} z {total})</summary>
          <ul style={{ fontSize: 12, margin: "6px 0 0 18px", padding: 0 }}>
            {rows.map((r) => (
              <li key={r.id}>
                {new Date(r.at).toLocaleString("sk-SK")} · <b>{KIND[r.kind]}</b> · {r.source} · {r.ico} {r.ms ? `· ${r.ms} ms` : ""} {r.cold ? "· studený štart" : ""} {r.where ? `· ${r.where}` : ""}: {r.message}
              </li>
            ))}
          </ul>
        </details>
      )}
      <div className="actions" style={{ marginTop: 8, display: "flex", gap: 8 }}>
        <button className="mbtn" onClick={load}>Obnoviť</button>
        <button className="mbtn" onClick={() => { navigator.clipboard?.writeText(text()); setCopied(true); }}>{copied ? "Skopírované" : "Kopírovať súhrn"}</button>
        <button className="mbtn" onClick={async () => { if (confirm("Vymazať záznam chýb?")) { await fetch("/api/admin/errlog", { method: "DELETE" }); load(); } }}>Vymazať</button>
      </div>
    </section>
  );
}
