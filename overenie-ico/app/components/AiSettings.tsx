"use client";

import { useEffect, useState } from "react";

type Provider = "anthropic" | "openai";
interface ProviderStatus { label: string; hasKey: boolean; origin: "env" | "admin" | null; keyHint?: string; model: string; defaultModel: string; envLocked: boolean }
interface Status {
  configured: boolean;
  origin: "env" | "admin" | null;
  provider: Provider;
  model: string;
  keyHint?: string;
  auto: boolean;
  noApiSources: boolean;
  adminKeyAllowed: boolean;
  envLocked: boolean;
  providers: Record<Provider, ProviderStatus>;
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
  const [auto, setAuto] = useState(false);
  const [noApi, setNoApi] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const apply = (s: Status) => {
    setSt(s);
    setProvider(s.provider);
    setModel(s.providers?.[s.provider]?.model && s.providers[s.provider].model !== s.providers[s.provider].defaultModel ? s.providers[s.provider].model : "");
    setAuto(s.auto);
    setNoApi(s.noApiSources);
  };
  /** Pri prepnutí poskytovateľa v rozhraní sa zobrazí jeho model a kľúč */
  const pick = (p: Provider) => {
    setProvider(p);
    setKey("");
    const ps = st?.providers?.[p];
    setModel(ps && ps.model !== ps.defaultModel ? ps.model : "");
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
  const sel = { font: "inherit", padding: "10px 12px", border: "1px solid var(--line)", borderRadius: 8, background: "var(--surface)", color: "var(--ink)" } as const;
  const cur = st.providers[provider];
  const keyEditable = !cur.envLocked && st.adminKeyAllowed;

  return (
    <section className="card">
      <h2>Nastavenia AI – záložné vyhľadávanie</h2>
      <p className="hint" style={{ marginTop: 0 }}>
        Keď register nie je dostupný cez API (výpadok, zmena formátu) alebo API vôbec nemá, AI ho vyhľadá priamo na oficiálnej stránke registra.
        Každý výsledok AI musí mať odkaz na oficiálny zdroj, inak ostane na manuálne overenie. Výsledky sú v protokole označené „Overené AI“.
      </p>
      <p className="hint" style={{ marginTop: 0 }}>
        <b>Obmedzenie:</b> väčšina slovenských registrov sú vyhľadávacie formuláre, ktoré vyhľadávače neindexujú. AI preto musí stránku s výsledkom pre dané IČO
        otvoriť priamo – to vie Claude (nástroj na otvorenie stránky), OpenAI má len webové vyhľadávanie a pri týchto registroch zväčša skončí „nevedela overiť“.
        Pri registroch, kde to z povahy nejde (formulár POST, vlastné API, blokovanie), je AI vypnutá s vysvetlením. Jedno overenie trvá 30 – 90 s.
      </p>
      <p>
        Stav:{" "}
        {st.configured ? (
          <span className="pill s-ok">Aktívne · {st.providers[st.provider].label} · {st.model} · kľúč {st.keyHint}{st.origin === "env" ? " · z premenných prostredia" : ""}</span>
        ) : (
          <span className="pill s-manual">Nenastavené – ani jeden poskytovateľ nemá kľúč</span>
        )}
      </p>
      {st.configured && (
        <p className="hint">
          Automatické spúšťanie: <b>{st.auto ? "zapnuté pri zlyhaní zdroja" : "vypnuté – AI len na tlačidlo"}</b>
          {st.noApiSources ? " · registre bez API: automaticky" : ""}. Každé AI overenie stojí kredit u poskytovateľa.
        </p>
      )}

      <div className="field" style={{ marginTop: 8 }}>
        <label>Aktívny poskytovateľ pre webové vyhľadávanie</label>
        <div className="s-plan-pick" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          {(["anthropic", "openai"] as Provider[]).map((p) => {
            const ps = st.providers[p];
            return (
              <label key={p} className={`ai-prov ${provider === p ? "on" : ""}`} style={{ border: `1px solid ${provider === p ? "var(--brand)" : "var(--line)"}`, borderRadius: 10, padding: "12px 14px", cursor: "pointer", display: "grid", gap: 2 }}>
                <input type="radio" name="ai-provider" checked={provider === p} onChange={() => pick(p)} style={{ display: "none" }} />
                <b>{ps.label}{st.provider === p && st.configured ? <span className="pill s-ok" style={{ marginLeft: 8 }}>aktívny</span> : null}</b>
                <small className="src">
                  {ps.hasKey ? `kľúč ${ps.keyHint}${ps.origin === "env" ? " (prostredie)" : " (administrácia)"}` : "bez kľúča"} · model {ps.model}
                </small>
              </label>
            );
          })}
        </div>
      </div>

      <div className="contact-grid">
        <div className="field">
          <label htmlFor="ai-m">Model pre {cur.label} (prázdne = {cur.defaultModel})</label>
          <input id="ai-m" style={sel} value={model} onChange={(e) => setModel(e.target.value)} placeholder={cur.defaultModel} />
        </div>
        <div className="field">
          <label htmlFor="ai-k">API kľúč pre {cur.label}{cur.hasKey ? ` (uložený ${cur.keyHint}${cur.envLocked ? ", z premenných prostredia" : " – vyplňte len pri zmene"})` : ""}</label>
          {keyEditable ? (
            <input id="ai-k" type="password" autoComplete="off" value={key} onChange={(e) => setKey(e.target.value)} placeholder={provider === "openai" ? "sk-…" : "sk-ant-…"} />
          ) : (
            <p className="hint" style={{ margin: 0 }}>
              {cur.envLocked
                ? `Kľúč je v premenných prostredia (${provider === "openai" ? "OPENAI_API_KEY" : "ANTHROPIC_API_KEY"}) – zmeny robte tam.`
                : `V produkcii sa kľúč zadáva len v premenných prostredia na Verceli (${provider === "openai" ? "OPENAI_API_KEY" : "ANTHROPIC_API_KEY"}); zadávanie tu povolíte premennou AI_ALLOW_ADMIN_KEY=1.`}
            </p>
          )}
        </div>
      </div>
      <label className="check-row"><input type="checkbox" checked={auto} onChange={(e) => setAuto(e.target.checked)} /><span>Spustiť AI automaticky, keď zdroj zlyhá (inak len tlačidlom „Overiť cez AI“ – šetrí kredit)</span></label>
      <label className="check-row" style={{ marginTop: 6 }}><input type="checkbox" checked={noApi} onChange={(e) => setNoApi(e.target.checked)} /><span>Automaticky overovať aj registre bez API, kde AI môže fungovať (napr. ÚVO)</span></label>
      <div className="toolbar">
        <button className="btn" disabled={busy} onClick={() => save()}>Uložiť</button>
        <button className="btn ghost" disabled={busy || !st.configured} onClick={test}>Otestovať spojenie</button>
        {cur.hasKey && cur.origin === "admin" && <button className="btn ghost" disabled={busy} onClick={() => confirm(`Zmazať uložený kľúč pre ${cur.label}?`) && save({ clearKey: true })}>Zmazať kľúč</button>}
      </div>
      <p className="hint">Prepnutie poskytovateľa platí hneď pre všetky ďalšie overenia cez AI. Kľúče zadané tu sa ukladajú šifrovane a znova sa nezobrazia; pre produkciu ich nastavte v premenných prostredia.</p>
      {msg && <div className={msg.ok ? "okmsg" : "err"}>{msg.text}</div>}
    </section>
  );
}
