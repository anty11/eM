"use client";

import { useEffect, useState } from "react";

interface Status {
  configured: boolean;
  origin: "env" | "admin" | null;
  provider: "anthropic" | "openai";
  model: string;
  keyHint?: string;
  auto: boolean;
  noApiSources: boolean;
  adminKeyAllowed: boolean;
  envLocked: boolean;
  updatedAt?: string;
  updatedBy?: string;
  defaults: Record<string, string>;
}

/** Administrácia → Nastavenia AI (kľúč Claude / OpenAI pre záložné vyhľadávanie). */
export default function AiSettings() {
  const [st, setSt] = useState<Status | null>(null);
  const [provider, setProvider] = useState<"anthropic" | "openai">("anthropic");
  const [model, setModel] = useState("");
  const [key, setKey] = useState("");
  const [auto, setAuto] = useState(true);
  const [noApi, setNoApi] = useState(true);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const apply = (s: Status) => {
    setSt(s);
    setProvider(s.provider);
    setModel(s.model || "");
    setAuto(s.auto);
    setNoApi(s.noApiSources);
  };
  useEffect(() => {
    fetch("/api/admin/ai").then((r) => r.json()).then(apply).catch(() => {});
  }, []);

  async function save(extra: object = {}) {
    setBusy(true);
    setMsg(null);
    try {
      const r = await fetch("/api/admin/ai", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ provider, model, key, auto, noApiSources: noApi, ...extra }) });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error);
      apply(j);
      setKey("");
      setMsg({ ok: true, text: "Uložené." });
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  }
  async function test() {
    setBusy(true);
    setMsg(null);
    const r = await fetch("/api/admin/ai/test", { method: "POST" });
    const j = await r.json().catch(() => ({}));
    setMsg(j.ok ? { ok: true, text: `Spojenie funguje – ${j.provider} / ${j.model} odpovedal „${j.reply}“ za ${j.ms} ms.` } : { ok: false, text: `Test zlyhal: ${j.error || r.status}` });
    setBusy(false);
  }

  if (!st) return null;
  const locked = st.envLocked || !st.adminKeyAllowed;
  const sel = { font: "inherit", padding: "10px 12px", border: "1px solid var(--line)", borderRadius: 8, background: "var(--surface)", color: "var(--ink)" } as const;

  return (
    <section className="card">
      <h2>Nastavenia AI – záložné vyhľadávanie</h2>
      <p className="hint" style={{ marginTop: 0 }}>
        Keď register nie je dostupný cez API (výpadok, zmena formátu) alebo API vôbec nemá, AI ho vyhľadá priamo na oficiálnej stránke registra.
        Každý výsledok AI musí mať odkaz na oficiálny zdroj, inak ostane na manuálne overenie. Výsledky sú v protokole označené „Overené AI“.
      </p>
      <p>
        Stav:{" "}
        {st.configured ? (
          <span className="pill s-ok">Aktívne · {st.provider === "openai" ? "OpenAI" : "Claude"} · {st.model || st.defaults[st.provider]} · kľúč {st.keyHint}{st.origin === "env" ? " · z premenných prostredia" : ""}</span>
        ) : (
          <span className="pill s-manual">Nenastavené</span>
        )}
      </p>
      {st.envLocked && <p className="hint">AI je nastavená v premenných prostredia (ANTHROPIC_API_KEY / OPENAI_API_KEY, AI_PROVIDER, AI_MODEL). Zmeny robte tam.</p>}
      {!st.envLocked && !st.adminKeyAllowed && (
        <p className="hint">V produkcii sa kľúč zadáva len v premenných prostredia na Verceli: <code>ANTHROPIC_API_KEY</code> alebo <code>OPENAI_API_KEY</code>. (Zadávanie tu povolíte premennou <code>AI_ALLOW_ADMIN_KEY=1</code>.)</p>
      )}
      {!locked && (
        <>
          <div className="contact-grid">
            <div className="field">
              <label htmlFor="ai-p">Poskytovateľ</label>
              <select id="ai-p" style={sel} value={provider} onChange={(e) => setProvider(e.target.value as any)}>
                <option value="anthropic">Claude (Anthropic)</option>
                <option value="openai">OpenAI</option>
              </select>
            </div>
            <div className="field">
              <label htmlFor="ai-m">Model (prázdne = {st.defaults[provider]})</label>
              <input id="ai-m" value={model} onChange={(e) => setModel(e.target.value)} placeholder={st.defaults[provider]} />
            </div>
            <div className="field" style={{ gridColumn: "1 / -1" }}>
              <label htmlFor="ai-k">API kľúč {st.keyHint && provider === st.provider ? `(uložený ${st.keyHint} – vyplňte len pri zmene)` : ""}</label>
              <input id="ai-k" type="password" autoComplete="off" value={key} onChange={(e) => setKey(e.target.value)} placeholder={provider === "openai" ? "sk-…" : "sk-ant-…"} />
            </div>
          </div>
          <label className="check-row"><input type="checkbox" checked={auto} onChange={(e) => setAuto(e.target.checked)} /><span>Spustiť AI automaticky, keď zdroj zlyhá</span></label>
          <label className="check-row" style={{ marginTop: 6 }}><input type="checkbox" checked={noApi} onChange={(e) => setNoApi(e.target.checked)} /><span>Automaticky overovať aj registre bez API (VšZP, Union, Obchodný vestník, Register diskvalifikácií, ÚVO)</span></label>
          <div className="toolbar">
            <button className="btn" disabled={busy} onClick={() => save()}>Uložiť</button>
            <button className="btn ghost" disabled={busy || !st.configured} onClick={test}>Otestovať spojenie</button>
            {st.keyHint && st.origin === "admin" && <button className="btn ghost" disabled={busy} onClick={() => confirm("Zmazať uložený kľúč?") && save({ clearKey: true })}>Zmazať kľúč</button>}
          </div>
          <p className="hint">Kľúč sa ukladá šifrovane do databázy aplikácie a znova sa nezobrazí. Pre produkciu ho nastavte v premenných prostredia.</p>
        </>
      )}
      {locked && st.configured && (
        <div className="toolbar"><button className="btn ghost" disabled={busy} onClick={test}>Otestovať spojenie</button></div>
      )}
      {msg && <div className={msg.ok ? "okmsg" : "err"}>{msg.text}</div>}
    </section>
  );
}
