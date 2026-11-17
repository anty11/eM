"use client";

import { useState, type ReactNode } from "react";
import { WARNING_CAP } from "@/lib/scoring";
import type { CheckResult, CompanyProfile, Finding, Verdict } from "@/lib/types";

/**
 * Panel výsledku preverenia (návrh D, v2.11.35): vľavo skóre so stupnicou a hranicami verdiktu, pod ním verdikt a čo s tým;
 * vpravo „Čo znižuje skóre“ – nálezy s bodovou zrážkou a zdrojom – a riadok zdrojov bez záznamu. Hore firma a stav preverenia.
 * Rovnaký panel je v aplikácii aj v tlačenom protokole (aj v archíve zapečatených protokolov).
 */

/** Hranice verdiktu (lib/scoring.ts): pod 60 Neodporúčame, 60 – 84 S výhradou, od 85 Odporúčame. */
const T_CAUTION = 60;
const T_RECOMMENDED = 85;

/** Krátke názvy zdrojov do riadku „Bez záznamu“. */
const SHORT: Record<string, string> = {
  rpo: "obchodný register",
  ruz: "účtovné závierky",
  "fs-debtors": "daňové dlhy",
  "fs-vat": "DPH",
  "fs-ids": "index daňovej spoľahlivosti",
  "fs-dppo": "daň z príjmov",
  socpoist: "Sociálna poisťovňa",
  insolvency: "konkurz a likvidácia",
  rpvs: "RPVS",
  news: "médiá",
  ov: "Obchodný vestník",
  exek: "exekúcie",
  diskv: "diskvalifikácie",
  uvo: "verejné obstarávanie",
  vszp: "VšZP",
  union: "Union",
  dovera: "Dôvera",
  persons: "prepojenia osôb",
};
const shortName = (c: CheckResult) => SHORT[c.id] || c.name.replace(/\s*\(.*$/, "").toLowerCase();

const plural = (n: number, one: string, few: string, many: string) => (n === 1 ? one : n >= 2 && n <= 4 ? few : many);
const fmtDate = (iso: string) => new Date(iso).toLocaleString("sk-SK", { day: "numeric", month: "numeric", year: "numeric", hour: "2-digit", minute: "2-digit" });

/** Nadpis a doplnok zistenia: „Názov – podrobnosti“ sa rozdelí na dva riadky, kratší text ostáva celý ako nadpis. */
function splitFinding(text: string): { title: string; detail?: string } {
  const i = text.indexOf(" – ");
  if (i >= 12 && i <= 110) return { title: text.slice(0, i), detail: text.slice(i + 3) };
  return { title: text };
}

const LEVEL_SHORT: Record<Verdict["level"], string> = { recommended: "Odporúčame", caution: "S výhradou", not_recommended: "Neodporúčame" };

function Icon({ severity }: { severity: Finding["severity"] }) {
  if (severity === "critical")
    return (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <circle cx="12" cy="12" r="9" />
        <path d="M15 9l-6 6M9 9l6 6" />
      </svg>
    );
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 9v4" />
      <path d="M12 17h.01" />
      <path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" />
    </svg>
  );
}

