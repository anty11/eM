"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { applyManual, computeVerdict, type ManualAnswers } from "@/lib/scoring";
import { CATEGORIES, type CategoryId, type CheckResult, type ScanReport } from "@/lib/types";
import Header, { useMe } from "../components/Header";
import ContactCard from "../components/ContactCard";
import KeyFacts from "../components/KeyFacts";
import DealCard, { EMPTY_DEAL } from "../components/DealCard";
import { buildDealCheck, type BankAccountResult, type DealInput } from "@/lib/deal";
import { shortHash, type Seal } from "@/lib/seal";
import { DOMAIN } from "../components/site/SiteShell";
import { MANUAL } from "@/lib/sources/manual";
import { AUTO_ORDER, pendingCheck } from "@/lib/sources/meta";
import { AI_SPECS, aiCapable } from "@/lib/ai/specs";
import { keyFacts as computeKeyFacts } from "@/lib/keyfacts";
import type { CompanyProfile } from "@/lib/types";

const NON_PUBLIC = MANUAL.map((m) => m.id);

const STATUS_LABEL: Record<CheckResult["status"], string> = {
  ok: "Bez záznamu",
  warning: "Upozornenie",
  critical: "Negatívny záznam",
  info: "Informácia",
  pending: "Overuje sa…",
  manual: "Overiť manuálne",
  error: "Zdroj nedostupný",
};

const SOURCES = [
  "Register právnických osôb / Obchodný register",
  "Register účtovných závierok",
  "Finančná správa – daňoví dlžníci, DPH, index spoľahlivosti",
  "Sociálna poisťovňa – dlžníci",
  "Register úpadcov (konkurz, reštrukturalizácia)",
  "Register partnerov verejného sektora",
  "Médiá a internet",
];

const fmtDate = (iso?: string) => (iso ? new Date(iso).toLocaleString("sk-SK", { dateStyle: "long", timeStyle: "medium" }) : "–");
const eur = (n?: number) => (n === undefined || n === null ? "–" : `${Math.round(n).toLocaleString("sk-SK")} €`);

function safeGet<T>(k: string, d: T): T {
  try {
    const v = localStorage.getItem(k);
    return v ? (JSON.parse(v) as T) : d;
  } catch {
    return d;
  }
}
function safeSet(k: string, v: unknown) {
  try {
    localStorage.setItem(k, JSON.stringify(v));
  } catch {
    /* úložisko nedostupné */
  }
}

