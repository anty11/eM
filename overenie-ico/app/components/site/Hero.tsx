import { FIRMS } from "./SiteShell";

/** Úvodný blok s ukážkou protokolu – spoločný pre úvodnú stranu a jej náhľad. */
export function Hero({ lead }: { lead?: string }) {
  return (
      <section className="s-hero">
        <div className="s-wrap">
          <div>
            <span className="s-eyebrow">Overenie obchodného partnera</span>
            <h1>Obchodujte obozretne.<span className="s-h1-sub">Partnera preveríte rýchlo, spoľahlivo a s protokolom.</span></h1>
            <p className="s-lead">
              {lead ?? "Zadáte IČO a do pol minúty viete, s kým obchodujete: obchodný register, dane a DPH, poisťovne, konkurzy, závierky aj médiá. Výsledkom je protokol s časom preverenia – doklad vašej náležitej starostlivosti."}
            </p>
            <div className="s-actions">
              <a className="s-btn gold" href="/objednavka">Objednať pre našu firmu</a>
              <a className="s-btn light" href="/login">Klientska sekcia</a>
            </div>
            <ul className="s-stats">
              <li><b>17</b><span>registrov a zdrojov</span></li>
              <li><b>10 – 30 s</b><span>trvá jedno preverenie</span></li>
              <li><b>SHA-256</b><span>pečať a verejné overenie protokolu</span></li>
            </ul>
          </div>
          <div className="s-vp" aria-hidden>
            <div className="s-vp-top">
              <div>
                <b>Vzorová spoločnosť, s.r.o.</b>
                <small>IČO 12 345 678 · v registri od 2014</small>
              </div>
              <span className="s-vp-pill">✓ 17 / 17 zdrojov</span>
            </div>
            <div className="s-vp-body">
              <div className="s-vp-score">
                <span className="s-vp-eyebrow">Skóre dôveryhodnosti</span>
                <div className="s-vp-num"><b>84</b><span>/100</span></div>
                <div className="s-vp-scale"><i /><i /><i /><em style={{ width: "84%" }} /></div>
                <div className="s-vp-ticks"><span>0</span><span>60</span><span>85</span></div>
                <div className="s-vp-level caution"><span />S výhradou</div>
                <small className="s-vp-advice">Vyžiadajte si chýbajúcu závierku.</small>
              </div>
              <div className="s-vp-why">
                <span className="s-vp-eyebrow">Čo znižuje skóre</span>
                <div className="s-vp-row">
                  <span className="s-vp-ic">!</span>
                  <div><b>Chýba účtovná závierka za rok 2025</b><small>posledná uložená je za 2024 · Register účtovných závierok</small></div>
                  <span className="s-vp-pen">−15</span>
                </div>
                <div className="s-vp-clean"><span>✓</span>Bez záznamu: daňové dlhy, DPH, Sociálna poisťovňa, konkurz a likvidácia, exekúcie, médiá</div>
              </div>
            </div>
          </div>
        </div>
        <div className="s-wrap s-sources" aria-label="Zdroje údajov">
          <span>Údaje priamo zo zdrojov</span>
          <ul>
            {SOURCES.map((x) => <li key={x}>{x}</li>)}
          </ul>
        </div>
      </section>
  );
}

/** Inštitúcie, z ktorých registrov preverenie čerpá (pás pod úvodom). */
const SOURCES = ["Štatistický úrad SR", "Finančná správa SR", "Sociálna poisťovňa", "Ministerstvo spravodlivosti SR", "Register účtovných závierok", "Obchodný vestník", "Úrad pre verejné obstarávanie", "zdravotné poisťovne"];

/** Karty advokátskych kancelárií s odbornou záštitou – len popis a odkaz na web. */
export function Firms() {
  const u = FIRMS.urban;
  const l = FIRMS.lexnera;
  return (
          <div className="s-firms">
            <div className="s-firm urban">
              <div className="logo">URBAN<span>&amp;</span>PARTNERS<em>LAW FIRM</em></div>
              <div className="tag">{u.tagline}</div>
              <p>{u.about}</p>
              <div className="meta"><a href={u.web} target="_blank" rel="noreferrer">{u.webLabel} →</a></div>
            </div>
            <div className="s-firm lexnera">
              <div className="logo">LEXNERA<span>LEGAL</span></div>
              <div className="tag">{l.tagline}</div>
              <p>{l.about}</p>
              <div className="meta"><a href={l.web} target="_blank" rel="noreferrer">{l.webLabel} →</a></div>
            </div>
          </div>
  );
}