export default function VerdictPanel({
  verdict,
  checks,
  profile,
  scannedAt,
  scanId,
  asOf,
  incomplete,
  ignore = [],
  onOpenManual,
  onRescan,
  saveHref,
  note,
}: {
  verdict: Verdict;
  checks: CheckResult[];
  profile: Partial<CompanyProfile> & { ico?: string };
  scannedAt: string;
  scanId: string;
  asOf?: string;
  incomplete?: boolean;
  /** kontroly, ktoré sa nezapočítavajú (vo verzii Firma neverejné registre) */
  ignore?: string[];
  onOpenManual?: () => void;
  onRescan?: () => void;
  /** odkaz na sekciu uloženia protokolu (meno povereného zamestnanca + pečať) */
  saveHref?: string;
  note?: ReactNode;
}) {
  const counted = checks.filter((c) => c.id !== "deal" && !ignore.includes(c.id));
  const verified = counted.filter((c) => ["ok", "warning", "critical", "info"].includes(c.status));
  const rows = checks
    .flatMap((c) => c.findings.filter((f) => f.severity === "critical" || f.severity === "warning").map((f) => ({ f, c })))
    .sort((a, b) => (a.f.severity === b.f.severity ? b.f.penalty - a.f.penalty : a.f.severity === "critical" ? -1 : 1));
  const nCrit = rows.filter((r) => r.f.severity === "critical").length;
  const nWarn = rows.length - nCrit;
  const warnSum = rows.filter((r) => r.f.severity === "warning").reduce((s, r) => s + Math.max(0, r.f.penalty), 0);
  const positives = checks.flatMap((c) => c.findings.filter((f) => f.severity === "positive"));
  const clean = counted.filter((c) => c.status === "ok").map(shortName);
  const capFinding = checks.flatMap((c) => c.findings).find((f) => f.cap === "caution");
  /** na obrazovke najprv 3 zistenia (celý výsledok bez posúvania), rozbaliť do 5; v tlači vždy 5 */
  const SHOWN = 5;
  const FIRST = 3;
  const [expanded, setExpanded] = useState(false);

  const missing = Math.max(0, T_RECOMMENDED - verdict.score);
  const advice =
    verdict.level === "recommended"
      ? `Spoluprácu odporúčame – v sledovaných registroch nie sú negatívne záznamy${nWarn ? "; upozornenia vpravo si overte" : ""}.`
      : verdict.level === "caution"
        ? `Spolupráca je možná – podmieňte ju vysvetlením zistení vpravo.${capFinding ? ` Verdikt obmedzuje: ${splitFinding(capFinding.text).title.toLowerCase()}.` : missing ? ` Do „Odporúčame“ ${plural(missing, "chýba", "chýbajú", "chýba")} ${missing} ${plural(missing, "bod", "body", "bodov")}.` : ""}`
        : nCrit
          ? "Spoluprácu neodporúčame – zistený závažný negatívny záznam. Pred obchodom sa poraďte s advokátom."
          : "Spoluprácu neodporúčame – zistenia spolu prekročili hranicu rizika.";

  return (
    <section className={`card vpanel ${verdict.level}`}>
      <header className="vp-top">
        <div className="vp-co">
          <h2 className="vp-name">{profile.name || "Neznámy subjekt"}</h2>
          <span className="vp-sub">
            IČO {profile.ico}
            {profile.address ? ` · ${profile.address}` : ""}
            {profile.established ? ` · v registri od ${String(profile.established).slice(0, 4)}` : ""}
          </span>
        </div>
        <div className="vp-pills">
          <span className="vp-pill">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="var(--ok)" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5" /></svg>
            {verified.length} / {counted.length} zdrojov
          </span>
          {verdict.preliminary ? (
            onOpenManual ? (
              <button type="button" className="vp-pill vp-pill-amber" onClick={onOpenManual}>
                <span className="vp-dot" /> Predbežné · {verdict.pendingManual} manuálne
              </button>
            ) : (
              <span className="vp-pill vp-pill-amber"><span className="vp-dot" /> Predbežné · {verdict.pendingManual} manuálne</span>
            )
          ) : (
            <span className="vp-pill">Konečné hodnotenie</span>
          )}
          <span className="vp-meta">{fmtDate(scannedAt)} · {scanId}{asOf ? ` · spätne k ${new Date(asOf).toLocaleDateString("sk-SK")}` : ""}</span>
        </div>
      </header>

      <div className="vp-body">
        <div className="vp-score">
          <div className="vp-score-top">
            <span className="vp-eyebrow">Skóre dôveryhodnosti</span>
            <div className="vp-num">
              <b>{verdict.score}</b>
              <span>/100</span>
            </div>
            <div className="vp-scale" role="img" aria-label={`Skóre ${verdict.score} zo 100; hranica S výhradou ${T_CAUTION}, Odporúčame ${T_RECOMMENDED}`}>
              <div className="vp-track">
                <i style={{ flex: T_CAUTION }} />
                <i style={{ flex: T_RECOMMENDED - T_CAUTION }} />
                <i style={{ flex: 100 - T_RECOMMENDED }} />
              </div>
              <div className="vp-fill" style={{ width: `${verdict.score}%` }} />
              <div className="vp-mark" style={{ left: `${verdict.score}%` }} />
            </div>
            <div className="vp-ticks">
              <span>0</span>
              <span style={{ left: `${T_CAUTION}%` }}>{T_CAUTION}</span>
              <span style={{ left: `${T_RECOMMENDED}%` }}>{T_RECOMMENDED}</span>
              <span>100</span>
            </div>
          </div>
          <div className="vp-verdict">
            <div className="vp-level">
              <span className="vp-sq" />
              {LEVEL_SHORT[verdict.level]}
            </div>
            <p>{advice}</p>
          </div>
        </div>

        <div className="vp-why">
          <div className="vp-why-head">
            <span className="vp-eyebrow">{rows.length ? "Čo znižuje skóre" : "Čo ovplyvnilo skóre"}</span>
            <span className="vp-count">
              {nWarn} {plural(nWarn, "upozornenie", "upozornenia", "upozornení")} · {nCrit} {plural(nCrit, "kritický", "kritické", "kritických")}
            </span>
          </div>

          {rows.length ? (
            <ul className="vp-rows">
              {rows.slice(0, SHOWN).map(({ f, c }, i) => {
                const { title, detail } = splitFinding(f.text);
                return (
                  <li key={i} className={`vp-row ${f.severity}${i >= FIRST && !expanded ? " vp-extra" : ""}`}>
                    <span className="vp-ic"><Icon severity={f.severity} /></span>
                    <div className="vp-txt">
                      <b>{title}</b>
                      <span>
                        {detail ? `${detail} · ` : ""}
                        {c.verifyUrl ? (
                          <a href={c.verifyUrl} target="_blank" rel="noreferrer">{c.name}</a>
                        ) : (
                          c.name
                        )}
                      </span>
                    </div>
                    <span className="vp-pen">{f.penalty > 0 ? `−${f.penalty}` : ""}</span>
                  </li>
                );
              })}
              {rows.length > FIRST && (
                <li className="vp-toggle no-print">
                  <button type="button" className="linkbtn" onClick={() => setExpanded((x) => !x)} aria-expanded={expanded}>
                    {expanded ? "Zobraziť menej" : `Zobraziť ďalšie zistenia (${Math.min(rows.length, SHOWN) - FIRST})`}
                  </button>
                </li>
              )}
              {rows.length > SHOWN && (
                <li className={`vp-more${expanded ? "" : " vp-extra"}`}>
                  + {rows.length - SHOWN} {plural(rows.length - SHOWN, "ďalšie zistenie", "ďalšie zistenia", "ďalších zistení")} pri jednotlivých kontrolách nižšie
                </li>
              )}
            </ul>
          ) : (
            <div className="vp-none">
              Skóre neznižuje žiadne zistenie.
              {positives.length ? <span> {positives.slice(0, 2).map((p) => p.text).join(" · ")}</span> : null}
            </div>
          )}
          {warnSum > WARNING_CAP && <div className="vp-capnote">Upozornenia sa do skóre započítavajú spolu najviac −{WARNING_CAP} bodov.</div>}

          {clean.length > 0 && (
            <div className="vp-clean">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--ok)" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5" /></svg>
              <span>Bez záznamu: {clean.join(", ")}</span>
            </div>
          )}

          {incomplete && <div className="vp-warnbox">Preverenie sa nedokončilo – spojenie so serverom sa prerušilo. Nedokončené zdroje sú označené ako nedostupné; odporúčame „Preveriť znova“.</div>}
          {note}

          {(onOpenManual || onRescan || saveHref) && (
            <div className="vp-actions no-print">
              {verdict.preliminary && verdict.pendingManual > 0 && onOpenManual ? (
                <button type="button" className="linkbtn" onClick={onOpenManual}>
                  {verdict.pendingManual} {plural(verdict.pendingManual, "kontrola čaká", "kontroly čakajú", "kontrol čaká")} na manuálne overenie
                </button>
              ) : (
                <span />
              )}
              <div className="vp-btns">
                {onRescan && <button type="button" className="btn ghost" onClick={onRescan} title="Obíde uložené výsledky a položí všetky dopyty do registrov nanovo">Preveriť znova</button>}
                {saveHref && <a className="btn" href={saveHref}>Uložiť protokol PDF</a>}
              </div>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
