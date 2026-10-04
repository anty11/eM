"use client";

import { useEffect, useState } from "react";
import { OPERATOR, SiteFooter, SiteHeader } from "../components/site/SiteShell";
import { CompareTable } from "../components/site/content";

type Plan = "standard" | "rozsirene";

export default function OrderPage() {
  const [plan, setPlan] = useState<Plan>("rozsirene");
  const [f, setF] = useState({ company: "", ico: "", contactName: "", email: "", phone: "", users: "3", message: "", consent: false, website: "" });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [done, setDone] = useState<string | null>(null);

  useEffect(() => {
    const p = new URLSearchParams(location.search).get("plan");
    if (p === "rozsirene" || p === "standard") setPlan(p);
  }, []);

  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
    setF((s) => ({ ...s, [k]: e.target.type === "checkbox" ? (e.target as HTMLInputElement).checked : e.target.value }));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr("");
    setBusy(true);
    try {
      const r = await fetch("/api/order", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...f, plan }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || `Chyba ${r.status}`);
      setDone(j.id);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="site">
      <SiteHeader active="order" />
      <section className="s-band">
        <div className="s-wrap s-center">
          <div className="s-head">
            <span className="s-eyebrow">Objednávka</span>
            <h1 style={{ fontSize: "clamp(28px, 3.6vw, 40px)" }}>Objednávka pre vašu spoločnosť</h1>
            <p>
              Vyplňte údaje o spoločnosti a kontaktnej osobe. Do jedného pracovného dňa vám pošleme cenovú ponuku podľa počtu poverených zamestnancov,
              zmluvu a po jej potvrdení prístupy do klientskej sekcie. Objednávka je do podpisu zmluvy nezáväzná.
            </p>
          </div>

          {done ? (
            <div className="s-form">
              <div className="s-ok-box">
                <b>Ďakujeme, objednávku sme prijali.</b> Číslo objednávky <b>{done}</b>. Na uvedený e-mail vám napíšeme do jedného pracovného dňa.
              </div>
              <p style={{ color: "var(--s-muted)", margin: 0 }}>
                Ak potrebujete niečo riešiť skôr, napíšte na <a href={`mailto:${OPERATOR.email}`}>{OPERATOR.email}</a> a uveďte číslo objednávky.
              </p>
              <div><a className="s-btn ghost" href="/">Späť na úvod</a></div>
            </div>
          ) : (
            <form className="s-form" onSubmit={submit}>
              <div>
                <label style={{ marginBottom: 8 }}>Verzia</label>
                <div className="s-plan-pick">
                  <label className={plan === "rozsirene" ? "on" : ""}>
                    <input type="radio" name="plan" checked={plan === "rozsirene"} onChange={() => setPlan("rozsirene")} style={{ display: "none" }} />
                    <b>Rozšírené</b>
                    <small>+ neverejné registre, spätné preverenie existujúcej spolupráce, školenie, komunikácia s advokátom obratom</small>
                  </label>
                  <label className={plan === "standard" ? "on" : ""}>
                    <input type="radio" name="plan" checked={plan === "standard"} onChange={() => setPlan("standard")} style={{ display: "none" }} />
                    <b>Štandard</b>
                    <small>verejné registre, indikátory rizika, protokol s pečaťou, databáza preverení</small>
                  </label>
                </div>
                <p style={{ margin: "8px 0 0", fontSize: 13, color: "var(--s-muted)" }}><a href="#porovnanie">Úplné porovnanie verzií ↓</a></p>
              </div>
              <div className="row">
                <label>Spoločnosť (objednávateľ)<input required value={f.company} onChange={set("company")} placeholder="Názov podľa obchodného registra" /></label>
                <label>IČO<input inputMode="numeric" value={f.ico} onChange={set("ico")} placeholder="8 číslic" /></label>
              </div>
              <div className="row">
                <label>Kontaktná osoba<input required value={f.contactName} onChange={set("contactName")} placeholder="Meno a priezvisko" /></label>
                <label>Počet poverených zamestnancov (používateľov)
                  <select value={f.users} onChange={set("users")}>
                    {["1", "2", "3", "5", "10", "20", "50"].map((n) => <option key={n} value={n}>{n} {n === "1" ? "používateľ" : +n < 5 ? "používatelia" : "používateľov"}</option>)}
                  </select>
                </label>
              </div>
              <div className="row">
                <label>E-mail<input required type="email" value={f.email} onChange={set("email")} placeholder="meno@firma.sk" /></label>
                <label>Telefón<input type="tel" value={f.phone} onChange={set("phone")} placeholder="+421 …" /></label>
              </div>
              <label>Poznámka (nepovinné)<textarea value={f.message} onChange={set("message")} placeholder="Napr. odvetvie, počet dodávateľov, požiadavky na školenie…" /></label>
              <input className="hp" tabIndex={-1} autoComplete="off" value={f.website} onChange={set("website")} aria-hidden />
              <label className="check">
                <input type="checkbox" required checked={f.consent} onChange={set("consent")} />
                <span>Súhlasím so spracovaním uvedených údajov spoločnosťou {OPERATOR.name} na účel vybavenia objednávky a prípravy zmluvy.</span>
              </label>
              {err && <div className="s-err">{err}</div>}
              <div className="s-actions">
                <button className="s-btn gold" disabled={busy}>{busy ? "Odosielam…" : "Odoslať objednávku"}</button>
                <span style={{ fontSize: 13, color: "var(--s-muted)" }}>Nezáväzné do podpisu zmluvy.</span>
              </div>
            </form>
          )}
        </div>
      </section>
      {!done && (
        <section className="s-band alt" id="porovnanie">
          <div className="s-wrap s-center">
            <div className="s-head">
              <span className="s-eyebrow">Porovnanie verzií</span>
              <h2>Čo je v ktorej verzii</h2>
              <p>Obe verzie overujú rovnaké registre a dávajú rovnaký protokol. Rozšírené pridáva neverejné registre, spätné preverenie existujúcej spolupráce, školenie a komunikáciu s advokátom.</p>
            </div>
            <CompareTable />
          </div>
        </section>
      )}
      <SiteFooter />
    </div>
  );
}
