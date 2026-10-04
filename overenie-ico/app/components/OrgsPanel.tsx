"use client";

import { useEffect, useState } from "react";

export interface OrgRow {
  id: string;
  name: string;
  ico?: string;
  mode: "firma" | "advokat";
  seats: number;
  used: number;
  disabled?: boolean;
  note?: string;
  orderId?: string;
  createdAt: string;
}

export interface OrgPrefill { name: string; ico?: string; mode: "firma" | "advokat"; seats: number; orderId?: string }

const dt = (s?: string) => (s ? new Date(s).toLocaleDateString("sk-SK") : "–");
const selStyle = { font: "inherit", fontSize: 13, padding: "4px 8px", border: "1px solid var(--line)", borderRadius: 6, background: "var(--surface)", color: "var(--ink)" } as const;

async function api(url: string, method = "GET", body?: unknown) {
  const r = await fetch(url, { method, headers: body ? { "Content-Type": "application/json" } : undefined, body: body ? JSON.stringify(body) : undefined });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || `Chyba ${r.status}`);
  return j;
}

/**
 * Firmy (klienti): každá má vlastný oddelený priestor dát, balík (Štandard / Rozšírené) a počet používateľských miest.
 * Zakladá a spravuje ich len správca platformy; po založení sa v časti Používatelia pridajú poverení zamestnanci.
 */
