"use client";

import { useEffect, useState } from "react";

type Provider = "anthropic" | "openai";
interface ProviderStatus { label: string; hasKey: boolean; origin: "env" | "admin" | null; keyHint?: string; model: string; defaultModel: string; fastModel: string; customModel: string; envLocked: boolean }
type Speed = "fast" | "standard";
interface Status {
  configured: boolean;
  origin: "env" | "admin" | null;
  provider: Provider;
  model: string;
  speed: Speed;
  keyHint?: string;
  auto: boolean;
  noApiSources: boolean;
  adminKeyAllowed: boolean;
  envLocked: boolean;
  providers: Record<Provider, ProviderStatus>;
  updatedAt?: string;
  updatedBy?: string;
  defaults: Record<string, string>;
  jev?: { hasKey: boolean; origin: "env" | "admin" | null; keyHint?: string; enabled: boolean; active: boolean; minConfidence: number; envLocked: boolean; adminKeyAllowed: boolean };
}

/** Administrácia → Nastavenia AI (kľúč Claude / OpenAI pre záložné vyhľadávanie). */
export default function AiSettings() {
  const [st, setSt] = useState<Status | null>(null);
  const [provider, setProvider] = useState<"anthropic" | "openai">("anthropic");
  const [model, setModel] = useState("");
  const [speed, setSpeed] = useState<Speed>("standard");
  const [key, setKey] = useState("");
  const [auto, setAuto] = useState(false);
  const [noApi, setNoApi] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [jevKey, setJevKey] = useState("");
  const [jevOn, setJevOn] = useState(true);
  const [jevMin, setJevMin] = useState(0.85);

  const apply = (s: Status) => {
    setSt(s);
    setProvider(s.provider);
    setModel(s.providers?.[s.provider]?.customModel || "");
    setSpeed(s.speed || "standard");
    setAuto(s.auto);
    if (s.jev) {
      setJevOn(s.jev.enabled);
      setJevMin(s.jev.minConfidence);
    }
    setNoApi(s.noApiSources);
  };
  /** Pri prepnutí poskytovateľa v rozhraní sa zobrazí jeho model a kľúč */
  const pick = (p: Provider) => {
    setProvider(p);
    setKey("");
    const ps = st?.providers?.[p];
    setModel(ps?.customModel || "");
  };
  useEffect(() => {
    fetch("/api/admin/ai").then((r) => r.json()).then(apply).catch(() => {});
  }, []);

  async function save(extra: object = {}) {
    setBusy(true);
    setMsg(null);
    try {
      const r = await fetch("/api/admin/ai", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ provider, model, key, auto, noApiSources: noApi, speed, ...extra }) });
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
  async function saveJev(extra: object = {}) {
    setBusy(true);
    setMsg(null);
    try {
      const r = await fetch("/api/admin/ai", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ jev: { enabled: jevOn, minConfidence: jevMin, key: jevKey, ...extra } }) });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error);
      apply(j);
      setJevKey("");
      setMsg({ ok: true, text: "Nastavenie Jev uložené." });
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  }
  async function testJev() {
    setBusy(true);
    setMsg(null);
    const r = await fetch("/api/admin/ai/test?jev=1", { method: "POST" });
    const j = await r.json().catch(() => ({}));
    setMsg(j.ok ? { ok: true, text: `Jev funguje – ${j.model} odpovedal za ${j.ms} ms.` } : { ok: false, text: `Test Jev zlyhal: ${j.error || r.status}` });
    setBusy(false);
  }
  async function test() {
    setBusy(true);
    setMsg(null);
    const r = await fetch("/api/admin/ai/test", { method: "POST" });
    const j = await r.json().catch(() => ({}));
    setMsg(j.ok ? { ok: !j.warning, text: `Spojenie funguje – ${j.provider} / ${j.model} odpovedal „${j.reply}“ za ${j.ms} ms.${j.warning ? ` Upozornenie: ${j.warning}` : ""}` } : { ok: false, text: `Test zlyhal: ${j.error || r.status}` });
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
        <b>Ako to funguje:</b> pri registroch za formulárom (VšZP, Union, Obchodný vestník, ÚVO, diskvalifikácie) AI ovláda prehliadač na serveri –
        server sám vyplní IČO a odošle vyhľadávanie, model prečíta výsledok a v prípade potreby pokračuje (klikne, vyplní, počká). Pri ostatných
        registroch AI vyhľadáva a otvára stránky na webe. Priebeh vidí používateľ naživo; s rýchlym modelom trvá overenie zvyčajne 10 – 30 s.
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

      <div className="field" style={{ marginTop: 8 }}>
        <label>Rýchlosť overenia (platí pre oboch poskytovateľov)</label>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 10 }}>
          {([
            ["fast", "Rýchly model", `${st.providers.anthropic.fastModel} / ${st.providers.openai.fastModel} · rýchlejší a lacnejší na jednoduché stránky; pri zložitejších formulároch sa môže zamotať`],
            ["standard", "Štandardný model (odporúčané)", `${st.providers.anthropic.defaultModel} / ${st.providers.openai.defaultModel} · spoľahlivejší pri formulároch s prepínačmi a dátumami`],
          ] as [Speed, string, string][]).map(([v, title, desc]) => (
            <label key={v} style={{ border: `1px solid ${speed === v ? "var(--brand)" : "var(--line)"}`, borderRadius: 10, padding: "12px 14px", cursor: "pointer", display: "grid", gap: 2 }}>
              <input type="radio" name="ai-speed" checked={speed === v} onChange={() => setSpeed(v)} style={{ display: "none" }} />
              <b>{title}{st.speed === v && !cur.customModel && cur.model === (v === "fast" ? cur.fastModel : cur.defaultModel) ? <span className="pill s-ok" style={{ marginLeft: 8 }}>aktívne</span> : null}</b>
              <small className="src">{desc}</small>
            </label>
          ))}
        </div>
        <p className="hint" style={{ margin: "6px 0 0" }}>Ak rýchly model nie je pre váš kľúč dostupný, overenie sa automaticky zopakuje so štandardným modelom.</p>
      </div>

      <div className="contact-grid">
        <div className="field">
          <label htmlFor="ai-m">Vlastný model pre {cur.label} (nepovinné – prepíše voľbu rýchlosti)</label>
          <input id="ai-m" style={sel} value={model} onChange={(e) => setModel(e.target.value)} placeholder={speed === "fast" ? cur.fastModel : cur.defaultModel} />
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

      {st.jev && (
        <div style={{ borderTop: "1px solid var(--line)", marginTop: 16, paddingTop: 14 }}>
          <h3 style={{ margin: "0 0 4px" }}>Rýchle vyhodnotenie výsledku – Jev (TypeSafe)</h3>
          <p className="hint" style={{ marginTop: 0 }}>
            Pri registroch za formulárom server sám vyplní IČO a odošle vyhľadávanie; stránku s výsledkom potom za zlomok sekundy vyhodnotí Jev.
            Ak s istotou nad prahom určí „bez záznamu“ (a server to potvrdí podľa textu stránky), overenie končí bez volania LLM. Nález alebo nižšia
            istota → pokračuje Claude/OpenAI. Jev pomáha aj pri automatickom preverení (Union, Obchodný vestník), keď pevné pravidlá nestačia.
          </p>
          <p>
            Stav:{" "}
            {st.jev.active ? (
              <span className="pill s-ok">Aktívny · kľúč {st.jev.keyHint}{st.jev.origin === "env" ? " · z premenných prostredia" : ""} · istota ≥ {Math.round(st.jev.minConfidence * 100)} %</span>
            ) : st.jev.hasKey ? (
              <span className="pill s-manual">Vypnutý</span>
            ) : (
              <span className="pill s-manual">Bez kľúča – nastavte TYPESAFE_API_KEY vo Verceli</span>
            )}
          </p>
          <div className="contact-grid">
            <div className="field">
              <label htmlFor="jev-min">Minimálna istota pre „bez záznamu“ ({Math.round(jevMin * 100)} %)</label>
              <input id="jev-min" type="range" min={0.6} max={0.99} step={0.01} value={jevMin} onChange={(e) => setJevMin(Number(e.target.value))} />
            </div>
            <div className="field">
              <label htmlFor="jev-k">API kľúč Jev{st.jev.hasKey ? ` (uložený ${st.jev.keyHint}${st.jev.envLocked ? ", z premenných prostredia" : ""})` : ""}</label>
              {!st.jev.envLocked && st.jev.adminKeyAllowed ? (
                <input id="jev-k" type="password" autoComplete="off" value={jevKey} onChange={(e) => setJevKey(e.target.value)} placeholder="kľúč z console.typesafe.ai" />
              ) : (
                <p className="hint" style={{ margin: 0 }}>{st.jev.envLocked ? "Kľúč je v premenných prostredia (TYPESAFE_API_KEY) – zmeny robte tam." : "V produkcii sa kľúč zadáva v premenných prostredia na Verceli: TYPESAFE_API_KEY."}</p>
              )}
            </div>
          </div>
          <label className="check-row"><input type="checkbox" checked={jevOn} onChange={(e) => setJevOn(e.target.checked)} /><span>Používať Jev na vyhodnotenie výsledku</span></label>
          <div className="toolbar">
            <button className="btn" disabled={busy} onClick={() => saveJev()}>Uložiť Jev</button>
            <button className="btn ghost" disabled={busy || !st.jev.active} onClick={testJev}>Otestovať Jev</button>
            {st.jev.origin === "admin" && <button className="btn ghost" disabled={busy} onClick={() => confirm("Zmazať uložený kľúč Jev?") && saveJev({ clearKey: true })}>Zmazať kľúč</button>}
          </div>
        </div>
      )}
      {msg && <div className={msg.ok ? "okmsg" : "err"}>{msg.text}</div>}
    </section>
  );
}
