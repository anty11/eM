"use client";

import { useEffect, useState } from "react";
import Header from "../components/Header";

type Mode = "login" | "code";

export default function LoginPage() {
  const [mode, setMode] = useState<Mode>("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [password2, setPassword2] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const p = new URLSearchParams(location.search);
    if (p.get("email")) setEmail(p.get("email")!);
    if (p.get("mode") === "code") setMode("code");
  }, []);

  function next() {
    const n = new URLSearchParams(location.search).get("next");
    location.href = n && n.startsWith("/") && !n.startsWith("//") ? n : "/app";
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (mode === "code" && password !== password2) return setError("Heslá sa nezhodujú.");
    setBusy(true);
    try {
      const r = await fetch(mode === "login" ? "/api/auth/login" : "/api/auth/setup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(mode === "login" ? { email, password } : { email, code, password }),
      });
      const j = await r.json().catch(() => ({}));
      if (r.status === 409) {
        setMode("code");
        setPassword("");
        throw new Error(j.error);
      }
      if (!r.ok) throw new Error(j.error || `Chyba ${r.status}`);
      next();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Header />
      <main className="wrap">
        <div className="auth card">
          <h1>{mode === "login" ? "Prihlásenie" : "Nastavenie hesla"}</h1>
          <p className="lead">
            {mode === "login"
              ? "Prístup majú len používatelia pridaní administrátorom."
              : "Zadajte jednorazový kód, ktorý ste dostali od administrátora, a zvoľte si heslo."}
          </p>
          <div className="tabs" role="tablist">
            <button type="button" className={mode === "login" ? "on" : ""} onClick={() => { setMode("login"); setError(null); }}>Prihlásenie</button>
            <button type="button" className={mode === "code" ? "on" : ""} onClick={() => { setMode("code"); setError(null); }}>Prvé prihlásenie / nový kód</button>
          </div>
          <form onSubmit={submit}>
            <div className="field">
              <label htmlFor="email">E-mail</label>
              <input id="email" type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} autoFocus />
            </div>
            {mode === "code" && (
              <div className="field">
                <label htmlFor="code">Jednorazový kód</label>
                <input id="code" autoComplete="one-time-code" required placeholder="XXXX-XXXX-XXXX" value={code} onChange={(e) => setCode(e.target.value)} style={{ letterSpacing: "0.08em" }} />
              </div>
            )}
            <div className="field">
              <label htmlFor="pw">{mode === "login" ? "Heslo" : "Nové heslo (aspoň 10 znakov)"}</label>
              <input id="pw" type="password" autoComplete={mode === "login" ? "current-password" : "new-password"} required minLength={mode === "code" ? 10 : undefined} value={password} onChange={(e) => setPassword(e.target.value)} />
            </div>
            {mode === "code" && (
              <div className="field">
                <label htmlFor="pw2">Nové heslo znova</label>
                <input id="pw2" type="password" autoComplete="new-password" required value={password2} onChange={(e) => setPassword2(e.target.value)} />
              </div>
            )}
            <button className="btn" style={{ width: "100%" }} disabled={busy}>
              {busy ? "Prihlasujem…" : mode === "login" ? "Prihlásiť sa" : "Nastaviť heslo a prihlásiť"}
            </button>
            {error && <div className="err">{error}</div>}
          </form>
          {mode === "login" && (
            <p className="hint">Zabudli ste heslo? Požiadajte administrátora o nový jednorazový kód.</p>
          )}
        </div>
        <p className="hint" style={{ textAlign: "center", marginTop: 18 }}>
          Máte v ruke protokol o preverení a chcete overiť jeho pravosť? <a href="/overit">Overiť protokol →</a>
        </p>
      </main>
    </>
  );
}