export default function OrgsPanel({ selected, onSelect, prefill, onPrefillUsed, onChanged }: { selected: string; onSelect: (id: string) => void; prefill?: OrgPrefill | null; onPrefillUsed?: () => void; onChanged?: () => void }) {
  const [orgs, setOrgs] = useState<OrgRow[]>([]);
  const [err, setErr] = useState("");
  const [f, setF] = useState({ name: "", ico: "", mode: "advokat" as "firma" | "advokat", seats: "3", note: "", orderId: "" });
  const [busy, setBusy] = useState(false);

  const load = () => api("/api/admin/orgs").then((j) => { setOrgs(j); onChanged?.(); }).catch((e) => setErr(e.message));
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);
  useEffect(() => {
    if (prefill) {
      setF({ name: prefill.name, ico: prefill.ico || "", mode: prefill.mode, seats: String(prefill.seats || 3), note: "", orderId: prefill.orderId || "" });
      onPrefillUsed?.();
      document.getElementById("org-new")?.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, [prefill, onPrefillUsed]);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setErr("");
    setBusy(true);
    try {
      const o = await api("/api/admin/orgs", "POST", { ...f, seats: Number(f.seats) });
      setF({ name: "", ico: "", mode: "advokat", seats: "3", note: "", orderId: "" });
      await load();
      onSelect(o.id);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function patch(id: string, change: object) {
    setErr("");
    try {
      await api("/api/admin/orgs", "PATCH", { id, ...change });
      await load();
    } catch (e) {
      setErr((e as Error).message);
    }
  }

  return (
    <section className="card" id="firmy">
      <h2>Firmy ({orgs.length})</h2>
      <p className="hint" style={{ marginTop: 0 }}>
        Každá firma má vlastný, oddelený priestor: používateľov, preverenia, databázu preverených spoločností, karty kontaktov aj protokol činností.
        Používatelia jednej firmy nevidia nič z inej. Správcovia platformy do žiadnej firmy nepatria – pracujú v mene firmy zvolenej v hornej lište.
      </p>
      {err && <div className="err">{err}</div>}
      <div className="tbl-wrap">
        <table className="tbl">
          <thead>
            <tr><th>Firma</th><th>Balík</th><th>Miesta</th><th>Stav</th><th>Založená</th><th></th></tr>
          </thead>
          <tbody>
            {orgs.map((o) => {
              const sel = o.id === selected;
              return (
                <tr key={o.id} style={sel ? { background: "var(--brand-soft, rgba(91,53,201,0.06))" } : undefined}>
                  <td>
                    <b>{o.name}</b>{sel && <span className="src"> (zvolená)</span>}
                    <div className="src">{o.ico ? `IČO ${o.ico} · ` : ""}id {o.id}{o.orderId ? ` · objednávka ${o.orderId}` : ""}</div>
                    {o.note && <div className="src">{o.note}</div>}
                    <div>
                      <button className="linkbtn src" onClick={() => { const n = prompt(`Názov firmy`, o.name); if (n !== null && n.trim()) patch(o.id, { name: n }); }}>upraviť názov</button>
                      {" · "}
                      <button className="linkbtn src" onClick={() => { const n = prompt(`IČO firmy`, o.ico || ""); if (n !== null) patch(o.id, { ico: n }); }}>IČO</button>
                      {" · "}
                      <button className="linkbtn src" onClick={() => { const n = prompt(`Poznámka`, o.note || ""); if (n !== null) patch(o.id, { note: n }); }}>poznámka</button>
                    </div>
                  </td>
                  <td>
                    <select value={o.mode} onChange={(e) => patch(o.id, { mode: e.target.value })} style={selStyle}>
                      <option value="firma">Štandard</option>
                      <option value="advokat">Rozšírené</option>
                    </select>
                  </td>
                  <td>
                    <span style={{ fontWeight: 600, color: o.used >= o.seats ? "var(--warn)" : undefined }}>{o.used}</span> / {o.seats}
                    <div><button className="linkbtn src" onClick={() => { const n = prompt(`Počet používateľských miest pre ${o.name}`, String(o.seats)); if (n !== null && Number(n) > 0) patch(o.id, { seats: Number(n) }); }}>zmeniť</button></div>
                  </td>
                  <td><span className={`pill ${o.disabled ? "s-critical" : "s-ok"}`}>{o.disabled ? "Pozastavená" : "Aktívna"}</span></td>
                  <td className="src">{dt(o.createdAt)}</td>
                  <td>
                    <div className="row-actions">
                      <button className="mbtn" onClick={() => onSelect(o.id)} disabled={sel}>{sel ? "Zvolená" : "Zvoliť"}</button>
                      <button className="mbtn" onClick={() => { if (o.disabled || confirm(`Pozastaviť prístup firmy ${o.name}? Jej používatelia sa nebudú môcť prihlásiť, dáta ostávajú.`)) patch(o.id, { disabled: !o.disabled }); }}>
                        {o.disabled ? "Obnoviť" : "Pozastaviť"}
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
            {!orgs.length && <tr><td colSpan={6} className="src">Zatiaľ žiadna firma – založte prvú nižšie.</td></tr>}
          </tbody>
        </table>
      </div>

      <form onSubmit={create} id="org-new" style={{ marginTop: 18, paddingTop: 16, borderTop: "1px solid var(--line)" }}>
        <h3 style={{ margin: "0 0 10px", fontSize: 16 }}>Založiť firmu</h3>
        <div className="contact-grid">
          <div className="field"><label>Názov firmy</label><input required value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="Názov podľa obchodného registra" /></div>
          <div className="field"><label>IČO</label><input inputMode="numeric" value={f.ico} onChange={(e) => setF({ ...f, ico: e.target.value })} placeholder="8 číslic" /></div>
          <div className="field">
            <label>Balík</label>
            <select value={f.mode} onChange={(e) => setF({ ...f, mode: e.target.value as "firma" | "advokat" })}>
              <option value="advokat">Rozšírené</option>
              <option value="firma">Štandard</option>
            </select>
          </div>
          <div className="field"><label>Počet používateľských miest</label><input type="number" min={1} max={500} required value={f.seats} onChange={(e) => setF({ ...f, seats: e.target.value })} /></div>
        </div>
        <div className="field"><label>Poznámka (nepovinné)</label><input value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} placeholder="napr. kontaktná osoba, dohodnuté podmienky" /></div>
        {f.orderId && <p className="hint" style={{ marginTop: 0 }}>Z objednávky {f.orderId}.</p>}
        <div className="toolbar" style={{ marginTop: 4 }}>
          <button className="btn" disabled={busy || !f.name.trim()}>{busy ? "Zakladám…" : "Založiť firmu"}</button>
        </div>
      </form>
    </section>
  );
}
