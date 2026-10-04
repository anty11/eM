import { FIRMS } from "./SiteShell";

/** Úvodný blok s ukážkou protokolu – spoločný pre úvodnú stranu a jej náhľad. */
export function Hero({ lead }: { lead?: string }) {
  const u = FIRMS.urban;
  const l = FIRMS.lexnera;
  return (
      <section className="s-hero">
        <div className="s-wrap">
          <div>
            <span className="s-eyebrow">Overenie obchodného partnera</span>
            <h1>Obchodujte obozretne. Partnera preveríte rýchlo, spoľahlivo a s protokolom.</h1>
            <p className="s-lead">
              {lead ?? "Zadáte IČO a do pol minúty máte prehľad o dodávateľovi alebo odberateľovi: obchodný register, dane a DPH, poisťovne, konkurzy, účtovné závierky aj médiá. Výsledkom je protokol s časom preverenia – doklad náležitej starostlivosti, akú od podnikateľov očakáva judikatúra Súdneho dvora EÚ."}
            </p>
            <div className="s-actions">
              <a className="s-btn gold" href="/objednavka">Objednať pre našu firmu</a>
              <a className="s-btn light" href="/login">Klientska sekcia</a>
            </div>
            <p className="s-note">
              Overenie vykonáva vaša spoločnosť sama prostredníctvom poverených zamestnancov. Odbornú záštitu nad obsahom overenia poskytujú advokátske
              kancelárie {u.short} a {l.short}.
            </p>
          </div>
          <div className="s-proto" aria-hidden>
            <div className="ph">
              <span>Protokol o preverení</span>
              <small>stav k dnešnému dňu</small>
            </div>
            <div className="verdict">
              <div className="ring">96</div>
              <div>
                <div className="vl">ODPORÚČAME – bezpečný partner</div>
                <small style={{ color: "var(--s-muted)" }}>Vzorová spoločnosť, s.r.o. · IČO 12 345 678</small>
              </div>
            </div>
            <ul>
              <li><span>Zoznam daňových dlžníkov</span><span className="pill ok">bez záznamu</span></li>
              <li><span>Platiteľ DPH · dôvody na zrušenie</span><span className="pill ok">registrovaný</span></li>
              <li><span>Dlžníci Sociálnej poisťovne</span><span className="pill ok">bez záznamu</span></li>
              <li><span>Konkurz · likvidácia</span><span className="pill ok">bez konania</span></li>
              <li><span>Účtovná závierka 2025</span><span className="pill ok">uložená</span></li>
              <li><span>Zmena konateľa pred 40 dňami</span><span className="pill warn">upozornenie</span></li>
            </ul>
          </div>
        </div>
      </section>
  );
}

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
