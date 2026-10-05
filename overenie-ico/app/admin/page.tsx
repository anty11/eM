"use client";

import { useCallback, useEffect, useState } from "react";
import Header, { useMe } from "../components/Header";
import AccessPanel from "../components/AccessPanel";
import AiLogPanel from "../components/AiLogPanel";
import AiSettings from "../components/AiSettings";
import DiagPanel from "../components/DiagPanel";
import OrdersPanel from "../components/OrdersPanel";
import OrgsPanel, { type OrgPrefill, type OrgRow } from "../components/OrgsPanel";
import { selectedOrg, setSelectedOrg } from "../components/org";
import type { Order } from "@/lib/orders";

interface U {
  email: string;
  name?: string;
  mode: "firma" | "advokat";
  role: "admin" | "user";
  orgId?: string;
  orgName?: string;
  status: "active" | "invited" | "disabled";
  createdAt: string;
  createdBy: string;
  lastLoginAt?: string;
  inviteExpires?: string;
}
interface AddResult {
  email: string;
  result: "created" | "exists" | "invalid";
  code?: string;
}
interface Ev {
  at: string;
  type: string;
  by: string;
  target?: string;
  detail?: string;
  ico?: string;
  company?: string;
  verdict?: string;
  score?: number;
  scanId?: string;
}

const STATUS = { active: "Aktívny", invited: "Čaká na nastavenie hesla", disabled: "Zablokovaný" };
const VERDICT: Record<string, string> = { recommended: "Odporúčame", caution: "S výhradou", not_recommended: "Neodporúčame" };
const VCLASS: Record<string, string> = { recommended: "s-ok", caution: "s-warning", not_recommended: "s-critical" };
const TYPE: Record<string, string> = {
  scan: "Preverenie",
  login: "Prihlásenie",
  login_failed: "Neúspešné prihlásenie",
  password_set: "Nastavenie hesla",
  password_changed: "Zmena hesla",
  user_added: "Pridaný používateľ",
  user_reset: "Reset hesla",
  user_disabled: "Zablokovanie",
  user_enabled: "Odblokovanie",
  user_deleted: "Zmazanie",
  role_changed: "Zmena roly",
  mode_changed: "Zmena verzie",
  contact_saved: "Úprava kontaktu partnera",
  ai_settings: "Nastavenia AI",
  ai_check: "AI overenie",
  company_removed: "Odstránenie z databázy preverení",
  protocol_sealed: "Pečať protokolu",
  order: "Objednávka",
  order_status: "Stav objednávky",
  org_created: "Založenie firmy",
  org_updated: "Úprava firmy",
};
const dt = (s?: string) => (s ? new Date(s).toLocaleString("sk-SK", { dateStyle: "short", timeStyle: "short" }) : "–");

async function api(url: string, method = "GET", body?: unknown) {
  const r = await fetch(url, { method, headers: body ? { "Content-Type": "application/json" } : undefined, body: body ? JSON.stringify(body) : undefined });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || `Chyba ${r.status}`);
  return j;
}

