"use client";

import { useEffect, useMemo, useState } from "react";
import { applyManual, computeVerdict, type ManualAnswers } from "@/lib/scoring";
import { CATEGORIES, type CategoryId, type CheckResult, type ScanReport } from "@/lib/types";
import Header, { useMe } from "./components/Header";
import ContactCard from "./components/ContactCard";
import KeyFacts from "./components/KeyFacts";
import { MANUAL } from "@/lib/sources/manual";
import { AI_SPECS, aiCapable } from "@/lib/ai/specs";
import { keyFacts as computeKeyFacts } from "@/lib/keyfacts";
import type { CompanyProfile } from "@/lib/types";

const NON_PUBLIC = MANUAL.map((m) => m.id);

const STATUS_LABEL: Record<CheckResult["status"], string> = {
  ok: "Bez záznamu",
  warning: "Upozornenie",
  critical: "Negatívny záznam",
  info: "Informácia",
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
  // Výsledky AI záložného overenia (prepíšu pôvodnú kontrolu) a doplnenia profilu
  const [aiResults, setAiResults] = useState<Record<string, CheckResult>>({});
  const [profilePatch, setProfilePatch] = useState<Partial<CompanyProfile>>({});
  const [aiBusy, setAiBusy] = useState<Record<string, boolean>>({});
  const [aiErr, setAiErr] = useState<Record<string, string>>({});
  const lawyer = me?.mode === "advokat";

  useEffect(() => {
    setRecent(safeGet("recent", []));
    setAuthor(safeGet("author", ""));
    const q = new URLSearchParams(location.search).get("ico");
    if (q) {
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
      const r = await fetch(`/api/check?ico=${v}`);
      if (r.status === 401) {
        location.href = `/login?next=${encodeURIComponent(`/?ico=${v}`)}`;
        return;
      }
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || `Chyba ${r.status}`);
      setReport(j);
      setShowManual(true);
      autoAi(j);
      history.replaceState(null, "", `?ico=${j.ico}`);
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
  const checks = useMemo(() => applyManual(baseChecks, answers), [baseChecks, answers]);
  const profile = useMemo(() => (report ? ({ ...report.profile, ...profilePatch } as CompanyProfile) : null), [report, profilePatch]);
  const facts = useMemo(() => (profile ? computeKeyFacts(profile, checks) : []), [profile, checks]);
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

  /** AI záložné overenie jedného zdroja. */
  async function runAi(check: CheckResult, rep: ScanReport, prof: CompanyProfile) {
    setAiBusy((s) => ({ ...s, [check.id]: true }));
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
        {aiBusy[c.id] ? "AI overuje…" : aiResults[c.id] ? "Overiť cez AI znova" : "Overiť cez AI"}
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

  return (
    <>
      <Header me={me} active="check" />

      <main className="wrap">
        <section className="hero no-print">
          <h1>{lawyer ? "Preverenie subjektu podľa IČO" : "Preverte si obchodného partnera"}</h1>
          <p>
            {lawyer
              ? "Overí subjekt vo verejných registroch, v závierkach a v médiách. Čo nie je verejne dostupné, aplikácia ponúkne na manuálne overenie. Výsledkom je hodnotenie rizika a protokol s časom preverenia."
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
          {loading && (
            <ul className="loading">
              {SOURCES.map((s) => <li key={s}>⏳ {s}</li>)}
              <li>Preverenie trvá zvyčajne 10–30 sekúnd.</li>
            </ul>
          )}
        </section>

        {report && verdict && p && (
          <>
            <div className="print-only print-head">
              <h1>Protokol o preverení obchodného partnera</h1>
              <div>Číslo preverenia: {report.scanId} · Čas preverenia: {fmtDate(report.scannedAt)}{report.scannedBy ? ` · Preveril: ${report.scannedBy}` : ""}</div>
            </div>

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

            {Object.values(aiBusy).some(Boolean) && (
              <div className="ai-running no-print">AI dohľadáva údaje v zdrojoch, ktoré nie sú dostupné cez API ({Object.values(aiBusy).filter(Boolean).length})… Výsledok sa priebežne dopĺňa.</div>
            )}
            <KeyFacts facts={facts} />

            <ContactCard ico={report.ico} profile={p} meEmail={me?.email} />

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
                      <details className="acts no-print" open={p.activities.length <= 6}>
                        <summary>{p.activities.slice(0, 3).join("; ")}{p.activities.length > 3 ? " …" : ""}</summary>
                        <ul>{p.activities.map((a, i) => <li key={i}>{a}</li>)}</ul>
                      </details>
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
                  <article className="check" key={c.id}>
                    <div>
                      <div className="name">{c.name}</div>
                      <div className="src">{c.source} · {c.ai && c.status !== "manual" ? "AI vyhľadávanie" : c.automated ? "automaticky" : "manuálne"} · {new Date(c.checkedAt).toLocaleTimeString("sk-SK")}</div>
                    </div>
                    <span className={`pill s-${c.status}`}>{STATUS_LABEL[c.status]}</span>
                    <div className="sum">{c.summary}</div>
                    {c.findings.filter((f) => f.severity !== "info" || f.text).length > 0 && (
                      <ul>{c.findings.map((f, i) => <li key={i} className={`f-${f.severity}`}>{f.text}</li>)}</ul>
                    )}
                    {aiBadge(c)}
                    <div className="actions">
                      {c.verifyUrl && <a className="verify" href={c.verifyUrl} target="_blank" rel="noreferrer">Overiť v zdroji ↗</a>}
                      {lawyer && (baseChecks.find((o) => o.id === c.id)?.status === "manual" || baseChecks.find((o) => o.id === c.id)?.status === "error") && manualButtons(c)}
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

            {news && ((news.data as any)?.articles?.length > 0 || (news.data as any)?.links) && (
              <section className="card news">
                <h2>Mediálne výstupy – relevantné, od najnovšieho</h2>
                {!((news.data as any)?.articles?.length) && <p className="src">Za posledné 3 roky sa nenašli články, ktoré by sa preukázateľne týkali tohto subjektu.</p>}
                <ul>
                  {((news.data as any)?.articles || []).slice(0, 12).map((a: any, i: number) => (
                    <li key={i}>
                      <a href={a.link} target="_blank" rel="noreferrer">{a.title}</a>
                      <span className="src"> · {[a.source || a.domain, a.date ? new Date(a.date).toLocaleDateString("sk-SK") : ""].filter(Boolean).join(" · ")}</span>
                      {a.negative?.length > 0 && <span className="neg">⚠ {a.negative.join(", ")}</span>}
                    </li>
                  ))}
                </ul>
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
              <h2>{lawyer ? "Záver a poznámky advokáta" : "Poznámky"}</h2>
              <textarea placeholder={lawyer ? "Doplňujúce zistenia, odporúčania pre klienta…" : "Vaše poznámky k partnerovi (vytlačia sa do protokolu)…"} value={note} onChange={(e) => setNote(e.target.value)} />
              <div className="toolbar">
                <input
                  placeholder={lawyer ? "Vypracoval (meno advokáta)" : "Vypracoval (meno)"}
                  value={author}
                  onChange={(e) => { setAuthor(e.target.value); safeSet("author", e.target.value); }}
                  className="no-print"
                />
                <button className="btn no-print" onClick={() => window.print()}>Uložiť PDF protokol</button>
                <button className="btn ghost no-print" onClick={() => {
                  const blob = new Blob([JSON.stringify({ ...report, profile, keyFacts: facts, checks, verdict, note, author }, null, 2)], { type: "application/json" });
                  const a = document.createElement("a");
                  a.href = URL.createObjectURL(blob);
                  a.download = `${report.scanId}.json`;
                  a.click();
                }}>Stiahnuť dáta (JSON)</button>
                <button className="btn ghost no-print" onClick={() => run(report.ico)}>Preveriť znova</button>
              </div>
              <div className="print-only sign">
                <div>Vypracoval: {author || me?.name || me?.email || "………………………"}</div>
                <div>Dátum a podpis</div>
              </div>
            </section>

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
