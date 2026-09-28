"use client";

import { useCallback, useEffect, useState } from "react";
import Header, { useMe } from "../components/Header";
import AiSettings from "../components/AiSettings";

interface U {
  email: string;
  name?: string;
  mode: "firma" | "advokat";
  role: "admin" | "user";
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
  const [users, setUsers] = useState<U[]>([]);
  const [emails, setEmails] = useState("");
  const [role, setRole] = useState<"user" | "admin">("user");
  const [mode, setMode] = useState<"firma" | "advokat">("firma");
  const [added, setAdded] = useState<AddResult[] | null>(null);
  const [codeFor, setCodeFor] = useState<{ email: string; code: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [events, setEvents] = useState<Ev[]>([]);
  const [type, setType] = useState("scan");
  const [q, setQ] = useState("");

  const loginUrl = typeof location !== "undefined" ? `${location.origin}/login?mode=code` : "/login?mode=code";

  const loadUsers = useCallback(() => api("/api/admin/users").then(setUsers).catch((e) => setError(e.message)), []);
  const loadLog = useCallback(
    () => api(`/api/admin/log?limit=500${type ? `&type=${type}` : ""}${q ? `&q=${encodeURIComponent(q)}` : ""}`).then(setEvents).catch((e) => setError(e.message)),
    [type, q],
  );
  useEffect(() => { loadUsers(); }, [loadUsers]);
  useEffect(() => { const t = setTimeout(loadLog, 250); return () => clearTimeout(t); }, [loadLog]);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      const j = await api("/api/admin/users", "POST", { emails, role, mode });
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
          <h1>Administrácia</h1>
          <p>Pridávajte používateľov podľa e-mailu. Každý dostane jednorazový kód (platný 7 dní), ktorým si pri prvom prihlásení nastaví heslo. Verzia <b>Firma</b> je určená pre zamestnancov spoločnosti, verzia <b>Advokát</b> navyše ponúkne manuálne overenie neverejných registrov.</p>
        </section>
        {error && <div className="err">{error}</div>}

        <div className="grid2">
          <section className="card">
            <h2>Pridať používateľov</h2>
            <form onSubmit={add}>
              <div className="field">
                <label htmlFor="em">E-mailové adresy – oddelené čiarkou, bodkočiarkou alebo novým riadkom</label>
                <textarea id="em" rows={5} placeholder={"jana.novakova@kancelaria.sk\npeter.horvath@kancelaria.sk"} value={emails} onChange={(e) => setEmails(e.target.value)} />
              </div>
              <div className="toolbar" style={{ marginTop: 0 }}>
                <select value={role} onChange={(e) => setRole(e.target.value as any)} className="field" style={{ margin: 0, width: "auto", padding: "10px 12px", border: "1px solid var(--line)", borderRadius: 8, background: "var(--surface)", color: "var(--ink)" }}>
                  <option value="user">Rola: používateľ</option>
                  <option value="admin">Rola: administrátor</option>
                </select>
                <select value={mode} onChange={(e) => setMode(e.target.value as any)} style={{ margin: 0, width: "auto", padding: "10px 12px", border: "1px solid var(--line)", borderRadius: 8, background: "var(--surface)", color: "var(--ink)" }} title="Verzia rozhrania">
                  <option value="firma">Verzia: Firma</option>
                  <option value="advokat">Verzia: Advokát (manuálne overenia)</option>
                </select>
                <button className="btn" disabled={!emails.trim()}>Pridať</button>
              </div>
            </form>
          </section>
          <section className="card">
            <h2>Ako to funguje</h2>
            <ol style={{ margin: 0, paddingLeft: 18, fontSize: 14 }}>
              <li>Vložte zoznam e-mailov a kliknite na Pridať.</li>
              <li>Kódy odovzdajte kolegom (telefonicky, osobne alebo e-mailom). Zobrazia sa iba raz.</li>
              <li>Kolega otvorí stránku prihlásenia, zvolí „Prvé prihlásenie“ a nastaví si heslo.</li>
              <li>Pri zabudnutom hesle kliknite na „Nový kód“.</li>
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
          <h2>Používatelia ({users.length})</h2>
          <div className="tbl-wrap">
            <table className="tbl">
              <thead>
                <tr><th>Používateľ</th><th>Rola / verzia</th><th>Stav</th><th>Posledné prihlásenie</th><th>Pridal</th><th></th></tr>
              </thead>
              <tbody>
                {users.map((u) => {
                  const self = me?.email === u.email;
                  return (
                    <tr key={u.email}>
                      <td>
                        {u.name && <div style={{ fontWeight: 600 }}>{u.name}</div>}
                        {u.email}{self && <span className="src"> (vy)</span>}
                        <div><button className="linkbtn src" onClick={() => { const n = prompt(`Meno pre ${u.email}`, u.name || ""); if (n !== null) act(u.email, "name", { name: n }); }}>{u.name ? "upraviť meno" : "doplniť meno"}</button></div>
                      </td>
                      <td>
                        {u.role === "admin" ? "Administrátor" : "Používateľ"}
                        <div>
                          <select value={u.mode} onChange={(e) => act(u.email, "mode", { mode: e.target.value })} style={{ font: "inherit", fontSize: 13, padding: "2px 6px", border: "1px solid var(--line)", borderRadius: 6, background: "var(--surface)", color: "var(--ink)", marginTop: 4 }}>
                            <option value="firma">Firma</option>
                            <option value="advokat">Advokát</option>
                          </select>
                        </div>
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
                          {!self && (
                            <>
                              <button className="mbtn" onClick={() => act(u.email, "role", { role: u.role === "admin" ? "user" : "admin" })}>
                                {u.role === "admin" ? "Odobrať admina" : "Urobiť adminom"}
                              </button>
                              <button className="mbtn" onClick={() => act(u.email, u.status === "disabled" ? "enable" : "disable")}>
                                {u.status === "disabled" ? "Odblokovať" : "Zablokovať"}
                              </button>
                              <button className="mbtn" style={{ color: "var(--crit)" }} onClick={() => act(u.email, "delete")}>Zmazať</button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>

        <AiSettings />

        <section className="card">
          <h2>Protokol činností</h2>
          <div className="filters">
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
            <a className="btn ghost" style={{ padding: "6px 14px", textDecoration: "none" }} href={`/api/admin/log?format=csv&limit=5000${type ? `&type=${type}` : ""}${q ? `&q=${encodeURIComponent(q)}` : ""}`}>
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
                        <><a href={`/?ico=${e.ico}`}>{e.ico}</a> {e.company} · zdroj {e.target} · {e.detail}</>
                      ) : e.type === "contact_saved" ? (
                        <><a href={`/?ico=${e.ico}`}>{e.ico}</a> {e.detail}</>
                      ) : e.type === "scan" ? (
                        <>
                          <a href={`/?ico=${e.ico}`}>{e.ico}</a> {e.company}{" "}
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