export default function AdminPage() {
  const me = useMe();
  const [org, setOrg] = useState("");
  const [orgs, setOrgs] = useState<OrgRow[]>([]);
  const [users, setUsers] = useState<U[]>([]);
  const [admins, setAdmins] = useState<U[]>([]);
  const [emails, setEmails] = useState("");
  const [added, setAdded] = useState<AddResult[] | null>(null);
  const [codeFor, setCodeFor] = useState<{ email: string; code: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [events, setEvents] = useState<Ev[]>([]);
  const [type, setType] = useState("scan");
  const [q, setQ] = useState("");
  const [logOrg, setLogOrg] = useState<string>("");
  const [prefill, setPrefill] = useState<OrgPrefill | null>(null);

  useEffect(() => { const o = selectedOrg(); setOrg(o); setLogOrg(o); }, []);
  const chooseOrg = (id: string) => { setSelectedOrg(id); setOrg(id); setLogOrg(id); };
  const current = orgs.find((o) => o.id === org);

  const loginUrl = typeof location !== "undefined" ? `${location.origin}/login?mode=code` : "/login?mode=code";

  const loadOrgs = useCallback(() => api("/api/admin/orgs").then(setOrgs).catch((e) => setError(e.message)), []);
  const loadUsers = useCallback(() => {
    api("/api/admin/users").then((all: U[]) => setAdmins(all.filter((u) => u.role === "admin"))).catch((e) => setError(e.message));
    if (org) api(`/api/admin/users?org=${encodeURIComponent(org)}`).then(setUsers).catch((e) => setError(e.message));
    else setUsers([]);
  }, [org]);
  const loadLog = useCallback(
    () => api(`/api/admin/log?limit=500${logOrg ? `&org=${encodeURIComponent(logOrg)}` : ""}${type ? `&type=${type}` : ""}${q ? `&q=${encodeURIComponent(q)}` : ""}`).then(setEvents).catch((e) => setError(e.message)),
    [type, q, logOrg],
  );
  useEffect(() => { loadOrgs(); }, [loadOrgs]);
  useEffect(() => { loadUsers(); }, [loadUsers]);
  useEffect(() => { const t = setTimeout(loadLog, 250); return () => clearTimeout(t); }, [loadLog]);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      const j = await api("/api/admin/users", "POST", { emails, org });
      setAdded(j.results);
      setEmails("");
      loadUsers();
      loadLog();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function act(email: string, action: string, extra: object = {}) {
    setError(null);
    if (action === "delete" && !confirm(`Naozaj zmazať používateľa ${email}?`)) return;
    if (action === "reset" && !confirm(`Vygenerovať nový kód pre ${email}? Súčasné heslo prestane platiť.`)) return;
    try {
      const j = await api("/api/admin/users", "PATCH", { email, action, ...extra });
      if (action === "reset") setCodeFor({ email, code: j.code });
      loadUsers();
      loadOrgs();
      loadLog();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  const inviteText = (list: { email: string; code?: string }[]) =>
    list
      .filter((x) => x.code)
      .map((x) => `${x.email}\nKód: ${x.code}\nPrihlásenie: ${loginUrl}&email=${encodeURIComponent(x.email)}\n`)
      .join("\n");

  const copy = (t: string) => navigator.clipboard?.writeText(t);

  return (
    <>
      <Header me={me} active="admin" />
      <main className="wrap">
        <section className="hero" style={{ paddingBottom: 0 }}>
          <h1>Administrácia platformy</h1>
          <p>Založte firmu (klienta) s balíkom a počtom miest, potom jej pridajte poverených zamestnancov podľa e-mailu. Každý dostane jednorazový kód (platný 7 dní), ktorým si pri prvom prihlásení nastaví heslo. Balík <b>Štandard</b> preveruje verejné registre, <b>Rozšírené</b> navyše ponúka manuálne overenie neverejných registrov a spätné preverenie existujúcej spolupráce. Správcovia platformy vznikajú výlučne cez premennú <code>ADMIN_EMAILS</code>.</p>
        </section>
        {error && <div className="err">{error}</div>}

        <OrgsPanel selected={org} onSelect={chooseOrg} prefill={prefill} onPrefillUsed={() => setPrefill(null)} onChanged={loadOrgs} />

        <div className="grid2">
          <section className="card">
            <h2>Pridať používateľov{current ? ` – ${current.name}` : ""}</h2>
            {!org ? (
              <p className="hint">Najprv zvoľte firmu v zozname vyššie (alebo v hornej lište).</p>
            ) : (
              <form onSubmit={add}>
                <p className="hint" style={{ marginTop: 0 }}>Obsadené miesta: <b>{current?.used ?? "…"}</b> z {current?.seats ?? "…"} · balík {current?.mode === "advokat" ? "Rozšírené" : "Štandard"}.</p>
                <div className="field">
                  <label htmlFor="em">E-mailové adresy – oddelené čiarkou, bodkočiarkou alebo novým riadkom</label>
                  <textarea id="em" rows={5} placeholder={"jana.novakova@firma.sk\npeter.horvath@firma.sk"} value={emails} onChange={(e) => setEmails(e.target.value)} />
                </div>
                <div className="toolbar" style={{ marginTop: 0 }}>
                  <button className="btn" disabled={!emails.trim()}>Pridať do firmy</button>
                </div>
              </form>
            )}
          </section>
          <section className="card">
            <h2>Ako to funguje</h2>
            <ol style={{ margin: 0, paddingLeft: 18, fontSize: 14 }}>
              <li>Po podpise zmluvy založte firmu (z objednávky tlačidlom „Založiť firmu“) s balíkom a počtom miest.</li>
              <li>Zvoľte firmu, vložte e-maily jej poverených zamestnancov a kliknite na Pridať.</li>
              <li>Kódy odovzdajte klientovi (telefonicky alebo e-mailom). Zobrazia sa iba raz.</li>
              <li>Zamestnanec otvorí prihlásenie, zvolí „Prvé prihlásenie“ a nastaví si heslo. Pri zabudnutom hesle kliknite na „Nový kód“.</li>
            </ol>
          </section>
        </div>

        {(added || codeFor) && (
          <section className="card" style={{ borderColor: "var(--info)" }}>
            <h2>Jednorazové kódy – skopírujte si ich teraz, znova sa nezobrazia</h2>
            <div className="tbl-wrap">
              <table className="tbl">
                <thead><tr><th>E-mail</th><th>Výsledok</th><th>Kód</th></tr></thead>
                <tbody>
                  {(codeFor ? [{ email: codeFor.email, result: "created" as const, code: codeFor.code }] : added!).map((a) => (
                    <tr key={a.email}>
                      <td>{a.email}</td>
                      <td>{a.result === "created" ? (codeFor ? "Nový kód" : "Pridaný") : a.result === "exists" ? "Už existuje" : "Neplatná adresa"}</td>
                      <td>{a.code ? <span className="code">{a.code}</span> : "–"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="toolbar">
              <button className="btn" onClick={() => copy(inviteText(codeFor ? [codeFor] : added!))}>Kopírovať pozvánky</button>
              <button className="btn ghost" onClick={() => { setAdded(null); setCodeFor(null); }}>Zavrieť</button>
            </div>
          </section>
        )}

        <section className="card">
          <h2>Používatelia{current ? ` – ${current.name}` : ""} ({users.length})</h2>
          {!org && <p className="hint">Zvoľte firmu, aby sa zobrazili jej používatelia.</p>}
          {org && (
          <div className="tbl-wrap">
            <table className="tbl">
              <thead>
                <tr><th>Používateľ</th><th>Stav</th><th>Posledné prihlásenie</th><th>Pridal</th><th></th></tr>
              </thead>
              <tbody>
                {users.map((u) => (
                  <tr key={u.email}>
                    <td>
                      {u.name && <div style={{ fontWeight: 600 }}>{u.name}</div>}
                      {u.email}
                      <div><button className="linkbtn src" onClick={() => { const n = prompt(`Meno pre ${u.email}`, u.name || ""); if (n !== null) act(u.email, "name", { name: n }); }}>{u.name ? "upraviť meno" : "doplniť meno"}</button></div>
                    </td>
                    <td>
                      <span className={`pill ${u.status === "active" ? "s-ok" : u.status === "invited" ? "s-manual" : "s-critical"}`}>{STATUS[u.status]}</span>
                      {u.status === "invited" && u.inviteExpires && <div className="src">kód platí do {dt(u.inviteExpires)}</div>}
                    </td>
                    <td>{dt(u.lastLoginAt)}</td>
                    <td className="src">{u.createdBy}<br />{dt(u.createdAt)}</td>
                    <td>
                      <div className="row-actions">
                        <button className="mbtn" onClick={() => act(u.email, "reset")}>Nový kód</button>
                        <button className="mbtn" onClick={() => act(u.email, u.status === "disabled" ? "enable" : "disable")}>
                          {u.status === "disabled" ? "Odblokovať" : "Zablokovať"}
                        </button>
                        <button className="mbtn" style={{ color: "var(--crit)" }} onClick={() => act(u.email, "delete")}>Zmazať</button>
                      </div>
                    </td>
                  </tr>
                ))}
                {!users.length && <tr><td colSpan={5} className="src">Firma zatiaľ nemá používateľov.</td></tr>}
              </tbody>
            </table>
          </div>
          )}
        </section>

        <section className="card">
          <h2>Správcovia platformy ({admins.length})</h2>
          <p className="hint" style={{ marginTop: 0 }}>Účty prevádzkovateľa. Vznikajú a rušia sa výlučne cez premennú prostredia <code>ADMIN_EMAILS</code> (prvé prihlásenie kódom <code>ADMIN_SETUP_CODE</code>); nedajú sa objednať ani vytvoriť v aplikácii.</p>
          <div className="tbl-wrap">
            <table className="tbl">
              <thead><tr><th>Správca</th><th>Stav</th><th>Posledné prihlásenie</th><th></th></tr></thead>
              <tbody>
                {admins.map((u) => (
                  <tr key={u.email}>
                    <td>{u.name && <div style={{ fontWeight: 600 }}>{u.name}</div>}{u.email}{me?.email === u.email && <span className="src"> (vy)</span>}
                      <div><button className="linkbtn src" onClick={() => { const n = prompt(`Meno pre ${u.email}`, u.name || ""); if (n !== null) act(u.email, "name", { name: n }); }}>{u.name ? "upraviť meno" : "doplniť meno"}</button></div>
                    </td>
                    <td><span className={`pill ${u.status === "active" ? "s-ok" : "s-manual"}`}>{STATUS[u.status]}</span></td>
                    <td>{dt(u.lastLoginAt)}</td>
                    <td><div className="row-actions"><button className="mbtn" onClick={() => act(u.email, "reset")}>Nový kód</button></div></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <OrdersPanel onCreateOrg={(o: Order) => setPrefill({ name: o.company, ico: o.ico, mode: o.plan === "rozsirene" ? "advokat" : "firma", seats: o.users, orderId: o.id })} />

        <AiSettings />
        <AccessPanel />

        <DiagPanel />
        <AiLogPanel />

        <section className="card">
          <h2>Protokol činností</h2>
          <div className="filters">
            <select value={logOrg} onChange={(e) => setLogOrg(e.target.value)} title="Firma">
              <option value="">Platforma (správcovia, objednávky)</option>
              {orgs.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
            </select>
            <select value={type} onChange={(e) => setType(e.target.value)}>
              <option value="scan">Preverenia</option>
              <option value="">Všetko</option>
              <option value="login">Prihlásenia</option>
              <option value="login_failed">Neúspešné prihlásenia</option>
              <option value="admin">Správa používateľov</option>
              <option value="contact_saved">Kontakty partnerov</option>
              <option value="ai_check">AI overenia</option>
            </select>
            <input placeholder="Hľadať (IČO, e-mail, firma…)" value={q} onChange={(e) => setQ(e.target.value)} />
            <a className="btn ghost" style={{ padding: "6px 14px", textDecoration: "none" }} href={`/api/admin/log?format=csv&limit=5000${logOrg ? `&org=${encodeURIComponent(logOrg)}` : ""}${type ? `&type=${type}` : ""}${q ? `&q=${encodeURIComponent(q)}` : ""}`}>
              Export CSV
            </a>
          </div>
          <div className="tbl-wrap">
            <table className="tbl">
              <thead>
                <tr><th>Čas</th><th>Používateľ</th><th>Udalosť</th><th>Detail</th></tr>
              </thead>
              <tbody>
                {events.map((e, i) => (
                  <tr key={i}>
                    <td style={{ whiteSpace: "nowrap" }}>{dt(e.at)}</td>
                    <td>{e.by}</td>
                    <td>{TYPE[e.type] || e.type}</td>
                    <td>
                      {e.type === "ai_check" ? (
                        <><a href={`/app?ico=${e.ico}`}>{e.ico}</a> {e.company} · zdroj {e.target} · {e.detail}</>
                      ) : e.type === "contact_saved" ? (
                        <><a href={`/app?ico=${e.ico}`}>{e.ico}</a> {e.detail}</>
                      ) : e.type === "scan" ? (
                        <>
                          <a href={`/app?ico=${e.ico}`}>{e.ico}</a> {e.company}{" "}
                          {e.verdict && <span className={`pill ${VCLASS[e.verdict]}`}>{VERDICT[e.verdict]} · {e.score}</span>}
                          <div className="src">{e.scanId}</div>
                        </>
                      ) : (
                        [e.target, e.detail].filter(Boolean).join(" · ")
                      )}
                    </td>
                  </tr>
                ))}
                {!events.length && <tr><td colSpan={4} className="src">Žiadne záznamy.</td></tr>}
              </tbody>
            </table>
          </div>
        </section>
      </main>
    </>
  );
}
