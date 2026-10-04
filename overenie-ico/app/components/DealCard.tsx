"use client";

import { useEffect, useRef, useState } from "react";
import type { BankAccountResult, DealInput, IndicatorAnswer } from "@/lib/deal";
import { INDICATORS, ibanValid, normalizeIban, regulatedFor, subjectMatchesActivities } from "@/lib/deal";
import type { CompanyProfile } from "@/lib/types";

export const EMPTY_DEAL: DealInput = { direction: "buy", subject: "", iban: "", value: "", indicators: {} };

/**
 * Údaje o konkrétnom obchode a indikátory rizika podľa Bulletinu SKDP 03/2024.
 * Poverený zamestnanec zadá predmet obchodu a účet partnera (automaticky sa porovnajú s registrom a zoznamom FS)
 * a posúdi indikátory, ktoré z registrov zistiť nemožno. Všetko sa zapíše do protokolu a vstupuje do verdiktu.
 */
export default function DealCard({
  ico,
  profile,
  deal,
  onChange,
  bank,
  onBank,
}: {
  ico: string;
  profile: CompanyProfile;
  deal: DealInput;
  onChange: (d: DealInput) => void;
  bank: BankAccountResult | null;
  onBank: (b: BankAccountResult | null) => void;
}) {
  const [busy, setBusy] = useState(false);
  const lastIban = useRef<string>("");
  const set = <K extends keyof DealInput>(k: K, v: DealInput[K]) => onChange({ ...deal, [k]: v });
  const setInd = (id: string, v: IndicatorAnswer) => onChange({ ...deal, indicators: { ...deal.indicators, [id]: deal.indicators[id] === v ? undefined : v } });

  const iban = normalizeIban(deal.iban);
  const validIban = iban.length > 0 && ibanValid(iban);
  const match = deal.subject.trim() ? subjectMatchesActivities(deal.subject, profile.activities || [], profile.mainActivity) : null;
  const regulated = deal.subject.trim() ? regulatedFor(deal.subject) : [];
  const answered = INDICATORS.filter((i) => deal.indicators[i.id]).length;
  const found = INDICATORS.filter((i) => deal.indicators[i.id] === "found").length;

  // overenie účtu v zozname FS – po dopísaní platného IBAN (s odstupom)
  useEffect(() => {
    if (!validIban || iban === lastIban.current) return;
    const t = setTimeout(async () => {
      lastIban.current = iban;
      setBusy(true);
      try {
        const r = await fetch("/api/check/iban", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ico, iban, profile }) });
        onBank(r.ok ? await r.json() : { status: "unknown", message: `Overenie zlyhalo (${r.status}).` });
      } catch {
        onBank({ status: "unknown", message: "Overenie účtu zlyhalo – skúste znova." });
      } finally {
        setBusy(false);
      }
    }, 700);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [iban, validIban, ico]);
  useEffect(() => {
    if (!validIban) {
      lastIban.current = "";
      if (bank) onBank(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [validIban]);

  const bankTone = bank?.status === "listed" ? "f-positive" : bank?.status === "not_listed" ? "f-critical" : "src";

  return (
    <section className="card deal">
      <h2>Údaje o obchode a indikátory rizika</h2>
      <p className="hint no-print" style={{ marginTop: 0 }}>
        Čo s partnerom obchodujete a na aký účet platíte – aplikácia to porovná s registrom a so zoznamom bankových účtov Finančnej správy.
        Indikátory nižšie z registrov zistiť nemožno; posúďte ich podľa priebehu rokovania. Všetko sa zapíše do protokolu s vaším menom a časom.
      </p>

      <div className="no-print">
        <div className="contact-grid">
          <div className="field">
            <label htmlFor="deal-dir">Smer obchodu</label>
            <select id="deal-dir" value={deal.direction} onChange={(e) => set("direction", e.target.value as DealInput["direction"])}>
              <option value="buy">Nakupujeme od partnera (dodávateľ)</option>
              <option value="sell">Dodávame partnerovi (odberateľ)</option>
            </select>
          </div>
          <div className="field">
            <label htmlFor="deal-subject">Predmet obchodu (tovar / služba)</label>
            <input id="deal-subject" value={deal.subject} onChange={(e) => set("subject", e.target.value)} placeholder="napr. stavebné práce, IT služby, kovový odpad, pohonné látky" />
          </div>
          <div className="field">
            <label htmlFor="deal-iban">IBAN partnera z faktúry / zmluvy</label>
            <input id="deal-iban" value={deal.iban} onChange={(e) => set("iban", e.target.value)} placeholder="SK.. .... .... .... .... ...." style={{ fontVariantNumeric: "tabular-nums" }} />
          </div>
          <div className="field">
            <label htmlFor="deal-value">Hodnota obchodu (nepovinné)</label>
            <input id="deal-value" value={deal.value} onChange={(e) => set("value", e.target.value)} placeholder="napr. 25 000 € / rámcová zmluva" />
          </div>
        </div>
        {match && (
          <p className={`hint ${match.match ? "f-positive" : "f-warning"}`} style={{ marginTop: 4 }}>
            {match.match
              ? "✓ Predmet obchodu zodpovedá predmetu podnikania partnera v registri."
              : profile.activities?.length || profile.mainActivity
                ? "Pozor: predmet obchodu sa nezhoduje s predmetom podnikania zapísaným v registri – overte, či ide o etablovanú činnosť partnera (indikátor i / ix)."
                : "Predmet podnikania partnera nie je k dispozícii – porovnanie nie je možné."}
          </p>
        )}
        {regulated.length > 0 && (
          <ul className="hint" style={{ margin: "4px 0 0", paddingLeft: 18 }}>
            {regulated.map((r) => (
              <li key={r.what}>
                Regulovaná činnosť ({r.what}) – overte povolenie / zápis: <a href={r.url} target="_blank" rel="noreferrer">{r.where} ↗</a>
              </li>
            ))}
          </ul>
        )}
        {iban.length > 0 && (
          <p className={`hint ${validIban ? bankTone : "f-warning"}`} style={{ marginTop: 4 }}>
            {!validIban
              ? "IBAN nie je platný (kontrolný súčet) – skontrolujte číslo."
              : busy
                ? "Overujem účet v zozname bankových účtov Finančnej správy…"
                : bank
                  ? `${bank.status === "listed" ? "✓ " : bank.status === "not_listed" ? "✕ " : ""}${bank.message}${bank.status === "not_listed" ? " Platba na neoznámený účet zakladá ručenie za DPH (§ 69 ods. 14 písm. c) ZDPH)." : ""}`
                  : ""}
            {bank?.verifyUrl && bank.status !== "listed" && (
              <> <a href={bank.verifyUrl} target="_blank" rel="noreferrer">zoznamy FS ↗</a></>
            )}
          </p>
        )}

        <div className="field" style={{ marginTop: 14 }}>
          <label>Indikátory rizikovosti obchodu (Bulletin SKDP 03/2024) – posúdených {answered} z {INDICATORS.length}{found ? `, potvrdených ${found}` : ""}</label>
          <ul className="indicators">
            {INDICATORS.map((i) => {
              const a = deal.indicators[i.id];
              return (
                <li key={i.id} className={a === "found" ? "found" : a === "none" ? "clear" : ""}>
                  <div>
                    <b>({i.no}) {i.title}</b>
                    <div className="src">{i.hint}</div>
                  </div>
                  <div className="row-actions">
                    <button type="button" className={`mbtn ${a === "none" ? "on-clean" : ""}`} onClick={() => setInd(i.id, "none")}>Bez indikácie</button>
                    <button type="button" className={`mbtn ${a === "found" ? "on-found" : ""}`} onClick={() => setInd(i.id, "found")}>Indikácia potvrdená</button>
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      </div>

      {/* tlač – kompaktný prehľad (nálezy sú v riadku kontroly „Údaje o obchode a indikátory rizika“) */}
      <div className="print-only deal-print">
        <span><b>Smer:</b> {deal.direction === "buy" ? "nakupujeme (dodávateľ)" : "dodávame (odberateľ)"}</span>
        <span><b>Predmet obchodu:</b> {deal.subject.trim() || "–"}</span>
        <span><b>Hodnota:</b> {deal.value.trim() || "–"}</span>
        <span className="wide"><b>Účet partnera:</b> {iban || "–"}{iban ? (!validIban ? " · neplatný IBAN" : bank ? ` · ${bank.message}` : "") : ""}</span>
        <span className="wide">
          <b>Indikátory SKDP 03/2024:</b>{" "}
          {INDICATORS.map((i, k) => {
            const a = deal.indicators[i.id];
            return (
              <span key={i.id} className={a === "found" ? "f-critical" : ""}>
                {k > 0 ? " · " : ""}({i.no}) {i.title.toLowerCase()}: {a === "found" ? "POTVRDENÁ" : a === "none" ? "bez indikácie" : "neposúdené"}
              </span>
            );
          })}
        </span>
      </div>
    </section>
  );
}