export default function Page() {
  const me = useMe();
  const [ico, setIco] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [report, setReport] = useState<ScanReport | null>(null);
  const [answers, setAnswers] = useState<ManualAnswers>({});
  const [author, setAuthor] = useState("");
  const [note, setNote] = useState("");
  const [recent, setRecent] = useState<{ ico: string; name?: string }[]>([]);
  const [showManual, setShowManual] = useState(false);
  // Údaje o obchode a indikátory rizika (SKDP 03/2024) – zadáva poverený zamestnanec
  const [deal, setDeal] = useState<DealInput>(EMPTY_DEAL);
  const [bank, setBank] = useState<BankAccountResult | null>(null);
  // Pečať protokolu (odtlačok + čas zápisu na serveri) – vytvorí sa pri uložení PDF
  const [seal, setSeal] = useState<Seal | null>(null);
  const [sealing, setSealing] = useState(false);
  const [sealErr, setSealErr] = useState("");
  const [contactSnap, setContactSnap] = useState<Record<string, unknown> | null>(null);
  // Výsledky AI záložného overenia (prepíšu pôvodnú kontrolu) a doplnenia profilu
  const [aiResults, setAiResults] = useState<Record<string, CheckResult>>({});
  const [profilePatch, setProfilePatch] = useState<Partial<CompanyProfile>>({});
  const [aiBusy, setAiBusy] = useState<Record<string, boolean>>({});
  const [aiErr, setAiErr] = useState<Record<string, string>>({});
  const [retrying, setRetrying] = useState<Record<string, boolean>>({});
  const [aiSince, setAiSince] = useState<Record<string, number>>({});
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!Object.values(aiBusy).some(Boolean)) return;
    const t = setInterval(() => setTick((x) => x + 1), 1000);
    return () => clearInterval(t);
  }, [aiBusy]);
  const lawyer = me?.mode === "advokat";
  const autoRan = useRef(false);

  useEffect(() => {
    setRecent(safeGet("recent", []));
    setAuthor(safeGet("author", ""));
    const q = new URLSearchParams(location.search).get("ico");
    if (q && !autoRan.current) {
      autoRan.current = true; // vo vývoji React spúšťa efekt dvakrát – preverenie (a jeho záznam) má bežať raz
      setIco(q);
      run(q);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function run(value = ico) {
    const v = value.replace(/\s/g, "");
    if (!/^\d{6,8}$/.test(v)) {
      setError("IČO musí mať 6 až 8 číslic.");
      return;
    }
    setLoading(true);
    setError(null);
    setReport(null);
    setAnswers({});
    setNote("");
    setAiResults({});
    setProfilePatch({});
    setAiBusy({});
    setAiErr({});
    try {
      const r = await fetch(`/api/check?ico=${v}&stream=1`);
      if (r.status === 401) {
        location.href = `/login?next=${encodeURIComponent(`/app?ico=${v}`)}`;
        return;
      }
      if (!r.ok || !r.body) {
        const j = await r.json().catch(() => ({}));
        throw new Error(j.error || `Chyba ${r.status}`);
      }
      // Priebežné výsledky: karta sa doplní hneď, ako daný zdroj odpovie
      const ico8 = v.padStart(8, "0");
      const now = new Date().toISOString();
      let live: ScanReport = {
        scanId: "",
        ico: ico8,
        scannedAt: now,
        profile: { ico: ico8 },
        checks: AUTO_ORDER.map(pendingCheck),
        verdict: computeVerdict([]),
        keyFacts: [],
        appVersion: "",
      };
      setReport(live);
      history.replaceState(null, "", `?ico=${ico8}`);
      const reader = r.body.getReader();
      const dec = new TextDecoder();
      let buf = "";
      let final: ScanReport | null = null;
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let nl: number;
        while ((nl = buf.indexOf("\n")) >= 0) {
          const line = buf.slice(0, nl).trim();
          buf = buf.slice(nl + 1);
          if (!line) continue;
          const ev = JSON.parse(line);
          if (ev.type === "start") live = { ...live, scannedBy: ev.scannedBy, ai: ev.ai };
          else if (ev.type === "check") {
            const i = live.checks.findIndex((c) => c.id === ev.check.id);
            const checksNext = i >= 0 ? live.checks.map((c, k) => (k === i ? ev.check : c)) : [...live.checks, ev.check];
            live = { ...live, checks: checksNext, profile: { ...live.profile, ...ev.profile } };
          } else if (ev.type === "done") final = ev.report;
          else if (ev.type === "error") throw new Error(ev.error);
          setReport(final || live);
        }
      }
      const j = final || live;
      setReport(j);
      setDeal(EMPTY_DEAL);
      setBank(null);
      setSeal(null);
      setSealErr("");
      if (!j.notFound) {
        setShowManual(true);
        autoAi(j);
      }
      const next = [{ ico: j.ico, name: j.profile?.name }, ...recent.filter((x) => x.ico !== j.ico)].slice(0, 8);
      setRecent(next);
      safeSet("recent", next);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  const baseChecks = useMemo(() => (report ? report.checks.map((c) => aiResults[c.id] || c) : []), [report, aiResults]);
  const profile = useMemo(() => (report ? ({ ...report.profile, ...profilePatch } as CompanyProfile) : null), [report, profilePatch]);
  const dealCheck = useMemo(() => (profile ? buildDealCheck(deal, profile, bank) : null), [deal, profile, bank]);
  const checks = useMemo(() => {
    const base = applyManual(baseChecks, answers);
    return dealCheck ? [...base, dealCheck] : base;
  }, [baseChecks, answers, dealCheck]);
  const facts = useMemo(() => (profile ? computeKeyFacts(profile, checks) : []), [profile, checks]);
  const pendingCount = checks.filter((c) => c.status === "pending").length;
  const totalAuto = checks.filter((c) => c.automated !== false && !NON_PUBLIC.includes(c.id)).length || 1;
  // neverejné registre, ktoré už overila AI, sa správajú ako bežné kontroly
  const nonPublic = useMemo(() => NON_PUBLIC.filter((id) => !(aiResults[id] && aiResults[id].status !== "manual")), [aiResults]);
  const verdict = useMemo(() => (report ? computeVerdict(checks, { ignore: lawyer ? [] : nonPublic }) : null), [report, checks, lawyer, nonPublic]);
  // Vo verzii Firma sa neverejné registre zobrazujú len ako odporúčané doplnkové overenia na konci
  const extra = useMemo(() => (lawyer ? [] : checks.filter((c) => nonPublic.includes(c.id))), [checks, lawyer, nonPublic]);
  const pendingManual = useMemo(
    () => (lawyer ? checks.filter((c) => (baseChecks.find((o) => o.id === c.id)?.status === "manual" || baseChecks.find((o) => o.id === c.id)?.status === "error")) : []),
    [checks, lawyer, baseChecks],
  );
  const openManual = pendingManual.filter((c) => !answers[c.id]).length;
  const grouped = useMemo(() => {
    const g = new Map<CategoryId, CheckResult[]>();
    for (const c of checks) if (lawyer || !nonPublic.includes(c.id)) g.set(c.category, [...(g.get(c.category) || []), c]);
    return (Object.keys(CATEGORIES) as CategoryId[]).filter((k) => g.has(k)).map((k) => [k, g.get(k)!] as const);
  }, [checks, lawyer, nonPublic]);

  /** Znovu spustí jeden zdroj (po výpadku / časovom limite). */
  async function retryOne(id: string) {
    if (!report || !profile) return;
    setRetrying((s) => ({ ...s, [id]: true }));
    try {
      const r = await fetch("/api/check/one", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ico: report.ico, id, profile }) });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || `Chyba ${r.status}`);
      setAiResults((s) => ({ ...s, [id]: j.check })); // prepíše pôvodný výsledok (rovnaký mechanizmus ako AI)
      if (j.profile) setProfilePatch((s) => ({ ...s, ...j.profile }));
    } catch (e) {
      setAiErr((s) => ({ ...s, [id]: (e as Error).message }));
    } finally {
      setRetrying((s) => ({ ...s, [id]: false }));
    }
  }

  /** Pred tlačou zapečatí konečný obsah protokolu na serveri (odtlačok + čas) a potom otvorí tlač do PDF. */
  async function sealAndPrint() {
    if (!report || !profile || !verdict) return;
    setSealing(true);
    setSealErr("");
    try {
      const r = await fetch("/api/protocol/seal", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scanId: report.scanId, ico: report.ico, scannedAt: report.scannedAt, profile, checks, verdict, keyFacts: facts, deal, contact: contactSnap, note, author, appVersion: report.appVersion }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || `Chyba ${r.status}`);
      setSeal(j);
    } catch (e) {
      setSeal(null);
      setSealErr(`Pečať sa nepodarilo zapísať (${(e as Error).message}) – protokol sa vytlačí bez odtlačku.`);
    } finally {
      setSealing(false);
    }
    // nech sa pečať stihne vykresliť do tlačovej hlavičky
    setTimeout(() => window.print(), 150);
  }

  const retryButton = (c: CheckResult) => {
    const cur = baseChecks.find((o) => o.id === c.id) || c;
    if (!AUTO_ORDER.includes(c.id) || (cur.status !== "error" && !(cur.status === "manual" && cur.automated !== false))) return null;
    return (
      <button className="mbtn no-print" disabled={retrying[c.id]} onClick={() => retryOne(c.id)}>
        {retrying[c.id] ? "Skúšam znova…" : "Skúsiť znova"}
      </button>
    );
  };

  /** AI záložné overenie jedného zdroja. */
  async function runAi(check: CheckResult, rep: ScanReport, prof: CompanyProfile) {
    setAiBusy((s) => ({ ...s, [check.id]: true }));
    setAiSince((s) => ({ ...s, [check.id]: Date.now() }));
    setAiErr((s) => ({ ...s, [check.id]: "" }));
    try {
      const r = await fetch("/api/ai/fallback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ico: rep.ico, check, profile: prof }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || `Chyba ${r.status}`);
      setAiResults((s) => ({ ...s, [check.id]: j.check }));
      if (j.profilePatch) setProfilePatch((s) => ({ ...s, ...j.profilePatch }));
      return j.profilePatch as Partial<CompanyProfile> | undefined;
    } catch (e) {
      setAiErr((s) => ({ ...s, [check.id]: (e as Error).message }));
    } finally {
      setAiBusy((s) => ({ ...s, [check.id]: false }));
    }
  }

  /** Po preverení: AI automaticky doplní zdroje, ktoré zlyhali (a pri zapnutej voľbe aj registre bez API). */
  async function autoAi(rep: ScanReport) {
    if (!rep.ai?.available || !rep.ai.auto) return;
    const failed = (c: CheckResult) => c.status === "error" || (c.status === "manual" && c.automated !== false) || (c.status === "manual" && c.id.startsWith("fs-"));
    let prof: CompanyProfile = rep.profile;
    const rpo = rep.checks.find((c) => c.id === "rpo");
    if (rpo && failed(rpo) && aiCapable("rpo")) prof = { ...prof, ...((await runAi(rpo, rep, prof)) || {}) };
    const todo = rep.checks.filter((c) => c.id !== "rpo" && aiCapable(c.id) && (failed(c) || (rep.ai!.noApiSources && NON_PUBLIC.includes(c.id))));
    // max. 3 súbežne
    let i = 0;
    await Promise.all(Array.from({ length: Math.min(3, todo.length) }, async () => { while (i < todo.length) await runAi(todo[i++], rep, prof); }));
  }

  const aiButton = (c: CheckResult) => {
    if (!report?.ai?.available || !AI_SPECS[c.id]) return null;
    if (AI_SPECS[c.id].disabled) return <span className="src no-print" title={AI_SPECS[c.id].disabled}>AI: nedostupné</span>;
    const orig = report.checks.find((o) => o.id === c.id)!;
    const offer = orig.status === "manual" || orig.status === "error" || aiResults[c.id];
    if (!offer) return null;
    return (
      <button className="mbtn ai no-print" disabled={aiBusy[c.id]} onClick={() => profile && runAi(orig, report, profile)}>
        {aiBusy[c.id] ? `AI prehľadáva register… ${Math.round((Date.now() - (aiSince[c.id] || Date.now())) / 1000)} s (zvyčajne 30–90 s)` : aiResults[c.id] ? "Overiť cez AI znova" : "Overiť cez AI"}
      </button>
    );
  };

  const aiBadge = (c: CheckResult) =>
    c.ai ? (
      <div className="ai-note">
        <span className="pill s-ai">Overené AI</span>{" "}
        <span className="src">{c.ai.provider === "openai" ? "OpenAI" : "Claude"} · {c.ai.model} · {new Date(c.ai.at).toLocaleTimeString("sk-SK")}{c.ai.rejected ? ` · ${c.ai.rejected}` : ""}</span>
        {c.ai.evidence?.length > 0 && (
          <ul className="evidence">
            {c.ai.evidence.map((e, i) => (
              <li key={i}><a className="verify" href={e.url} target="_blank" rel="noreferrer">{new URL(e.url).hostname}</a>{e.quote ? <> – „{e.quote}“</> : null}</li>
            ))}
          </ul>
        )}
      </div>
    ) : null;

  const manualButtons = (c: CheckResult) => (
    <>
      <span className="src no-print">Výsledok manuálneho overenia:</span>
      {(["clean", "found"] as const).map((a) => (
        <button key={a} className={`mbtn ${answers[c.id] === a ? `on-${a}` : ""}`} onClick={() => setAnswers((s) => ({ ...s, [c.id]: s[c.id] === a ? undefined : a }))}>
          {a === "clean" ? "Bez záznamu" : "Záznam nájdený"}
        </button>
      ))}
    </>
  );

  const ruz = checks.find((c) => c.id === "ruz");
  const news = checks.find((c) => c.id === "news");
  const metrics = ((ruz?.data as any)?.metrics || []) as any[];
  const p = profile;

  // Číslované odkazy na zdroje pre tlač (namiesto dlhých adries pri každej kontrole)
  const refs = useMemo(() => {
    const list: { n: number; url: string; name: string }[] = [];
    const byUrl = new Map<string, number>();
    for (const [, items] of grouped)
      for (const c of items) {
        if (!c.verifyUrl || byUrl.has(c.verifyUrl)) continue;
        byUrl.set(c.verifyUrl, list.length + 1);
        list.push({ n: list.length + 1, url: c.verifyUrl, name: c.name });
      }
    return { list, byUrl };
  }, [grouped]);

  return (
    <>
      <Header me={me} active="check" />

      <main className="wrap">
        <section className="hero no-print">
          <h1>{lawyer ? "Preverenie obchodného partnera – rozšírené" : "Preverte si obchodného partnera"}</h1>
          <p>
            {lawyer
              ? "Overí partnera vo verejných registroch, v závierkach a v médiách. Čo nie je verejne dostupné, aplikácia ponúkne poverenému zamestnancovi na manuálne overenie s odkazom na register. Výsledkom je hodnotenie rizika a protokol s časom preverenia."
              : "Zadajte IČO a do pol minúty uvidíte, či je spoločnosť bezpečný partner: obchodný register, dane a DPH, poisťovne, konkurzy, závierky aj médiá. Výsledok si uložíte ako PDF."}
          </p>
          <form
            className="search"
            onSubmit={(e) => {
              e.preventDefault();
              run();
            }}
          >
            <input inputMode="numeric" placeholder="IČO, napr. 47244895" value={ico} onChange={(e) => setIco(e.target.value)} aria-label="IČO" autoFocus />
            <button className="btn" disabled={loading}>{loading ? "Preverujem…" : "Preveriť"}</button>
          </form>
          {recent.length > 0 && (
            <div className="recent">
              {recent.map((r) => (
                <button key={r.ico} className="chip" onClick={() => { setIco(r.ico); run(r.ico); }} title={r.name}>
                  {r.ico}{r.name ? ` · ${r.name.slice(0, 28)}` : ""}
                </button>
              ))}
            </div>
          )}
          {error && <div className="err">{error}</div>}
          {loading && !report && (
            <ul className="loading">
              {SOURCES.map((s) => <li key={s}>⏳ {s}</li>)}
              <li>Preverenie trvá zvyčajne 10–30 sekúnd.</li>
            </ul>
          )}
        </section>

        {report?.notFound && (
          <section className="card verdict not_recommended notfound" style={{ ["--s" as any]: 0 }}>
            <div className="score"><div><div><b>?</b><br /><span>IČO</span></div></div></div>
            <div>
              <p className="vlabel">IČO {report.ico} sa v registri nenašlo</p>
              <div className="vmeta">Stav k {fmtDate(report.scannedAt)} · č. {report.scanId}</div>
              <p style={{ margin: "10px 0 0" }}>
                Register právnických osôb (Štatistický úrad SR) neeviduje subjekt s týmto IČO. Bez identifikácie subjektu nie je možné pokračovať
                v ďalších kontrolách – dane, poisťovne, konkurzy ani médiá sa nepreverovali a preverenie sa nezapísalo do databázy preverených spoločností.
              </p>
              <ul className="reasons">
                <li>Skontrolujte IČO na faktúre alebo v zmluve – má 8 číslic (staršie 6), bez medzier.</li>
                <li>Ak ide o zahraničný subjekt, nemá slovenské IČO – overte ho v registri jeho štátu (napr. ARES v ČR, Handelsregister v DE) alebo cez VIES podľa IČ DPH.</li>
                <li>Ak partner tvrdí, že spoločnosť existuje, ale v registri nie je, je to samo osebe závažný signál – vyžiadajte výpis z obchodného registra.</li>
              </ul>
              <div className="toolbar no-print">
                <a className="btn ghost" href={`https://www.orsr.sk/hladaj_ico.asp?ICO=${report.ico}&SID=0`} target="_blank" rel="noreferrer">Overiť v ORSR ↗</a>
                <button className="btn ghost" onClick={() => run(report.ico)}>Preveriť znova</button>
              </div>
            </div>
          </section>
        )}

        {report && !report.notFound && verdict && p && (
          <>
            <div className="print-only print-head">
              <div className="ph-row">
                <h1>Protokol o preverení obchodného partnera <span className="ph-brand">obozretne.sk</span></h1>
                <div className="ph-co">{p.name || "Neznámy subjekt"} · IČO {p.ico}</div>
              </div>
              <div className="ph-meta">Číslo preverenia {report.scanId} · Stav k {fmtDate(report.scannedAt)}{report.scannedBy ? ` · Preveril ${report.scannedBy}` : ""} · {lawyer ? "rozšírené overenie" : "štandardné overenie"}</div>
            </div>

            {pendingCount > 0 ? (
              <section className="card verdict caution progress-card" style={{ ["--s" as any]: Math.round(((totalAuto - pendingCount) / totalAuto) * 100) }}>
                <div className="score"><div><div><b>{totalAuto - pendingCount}</b><br /><span>z {totalAuto}</span></div></div></div>
                <div>
                  <p className="vlabel" style={{ color: "var(--ink)" }}>Preverujem…</p>
                  <div className="vmeta">Výsledky sa zobrazujú priebežne, ako jednotlivé registre odpovedajú. Čaká sa na: {checks.filter((c) => c.status === "pending").map((c) => c.name).join(", ")}.</div>
                </div>
              </section>
            ) : (
            <section className={`card verdict ${verdict.level}`} style={{ ["--s" as any]: verdict.score }}>
                <div className="score"><div><div><b>{verdict.score}</b><br /><span>zo 100</span></div></div></div>
                <div>
                  <p className="vlabel">{verdict.label}</p>
                  <div className="vmeta">
                    Stav k {fmtDate(report.scannedAt)} · č. {report.scanId}
                  </div>
                  <ul className="reasons">{verdict.reasons.slice(0, 8).map((r, i) => <li key={i}>{r}</li>)}</ul>
                  {verdict.preliminary && (
                    <span className="prelim">
                      Predbežné hodnotenie – {verdict.pendingManual} {verdict.pendingManual === 1 ? "kontrola čaká" : "kontrol čaká"} na manuálne overenie
                      {lawyer && <> · <button className="linkbtn no-print" onClick={() => setShowManual(true)}>otvoriť zoznam</button></>}
                    </span>
                  )}
                  {!lawyer && (
                    <div className="hint">Hodnotenie vychádza z verejne dostupných registrov. Exekúcie a zdravotné poisťovne nie sú verejne prístupné – nájdete ich v časti Ďalšie odporúčané overenia.</div>
                  )}
                </div>
              </section>
            )}

            {Object.values(aiBusy).some(Boolean) && (
              <div className="ai-running no-print">AI dohľadáva údaje v zdrojoch, ktoré nie sú dostupné cez API ({Object.values(aiBusy).filter(Boolean).length})… Výsledok sa priebežne dopĺňa.</div>
            )}
            {me?.role === "admin" && typeof location !== "undefined" && new URLSearchParams(location.search).has("diag") && (() => {
              const done = checks.filter((c) => c.status !== "manual" && c.status !== "error");
              const failed = baseChecks.filter((c) => c.status === "error" || (c.status === "manual" && c.automated !== false));
              const noKey = baseChecks.filter((c) => c.status === "manual" && c.automated === false && c.id.startsWith("fs-"));
              const nonPub = baseChecks.filter((c) => NON_PUBLIC.includes(c.id) && c.status === "manual");
              return (
                <section className="card coverage">
                  <h2>Pokrytie overenia</h2>
                  <p style={{ margin: 0 }}>
                    <b>{done.length} z {checks.length}</b> zdrojov overených automaticky{Object.values(aiResults).some((c) => c.status !== "manual") ? " (vrátane AI)" : ""}.
                  </p>
                  <ul className="src" style={{ margin: "6px 0 0", paddingLeft: 18 }}>
                    {noKey.length > 0 && <li>{noKey.length}× Finančná správa – chýba bezplatný kľúč <code>FS_API_KEY</code> (admin ho doplní vo Verceli).</li>}
                    {failed.length > 0 && <li>{failed.length}× zdroj neodpovedal alebo vrátil nejednoznačný výsledok: {failed.map((c) => c.name).join(", ")}.</li>}
                    {nonPub.length > 0 && <li>{nonPub.length}× register bez verejného prístupu ({nonPub.map((c) => c.name.replace(/^Dlžníci /, "")).join(", ")}){report.ai?.available ? " – AI overí tie, ktoré sa dajú." : " – s AI kľúčom by sa 5 z nich overilo automaticky."}</li>}
                  </ul>
                </section>
              );
            })()}
            <KeyFacts facts={facts} />

            <ContactCard ico={report.ico} profile={p} meEmail={me?.email} onChange={setContactSnap} />

            <DealCard ico={report.ico} profile={p} deal={deal} onChange={setDeal} bank={bank} onBank={setBank} />

            <section className="card">
              <h2>Identifikácia subjektu</h2>
              <p className="company-name">{p.name || "Neznámy subjekt"}</p>
              <dl className="profile kv">
                <div><dt>IČO</dt><dd>{p.ico}</dd></div>
                <div><dt>DIČ</dt><dd>{p.dic || "–"}</dd></div>
                <div><dt>IČ DPH</dt><dd>{p.icDph || "–"}</dd></div>
                <div><dt>Právna forma</dt><dd>{p.legalForm || "–"}</dd></div>
                <div><dt>Sídlo</dt><dd>{p.address || "–"}</dd></div>
                <div><dt>Deň vzniku</dt><dd>{p.established || "–"}{p.terminated ? ` · zánik ${p.terminated}` : ""}</dd></div>
                <div><dt>Registrácia</dt><dd>{[p.registrationOffice, p.registrationNumber].filter(Boolean).join(", ") || "–"}</dd></div>
                <div><dt>Hlavná činnosť</dt><dd>{p.mainActivity || "–"}</dd></div>
                <div><dt>Základné imanie</dt><dd>{eur(p.equity)}</dd></div>
                <div style={{ gridColumn: "1 / -1" }}>
                  <dt>Štatutárny orgán</dt>
                  <dd>{p.statutory?.length ? p.statutory.map((s) => `${s.name} (${s.role}${s.since ? `, od ${s.since}` : ""})`).join("; ") : "–"}</dd>
                </div>
                {p.owners && p.owners.length > 0 && (
                  <div style={{ gridColumn: "1 / -1" }}>
                    <dt>Vlastníci (spoločníci)</dt>
                    <dd>{p.owners.map((o) => `${o.name}${o.since ? ` (od ${o.since})` : ""}`).join("; ")}</dd>
                  </div>
                )}
                {p.activities && p.activities.length > 0 && (
                  <div style={{ gridColumn: "1 / -1" }}>
                    <dt>Predmet podnikania ({p.activities.length})</dt>
                    <dd>
                      <ul className="print-only acts-print">{p.activities.map((a, i) => <li key={i}>{a}</li>)}</ul>
                      {p.activities.length === 1 ? (
                        <span className="no-print">{p.activities[0]}</span>
                      ) : (
                        <details className="acts no-print" open={p.activities.length <= 6}>
                          <summary>{p.activities.length <= 6 ? `${p.activities.length} predmety podnikania` : `${p.activities.slice(0, 3).join("; ")} …`}</summary>
                          <ul>{p.activities.map((a, i) => <li key={i}>{a}</li>)}</ul>
                        </details>
                      )}
                    </dd>
                  </div>
                )}
                {p.formerNames && p.formerNames.length > 0 && (
                  <div style={{ gridColumn: "1 / -1" }}><dt>Predchádzajúce názvy</dt><dd>{p.formerNames.join("; ")}</dd></div>
                )}
              </dl>
            </section>

            {metrics.length > 0 && (
              <section className="card">
                <h2>Hospodárenie (Register účtovných závierok)</h2>
                <table style={{ width: "100%", borderCollapse: "collapse", fontVariantNumeric: "tabular-nums" }}>
                  <thead>
                    <tr style={{ textAlign: "right", color: "var(--muted)", fontSize: 12 }}>
                      <th style={{ textAlign: "left" }}>Ukazovateľ</th>
                      {metrics.map((m) => <th key={m.period}>{m.period}</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {[
                      ["Tržby / čistý obrat", "revenue"],
                      ["Výsledok hospodárenia", "profit"],
                      ["Vlastné imanie", "equity"],
                      ["Záväzky", "liabilities"],
                      ["Aktíva spolu", "totalAssets"],
                    ].map(([l, k]) => (
                      <tr key={k} style={{ borderTop: "1px solid var(--line)" }}>
                        <td style={{ padding: "6px 0" }}>{l}</td>
                        {metrics.map((m) => (
                          <td key={m.period} style={{ textAlign: "right", color: typeof m[k] === "number" && m[k] < 0 ? "var(--crit)" : undefined }}>{eur(m[k])}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </section>
            )}

            {grouped.map(([cat, items]) => (
              <section className="cat" key={cat}>
                <h3>{CATEGORIES[cat]}</h3>
                {items.map((c) => (
                  <article className={`check st-${c.status}`} key={c.id}>
                    <div className="head">
                      <div className="name">
                        {c.name}
                        {c.verifyUrl && refs.byUrl.has(c.verifyUrl) && <sup className="pref">[{refs.byUrl.get(c.verifyUrl)}]</sup>}
                      </div>
                      <div className="src">{c.source} · {c.ai && c.status !== "manual" ? "AI vyhľadávanie" : c.automated ? "automaticky" : "manuálne"} · {new Date(c.checkedAt).toLocaleTimeString("sk-SK")}</div>
                    </div>
                    <span className={`pill s-${c.status}`}>{STATUS_LABEL[c.status]}</span>
                    <div className="sum">{c.summary}</div>
                    {c.findings.filter((f) => f.severity !== "info" || f.text).length > 0 && (
                      <ul>{c.findings.map((f, i) => <li key={i} className={`f-${f.severity}`}>{f.text}</li>)}</ul>
                    )}
                    {aiBadge(c)}
                    <div className="actions">
                      {c.verifyUrl && <a className="verify no-print" href={c.verifyUrl} target="_blank" rel="noreferrer">Overiť v zdroji ↗</a>}
                      {lawyer && (baseChecks.find((o) => o.id === c.id)?.status === "manual" || baseChecks.find((o) => o.id === c.id)?.status === "error") && manualButtons(c)}
                      {retryButton(c)}
                      {aiButton(c)}
                      {aiErr[c.id] && <span className="f-critical">{aiErr[c.id]}</span>}
                    </div>
                  </article>
                ))}
              </section>
            ))}

            {extra.length > 0 && (
              <section className="card no-print">
                <details>
                  <summary style={{ cursor: "pointer", fontWeight: 600 }}>Ďalšie odporúčané overenia – neverejné registre ({extra.length})</summary>
                  <p className="hint">Tieto registre nemajú verejný prístup (spoplatnené alebo bez možnosti automatického overenia). Pri väčších obchodoch odporúčame overiť ich manuálne.</p>
                  <ul className="extra">
                    {extra.map((c) => (
                      <li key={c.id}>
                        <a href={c.verifyUrl} target="_blank" rel="noreferrer">{c.name} ↗</a>
                        <span className="src"> – {c.summary}</span> {aiButton(c)}
                        {aiErr[c.id] && <span className="f-critical"> {aiErr[c.id]}</span>}
                      </li>
                    ))}
                  </ul>
                </details>
              </section>
            )}

            {news && ((news.data as any)?.articles?.length > 0 || (news.data as any)?.rejected?.length > 0 || (news.data as any)?.links) && (
              <section className="card news">
                <h2>Mediálne výstupy – relevantné, od najnovšieho</h2>
                {!((news.data as any)?.articles?.length) && <p className="src">Nenašli sa články, v ktorých by sa uvádzalo meno subjektu.</p>}
                <ul>
                  {((news.data as any)?.articles || []).slice(0, 20).map((a: any, i: number) => (
                    <li key={i}>
                      {a.about && a.about !== "firma" && <span className="pill s-info" style={{ marginRight: 6 }}>{a.about}</span>}
                      <a href={a.link} target="_blank" rel="noreferrer">{a.title || a.link}</a>
                      <span className="src"> · {[a.source || a.domain, a.date ? new Date(a.date).toLocaleDateString("sk-SK") : ""].filter(Boolean).join(" · ")}</span>
                      {a.negative?.length > 0 && <span className="neg">⚠ {a.negative.join(", ")}</span>}
                    </li>
                  ))}
                </ul>
                {((news.data as any)?.rejected || []).length > 0 && (
                  <details className="no-print" style={{ marginTop: 8 }}>
                    <summary className="src" style={{ cursor: "pointer" }}>Ďalšie nájdené výsledky, ktoré sa zrejme netýkajú subjektu ({(news.data as any).rejected.length})</summary>
                    <ul>
                      {((news.data as any).rejected as any[]).map((a, i) => (
                        <li key={i}>
                          <a href={a.link} target="_blank" rel="noreferrer">{a.title || a.link}</a>
                          <span className="src"> · {[a.source, a.date ? new Date(a.date).toLocaleDateString("sk-SK") : ""].filter(Boolean).join(" · ")} · vyradené: {a.reason}</span>
                        </li>
                      ))}
                    </ul>
                  </details>
                )}
                <div className="links no-print">
                  {Object.entries(((news.data as any)?.links || {}) as Record<string, string>).map(([k, u]) => (
                    <a key={k} className="chip" href={u} target="_blank" rel="noreferrer">
                      {{ google: "Google", googleNegative: "Google – negatívne výrazy", finstat: "FinStat", indexPodnikatela: "Index podnikateľa", foaf: "FOAF", crz: "Register zmlúv" }[k] || k} ↗
                    </a>
                  ))}
                </div>
              </section>
            )}

            <section className="card">
              <h2>{lawyer ? "Záver a poznámky povereného zamestnanca" : "Poznámky"}</h2>
              <textarea className="no-print" placeholder={lawyer ? "Doplňujúce zistenia, odporúčania pre klienta…" : "Vaše poznámky k partnerovi (vytlačia sa do protokolu)…"} value={note} onChange={(e) => setNote(e.target.value)} />
              <div className="print-only note-print">{note.trim() || "–"}</div>
              <div className="toolbar">
                <input
                  placeholder="Vypracoval (meno povereného zamestnanca)"
                  value={author}
                  onChange={(e) => { setAuthor(e.target.value); safeSet("author", e.target.value); }}
                  className="no-print"
                />
                <button className="btn no-print" disabled={sealing} onClick={() => sealAndPrint()}>{sealing ? "Pečatím protokol…" : "Uložiť PDF protokol"}</button>
                {seal && (
                  <span className="src no-print">
                    Pečať #{seal.seq} · {new Date(seal.sealedAt).toLocaleString("sk-SK", { dateStyle: "short", timeStyle: "medium" })} · {shortHash(seal.hash)} ·{" "}
                    kód {seal.code} · <a href={`/overit/${seal.scanId}/${seal.code}`} target="_blank" rel="noreferrer">overiť ↗</a>
                  </span>
                )}
                {sealErr && <span className="f-critical no-print">{sealErr}</span>}
                <button className="btn ghost no-print" onClick={() => {
                  const blob = new Blob([JSON.stringify({ ...report, profile, keyFacts: facts, checks, verdict, deal, bank, note, author }, null, 2)], { type: "application/json" });
                  const a = document.createElement("a");
                  a.href = URL.createObjectURL(blob);
                  a.download = `${report.scanId}.json`;
                  a.click();
                }}>Stiahnuť dáta (JSON)</button>
                <button className="btn ghost no-print" onClick={() => run(report.ico)}>Preveriť znova</button>
              </div>
              <div className="print-only sign">
                <div>Vypracoval (poverený zamestnanec): {author || me?.name || "………………………"}</div>
                <div>Dátum a podpis</div>
              </div>
              <div className="print-only seal-print">
                {seal ? (
                  <>
                    <b>Pečať protokolu #{seal.seq}:</b> odtlačok SHA-256 {shortHash(seal.hash)} zapísaný {new Date(seal.sealedAt).toLocaleString("sk-SK", { dateStyle: "long", timeStyle: "medium" })} ·
                    overovací kód <b>{seal.code}</b> · overenie: {DOMAIN}/overit/{seal.scanId}/{seal.code} · úplný odtlačok: <span className="mono">{seal.hash}</span>
                  </>
                ) : (
                  <>Protokol bol vytlačený bez pečate (odtlačok sa nepodarilo zapísať). Čas preverenia je uvedený v hlavičke protokolu.</>
                )}
              </div>
            </section>

            {refs.list.length > 0 && (
              <section className="print-only refs">
                <h2>Odkazy na zdroje</h2>
                <ol>
                  {refs.list.map((r) => (
                    <li key={r.n}>{r.name}: <span className="url">{r.url}</span></li>
                  ))}
                </ol>
              </section>
            )}
            <p className="disclaimer">
              Hodnotenie je automatizovaný súhrn údajov z verejných registrov k uvedenému času preverenia a nenahrádza právne
              posúdenie. Údaje v registroch môžu byť oneskorené{lawyer ? "; kontroly označené ako manuálne je potrebné overiť priamo v zdroji" : ""}.
              Zdroje: RPO (ŠÚ SR), RÚZ (MF SR), OpenData Finančnej správy SR, Sociálna poisťovňa, REPLIK a RPVS (MS SR), Google News.
            </p>
            {lawyer && showManual && openManual > 0 && (
              <div className="modal-bg no-print" role="dialog" aria-modal="true" aria-labelledby="mtitle" onClick={(e) => e.target === e.currentTarget && setShowManual(false)}>
                <div className="modal">
                  <h2 id="mtitle">Overte manuálne – {openManual} {openManual === 1 ? "položka nie je" : openManual < 5 ? "položky nie sú" : "položiek nie je"} verejne dostupných</h2>
                  <p className="hint">Tieto registre sa nedajú overiť automaticky. Otvorte odkaz, skontrolujte subjekt a označte výsledok – verdikt sa hneď prepočíta a zapíše do protokolu.</p>
                  <ul className="mlist">
                    {pendingManual.map((c) => (
                      <li key={c.id} className={answers[c.id] ? "done" : ""}>
                        <div>
                          <b>{c.name}</b>
                          <div className="src">{(report.checks.find((o) => o.id === c.id) || c).summary}</div>
                        </div>
                        <div className="actions">
                          {c.verifyUrl && <a href={c.verifyUrl} target="_blank" rel="noreferrer">Otvoriť ↗</a>}
                          {manualButtons(c)}
                          {aiButton(c)}
                        </div>
                        {aiBadge(c)}
                      </li>
                    ))}
                  </ul>
                  <div className="toolbar">
                    <button className="btn" onClick={() => setShowManual(false)}>{openManual ? "Dokončím neskôr" : "Hotovo"}</button>
                    {report.ai?.available && (
                      <button
                        className="btn ghost"
                        disabled={Object.values(aiBusy).some(Boolean)}
                        onClick={() => profile && pendingManual.filter((c) => aiCapable(c.id) && !answers[c.id]).forEach((c) => runAi(report.checks.find((o) => o.id === c.id)!, report, profile))}
                      >
                        Overiť všetko dostupné cez AI
                      </button>
                    )}
                  </div>
                </div>
              </div>
            )}
          </>
        )}
      </main>
    </>
  );
}
