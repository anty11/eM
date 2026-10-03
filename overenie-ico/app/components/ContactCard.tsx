"use client";

import { useEffect, useState } from "react";
import type { CompanyProfile } from "@/lib/types";

interface Contact {
  active: boolean;
  personName: string;
  personRole: string;
  phone: string;
  email: string;
  isStatutory: boolean;
  identityVerified: boolean;
  owners: string[];
  note: string;
  updatedAt?: string;
  updatedBy?: string;
}

const EMPTY: Contact = { active: false, personName: "", personRole: "", phone: "", email: "", isStatutory: false, identityVerified: false, owners: [], note: "" };
const fold = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\b(ing|mgr|judr|mudr|phdr|bc|doc|prof|phd|mba|csc)\.?/g, "").replace(/[^a-z ]/g, " ").split(/\s+/).filter(Boolean).sort().join(" ");

/**
 * Kontaktná karta partnera – s kým komunikujeme, jeho telefón a e-mail a kto od nás s ním komunikuje.
 * Ukladá sa k IČO, zdieľa sa v rámci firmy a tlačí sa do protokolu.
 */
export default function ContactCard({ ico, profile, meEmail }: { ico: string; profile: CompanyProfile; meEmail?: string }) {
  const [c, setC] = useState<Contact>(EMPTY);
  const [saved, setSaved] = useState<Contact | null>(null);
  const [people, setPeople] = useState<{ email: string; name?: string }[]>([]);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setMsg(null);
    fetch(`/api/contacts?ico=${ico}`).then((r) => r.json()).then((j) => {
      const v = j && j.ico ? { ...EMPTY, ...j } : { ...EMPTY, owners: meEmail ? [meEmail] : [] };
      setC(v);
      setSaved(j && j.ico ? v : null);
    }).catch(() => {});
    fetch("/api/directory").then((r) => r.json()).then((j) => Array.isArray(j) && setPeople(j)).catch(() => {});
  }, [ico, meEmail]);

  const statutoryNames = (profile.statutory || []).map((s) => s.name);
  const match = c.personName.trim().length > 3 ? statutoryNames.find((n) => fold(n) === fold(c.personName) || fold(n).includes(fold(c.personName))) : undefined;
  const dirty = JSON.stringify({ ...c, updatedAt: 0, updatedBy: 0 }) !== JSON.stringify({ ...(saved || EMPTY), updatedAt: 0, updatedBy: 0 });
  const set = <K extends keyof Contact>(k: K, v: Contact[K]) => setC((s) => ({ ...s, [k]: v }));
  const label = (e: string) => people.find((p) => p.email === e)?.name || e;

  async function save() {
    setBusy(true);
    setMsg(null);
    try {
      const r = await fetch(`/api/contacts?ico=${ico}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(c) });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "Uloženie zlyhalo.");
      setC({ ...EMPTY, ...j });
      setSaved({ ...EMPTY, ...j });
      setMsg({ ok: true, text: "Uložené." });
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card contact">
      <h2>Komunikácia s partnerom</h2>
      <div className="print-only contact-print">
        {!c.active && !c.personName && !c.phone && !c.email && !c.note ? (
          <span>Kontakt s partnerom nebol zaznamenaný.</span>
        ) : (
          <>
            <span><b>Spolupráca:</b> {c.active ? "áno" : "nie"}</span>
            <span><b>Kontaktná osoba:</b> {[c.personName, c.personRole].filter(Boolean).join(", ") || "–"}</span>
            <span><b>Telefón:</b> {c.phone || "–"}</span>
            <span><b>E-mail:</b> {c.email || "–"}</span>
            <span><b>Štatutár v OR:</b> {c.isStatutory ? "áno" : "nie"}{match ? ` (${match} je zapísaný ako štatutár)` : c.personName.trim().length > 3 && statutoryNames.length ? " – meno nezodpovedá štatutárovi, overte plnú moc" : ""}</span>
            <span><b>Totožnosť overená:</b> {c.identityVerified ? "áno" : "nie"}</span>
            <span><b>Od nás komunikuje:</b> {c.owners.map(label).join(", ") || "–"}</span>
            {c.note && <span className="wide"><b>Poznámka:</b> {c.note}</span>}
            {saved?.updatedAt && <span className="wide src">Naposledy upravil {label(saved.updatedBy || "")} · {new Date(saved.updatedAt).toLocaleString("sk-SK", { dateStyle: "short", timeStyle: "short" })}</span>}
          </>
        )}
      </div>
      <div className="no-print">
      <label className="check-row big">
        <input type="checkbox" checked={c.active} onChange={(e) => set("active", e.target.checked)} />
        <span>S touto spoločnosťou komunikujeme / spolupracujeme</span>
      </label>

      <div className="contact-grid">
        <div className="field">
          <label htmlFor="cp-name">Kontaktná osoba u partnera</label>
          <input id="cp-name" list="stat-names" value={c.personName} onChange={(e) => set("personName", e.target.value)} placeholder="Meno a priezvisko" />
          <datalist id="stat-names">{statutoryNames.map((n) => <option key={n} value={n} />)}</datalist>
        </div>
        <div className="field">
          <label htmlFor="cp-role">Funkcia</label>
          <input id="cp-role" value={c.personRole} onChange={(e) => set("personRole", e.target.value)} placeholder="napr. konateľ, obchodný riaditeľ" />
        </div>
        <div className="field">
          <label htmlFor="cp-phone">Telefón</label>
          <input id="cp-phone" type="tel" value={c.phone} onChange={(e) => set("phone", e.target.value)} placeholder="+421 …" />
        </div>
        <div className="field">
          <label htmlFor="cp-email">E-mail</label>
          <input id="cp-email" type="email" value={c.email} onChange={(e) => set("email", e.target.value)} placeholder="meno@firma.sk" />
        </div>
      </div>

      <div className="checks-inline">
        <label className="check-row">
          <input type="checkbox" checked={c.isStatutory} onChange={(e) => set("isStatutory", e.target.checked)} />
          <span>Kontaktná osoba je štatutár zapísaný v obchodnom registri</span>
        </label>
        <label className="check-row">
          <input type="checkbox" checked={c.identityVerified} onChange={(e) => set("identityVerified", e.target.checked)} />
          <span>Totožnosť kontaktnej osoby sme overili</span>
        </label>
      </div>
      {c.personName.trim().length > 3 && (
        <p className={`hint ${match ? "f-positive" : "f-warning"}`} style={{ marginTop: 4 }}>
          {match
            ? `✓ ${match} je v obchodnom registri zapísaný ako štatutár.`
            : statutoryNames.length
              ? `Pozor: meno nezodpovedá štatutárovi v registri (${statutoryNames.join(", ")}). Overte oprávnenie konať za spoločnosť (plná moc).`
              : "V registri nie je uvedený štatutár – oprávnenie konať overte."}
        </p>
      )}

      <div className="field" style={{ marginTop: 12 }}>
        <label>Kto od nás s partnerom komunikuje</label>
        <div className="owner-list">
          {people.map((p) => (
            <label key={p.email} className="check-row">
              <input
                type="checkbox"
                checked={c.owners.includes(p.email)}
                onChange={(e) => set("owners", e.target.checked ? [...c.owners, p.email] : c.owners.filter((o) => o !== p.email))}
              />
              <span>{p.name ? `${p.name} (${p.email})` : p.email}</span>
            </label>
          ))}
          {!people.length && <span className="src">Načítavam zoznam kolegov…</span>}
        </div>
      </div>

      <div className="field">
        <label htmlFor="cp-note">Poznámka ku komunikácii</label>
        <textarea id="cp-note" rows={2} value={c.note} onChange={(e) => set("note", e.target.value)} placeholder="napr. dohodnuté podmienky, história komunikácie" />
      </div>

      <div className="toolbar no-print" style={{ marginTop: 4 }}>
        <button className="btn" onClick={save} disabled={busy || !dirty}>{busy ? "Ukladám…" : "Uložiť kontakt"}</button>
        {saved?.updatedAt && (
          <span className="src">Naposledy upravil {label(saved.updatedBy || "")} · {new Date(saved.updatedAt).toLocaleString("sk-SK", { dateStyle: "short", timeStyle: "short" })}</span>
        )}
        {dirty && saved && <span className="src f-warning">Neuložené zmeny</span>}
        {msg && <span className={msg.ok ? "f-positive" : "f-critical"}>{msg.text}</span>}
      </div>
      </div>
    </section>
  );
}
