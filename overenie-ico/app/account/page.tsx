"use client";

import { useState } from "react";
import Header, { useMe } from "../components/Header";
import CompanyList from "../components/CompanyList";

export default function AccountPage() {
  const me = useMe();
  const [oldPassword, setOld] = useState("");
  const [newPassword, setNew] = useState("");
  const [newPassword2, setNew2] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (newPassword !== newPassword2) return setMsg({ ok: false, text: "Nové heslá sa nezhodujú." });
    const r = await fetch("/api/auth/password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ oldPassword, newPassword }),
    });
    const j = await r.json().catch(() => ({}));
    if (r.ok) {
      setOld(""); setNew(""); setNew2("");
      setMsg({ ok: true, text: "Heslo bolo zmenené. Ostatné prihlásenia boli odhlásené." });
    } else setMsg({ ok: false, text: j.error || "Zmena hesla zlyhala." });
  }

  return (
    <>
      <Header me={me} active="account" />
      <main className="wrap">
        <section className="hero" style={{ paddingBottom: 0 }}>
          <h1>Môj účet</h1>
          <p>{me ? `${me.name ? `${me.name} · ` : ""}${me.email} · ${me.role === "admin" ? "administrátor" : "používateľ"} · verzia ${me.mode === "advokat" ? "Rozšírené" : "Štandard"}` : "…"}</p>
        </section>

        <CompanyList me={me} />

        <div className="card" style={{ maxWidth: 480 }}>
          <h2>Zmena hesla</h2>
          <form onSubmit={submit}>
            <div className="field">
              <label htmlFor="o">Súčasné heslo</label>
              <input id="o" type="password" autoComplete="current-password" required value={oldPassword} onChange={(e) => setOld(e.target.value)} />
            </div>
            <div className="field">
              <label htmlFor="n">Nové heslo (aspoň 10 znakov)</label>
              <input id="n" type="password" autoComplete="new-password" minLength={10} required value={newPassword} onChange={(e) => setNew(e.target.value)} />
            </div>
            <div className="field">
              <label htmlFor="n2">Nové heslo znova</label>
              <input id="n2" type="password" autoComplete="new-password" required value={newPassword2} onChange={(e) => setNew2(e.target.value)} />
            </div>
            <button className="btn">Zmeniť heslo</button>
            {msg && <div className={msg.ok ? "okmsg" : "err"}>{msg.text}</div>}
          </form>
        </div>
      </main>
    </>
  );
}
