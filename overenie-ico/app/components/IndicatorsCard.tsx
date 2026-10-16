"use client";

import { INDICATORS, type DealInput, type IndicatorAnswer } from "@/lib/deal";

/**
 * Indikátory rizikovosti obchodu – posudzuje poverený zamestnanec podľa priebehu rokovania (z registrov sa zistiť nedajú).
 * Karta je na konci preverenia, pred uložením protokolu. Každý potvrdený indikátor znižuje skóre o uvedený počet bodov;
 * indikátory označené ako závažné (porušovanie predpisov, umelé zapojenie osôb) sú kritické – verdikt je „Neodporúčame“.
 * Podklad: Bulletin SKDP 03/2024 (v rozhraní sa neuvádza).
 */
export default function IndicatorsCard({ deal, onChange }: { deal: DealInput; onChange: (d: DealInput) => void }) {
  const setInd = (id: string, v: IndicatorAnswer) => onChange({ ...deal, indicators: { ...deal.indicators, [id]: deal.indicators[id] === v ? undefined : v } });
  const answered = INDICATORS.filter((i) => deal.indicators[i.id]).length;
  const found = INDICATORS.filter((i) => deal.indicators[i.id] === "found");
  const impact = found.reduce((n, i) => n + i.penalty, 0);
  return (
    <section className="card deal">
      <h2>Indikátory rizikovosti obchodu</h2>
      <p className="hint no-print" style={{ marginTop: 0 }}>
        Posúďte podľa priebehu rokovania – z registrov sa tieto okolnosti zistiť nedajú. Potvrdený indikátor znižuje skóre o uvedený počet bodov;
        závažné indikátory (označené) znamenajú verdikt „Neodporúčame“. Posúdených {answered} z {INDICATORS.length}
        {found.length ? `, potvrdených ${found.length} (vplyv na skóre −${impact} b.)` : ""}.
      </p>
      <ul className="indicators">
        {INDICATORS.map((i) => {
          const a = deal.indicators[i.id];
          return (
            <li key={i.id} className={a === "found" ? "found" : a === "none" ? "clear" : ""}>
              <div>
                <b>
                  {i.no}. {i.title} <span className="src">(−{i.penalty} b.{i.severity === "critical" ? ", závažné" : ""})</span>
                </b>
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
    </section>
  );
}
