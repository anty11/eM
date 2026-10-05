"use client";

import { useEffect, useState } from "react";

interface Status {
  proxy: { active: boolean; origin: "env" | "admin" | null; server?: string; domains: string[]; enabled: boolean; envLocked: boolean };
  ov: { configured: boolean; origin: "env" | "admin" | null; exportUrl: string; user: string; hasPassword: boolean; envLocked: boolean };
  updatedAt?: string;
  updatedBy?: string;
}

/**
 * Administrácia → Prístupy k registrom: čo môže správca nastaviť sám, aby sa zvyšné registre overovali automaticky
 * (proxy pre registre blokujúce dátové centrá, prístup k exportu Obchodného vestníka) + prehľad, čo ešte vyžaduje registráciu.
 */
export default function AccessPanel() {
  const [st, setSt] = useState<Status | null>(null);
  const [proxyUrl, setProxyUrl] = useState("");
  const [domains, setDomains] = useState("");
  const [enabled, setEnabled] = useState(true);
  const [ovUrl, setOvUrl] = useState("");
  const [ovUser, setOvUser] = useState("");
  const [ovPass, setOvPass] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const apply = (s: Status) => {
    setSt(s);
    setDomains(s.proxy.domains.join(", "));
    setEnabled(s.proxy.enabled);
    setOvUrl(s.ov.exportUrl);
    setOvUser(s.ov.user);
  };
  useEffect(() => {
    fetch("/api/admin/access").then((r) => r.json()).then(apply).catch(() => {});
  }, []);

  async function save(body: object, okText: string) {
    setBusy(true);
    setMsg(null);
    try {
      const r = await fetch("/api/admin/access", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error);
      apply(j);
      setProxyUrl("");
      setOvPass("");
      setMsg({ ok: true, text: okText });
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  }
  async function test() {
    setBusy(true);
    setMsg(null);
    try {
      const r = await fetch("/api/admin/access/test", { method: "POST" });
      const j = await r.json();
      if (!j.diskv) throw new Error(j.error || `HTTP ${r.status}`);
      const exit = j.exitIp ? `výstupná IP ${j.exitIp}${j.exitCountry ? ` (${j.exitCountry}${j.exitOrg ? `, ${j.exitOrg}` : ""})` : ""}` : `výstupná IP neznáma${j.ipError ? ` – ${j.ipError}` : ""}`;
      const d = j.diskv.error ? `chyba ${j.diskv.error}` : `HTTP ${j.diskv.status} za ${j.diskv.ms} ms${j.diskv.title ? ` („${j.diskv.title}“)` : ""}`;
      setMsg({
        ok: j.ok,
        text: j.ok
          ? `Proxy funguje – ${exit}; Register diskvalifikácií odpovedá: ${d}. Pri ďalšom preverení sa overí automaticky.`
          : `Proxy ${j.proxy}: ${exit}; Register diskvalifikácií: ${d}${j.diskv.blocked ? " – stále blokované, skúste proxy so slovenskou rezidenčnou IP adresou" : ""}.`,
      });
    } catch (e) {
      setMsg({ ok: false, text: `Test zlyhal: ${(e as Error).message}` });
    } finally {
      setBusy(false);
    }
  }

  if (!st) return null;
  return (
    <section className="card">
      <h2>Prístupy k registrom</h2>
      <p className="hint" style={{ marginTop: 0 }}>
        Čo môžete nastaviť tu, aby sa zvyšné registre overovali automaticky (bez manuálneho kroku aj bez AI). Heslá sa ukladajú šifrovane a znova sa nezobrazia;
        hodnoty v premenných prostredia na Verceli majú prednosť.
      </p>

      <table className="mini" style={{ width: "100%", fontSize: 13, borderCollapse: "collapse", margin: "6px 0 14px" }}>
        <thead>
          <tr style={{ textAlign: "left" }}><th>Register</th><th>Prečo nie je automatický</th><th>Čo pomôže</th></tr>
        </thead>
        <tbody>
          <tr><td>Register diskvalifikácií</td><td>justice.gov.sk vracia 403 adresám dátových centier (Vercel aj Edge)</td><td><b>Proxy nižšie</b> – ideálne so slovenskou rezidenčnou IP</td></tr>
          <tr><td>Obchodný vestník</td><td>overuje sa skriptom cez prehliadač (vyhľadanie podľa IČO)</td><td>Rýchlejšie a úplnejšie: <b>export od MS SR</b> nižšie (po registrácii)</td></tr>
          <tr><td>CRE – exekúcie</td><td>spoplatnený register, prístup len po registrácii a s certifikátom</td><td>registrácia na cre.sk (Slovenská komora exekútorov) – potom napojíme</td></tr>
          <tr><td>Dôvera – dlžníci</td><td>podmienky zoznamu zakazujú automatizované overovanie</td><td>len manuálne, alebo písomný súhlas / API od Dôvery</td></tr>
        </tbody>
      </table>

      <h3 style={{ margin: "8px 0 4px" }}>Proxy pre blokované registre</h3>
      <p>
        Stav:{" "}
        {st.proxy.active ? (
          <span className="pill s-ok">Aktívna · {st.proxy.server} · {st.proxy.domains.join(", ")}{st.proxy.origin === "env" ? " · z premenných prostredia" : ""}</span>
        ) : st.proxy.origin ? (
          <span className="pill s-manual">Vypnutá</span>
        ) : (
          <span className="pill s-manual">Nenastavená</span>
        )}
      </p>
      {st.proxy.envLocked ? (
        <p className="hint">Proxy je v premenných prostredia (REGISTRY_PROXY_URL, REGISTRY_PROXY_DOMAINS) – zmeny robte tam.</p>
      ) : (
        <>
          <div className="contact-grid">
            <div className="field">
              <label htmlFor="px-url">Adresa proxy{st.proxy.origin === "admin" ? ` (uložená ${st.proxy.server} – vyplňte len pri zmene)` : ""}</label>
              <input id="px-url" type="password" autoComplete="off" value={proxyUrl} onChange={(e) => setProxyUrl(e.target.value)} placeholder="http://meno:heslo@host:port" />
            </div>
            <div className="field">
              <label htmlFor="px-d">Domény cez proxy (ostatné idú priamo)</label>
              <input id="px-d" value={domains} onChange={(e) => setDomains(e.target.value)} placeholder="justice.gov.sk" />
            </div>
          </div>
          <label className="check-row"><input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} /><span>Používať proxy</span></label>
          <div className="toolbar">
            <button className="btn" disabled={busy} onClick={() => save({ proxy: { url: proxyUrl, domains, enabled } }, "Proxy uložená.")}>Uložiť proxy</button>
            <button className="btn ghost" disabled={busy || !st.proxy.active} onClick={test}>Otestovať proxy</button>
            {st.proxy.origin === "admin" && <button className="btn ghost" disabled={busy} onClick={() => confirm("Zmazať uloženú proxy?") && save({ proxy: { clear: true } }, "Proxy zmazaná.")}>Zmazať</button>}
          </div>
        </>
      )}
      <p className="hint">
        Kde ju získať: poskytovateľ rezidenčných proxy s výberom krajiny Slovensko (platí sa zvyčajne podľa prenesených dát – jedno overenie je zlomok MB),
        alebo malý virtuálny server u slovenského hostingu so službou proxy. „Otestovať proxy“ ukáže výstupnú IP a krajinu a skúsi Register diskvalifikácií –
        ak vráti 403 aj cez proxy, register blokuje aj danú sieť a treba rezidenčnú IP.
      </p>

      <h3 style={{ margin: "16px 0 4px" }}>Export Obchodného vestníka (MS SR)</h3>
      <p>
        Stav:{" "}
        {st.ov.configured ? (
          <span className="pill s-ok">Nastavený{st.ov.origin === "env" ? " · z premenných prostredia" : ""} · denný import 04:40</span>
        ) : (
          <span className="pill s-manual">Nenastavený – Obchodný vestník sa overuje skriptom cez prehliadač</span>
        )}
      </p>
      {st.ov.envLocked ? (
        <p className="hint">Prístup je v premenných prostredia (OV_EXPORT_URL, OV_USER, OV_PASSWORD) – zmeny robte tam.</p>
      ) : (
        <>
          <div className="contact-grid">
            <div className="field">
              <label htmlFor="ov-u">Adresa exportu (s {"{date}"} alebo {"{yyyymmdd}"})</label>
              <input id="ov-u" value={ovUrl} onChange={(e) => setOvUrl(e.target.value)} placeholder="https://…/export/{date}.xml" />
            </div>
            <div className="field">
              <label htmlFor="ov-n">Prihlasovacie meno</label>
              <input id="ov-n" autoComplete="off" value={ovUser} onChange={(e) => setOvUser(e.target.value)} />
            </div>
            <div className="field">
              <label htmlFor="ov-p">Heslo{st.ov.hasPassword ? " (uložené – vyplňte len pri zmene)" : ""}</label>
              <input id="ov-p" type="password" autoComplete="new-password" value={ovPass} onChange={(e) => setOvPass(e.target.value)} />
            </div>
          </div>
          <div className="toolbar">
            <button className="btn" disabled={busy} onClick={() => save({ ov: { exportUrl: ovUrl, user: ovUser, password: ovPass } }, "Prístup k Obchodnému vestníku uložený – import prebehne v noci, alebo ho spustite v sekcii Obchodný vestník.")}>Uložiť prístup</button>
            {st.ov.origin === "admin" && <button className="btn ghost" disabled={busy} onClick={() => confirm("Zmazať prístup k exportu?") && save({ ov: { clear: true } }, "Prístup zmazaný.")}>Zmazať</button>}
          </div>
        </>
      )}
      {msg && <div className={msg.ok ? "okmsg" : "err"}>{msg.text}</div>}
    </section>
  );
}
