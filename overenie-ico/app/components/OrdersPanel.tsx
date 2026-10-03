"use client";

import { useEffect, useState } from "react";
import type { Order } from "@/lib/orders";

const STATUS: Record<Order["status"], { label: string; cls: string }> = {
  new: { label: "Nová", cls: "s-warning" },
  contacted: { label: "Oslovená", cls: "s-info" },
  done: { label: "Vybavená", cls: "s-ok" },
};
const PLAN: Record<Order["plan"], string> = { standard: "Štandard", rozsirene: "Rozšírené" };
const fmt = (iso: string) => new Date(iso).toLocaleString("sk-SK", { dateStyle: "medium", timeStyle: "short" });

/** Objednávky z verejného webu – administrátor ich tu vidí a mení stav. */
export default function OrdersPanel() {
  const [orders, setOrders] = useState<Order[] | null>(null);
  const [err, setErr] = useState("");
  const [showDone, setShowDone] = useState(false);

  const load = () =>
    fetch("/api/admin/orders").then(async (r) => {
      if (!r.ok) throw new Error(`Chyba ${r.status}`);
      setOrders(await r.json());
    }).catch((e) => setErr((e as Error).message));
  useEffect(() => {
    load();
  }, []);

  async function setStatus(id: string, status: Order["status"]) {
    const r = await fetch("/api/admin/orders", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, status }) });
    if (r.ok) setOrders((s) => (s || []).map((o) => (o.id === id ? { ...o, status } : o)));
    else setErr("Zmena stavu zlyhala.");
  }

  const shown = (orders || []).filter((o) => showDone || o.status !== "done");
  const open = (orders || []).filter((o) => o.status === "new").length;

  return (
    <section className="card">
      <h2>Objednávky z webu ({orders?.length ?? "…"}){open > 0 && <span className="pill s-warning" style={{ marginLeft: 8 }}>{open} nových</span>}</h2>
      <p className="hint" style={{ marginTop: 0 }}>
        Objednávky odoslané z verejnej stránky /objednavka. Po oslovení klienta zmeňte stav; prístupy mu vytvoríte v časti Pridať používateľov.
        {" "}Upozornenie e-mailom pošle aplikácia len vtedy, ak je nastavená premenná <code>ORDER_WEBHOOK_URL</code>.
      </p>
      <div className="filters">
        <label className="check-row"><input type="checkbox" checked={showDone} onChange={(e) => setShowDone(e.target.checked)} /><span>Zobraziť aj vybavené</span></label>
        <button className="mbtn" onClick={load}>Obnoviť</button>
      </div>
      {err && <div className="err">{err}</div>}
      {orders && shown.length === 0 && <p className="hint">Žiadne objednávky.</p>}
      {shown.length > 0 && (
        <div className="tbl-wrap">
          <table className="tbl">
            <thead>
              <tr><th>Prijatá</th><th>Spoločnosť</th><th>Kontakt</th><th>Verzia</th><th>Stav</th><th></th></tr>
            </thead>
            <tbody>
              {shown.map((o) => (
                <tr key={o.id}>
                  <td className="src">{fmt(o.at)}<br />{o.id}</td>
                  <td><b>{o.company}</b>{o.ico && <> · <a href={`/app?ico=${o.ico}`}>{o.ico}</a></>}{o.message && <div className="src">{o.message}</div>}</td>
                  <td>{o.contactName}<br /><a href={`mailto:${o.email}`}>{o.email}</a>{o.phone && <><br />{o.phone}</>}</td>
                  <td>{PLAN[o.plan]}<br /><span className="src">{o.users} používateľov</span></td>
                  <td><span className={`pill ${STATUS[o.status].cls}`}>{STATUS[o.status].label}</span></td>
                  <td>
                    <div className="row-actions">
                      {o.status !== "contacted" && <button className="mbtn" onClick={() => setStatus(o.id, "contacted")}>Oslovená</button>}
                      {o.status !== "done" && <button className="mbtn" onClick={() => setStatus(o.id, "done")}>Vybavená</button>}
                      {o.status === "done" && <button className="mbtn" onClick={() => setStatus(o.id, "new")}>Otvoriť znova</button>}
                    </div>
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
