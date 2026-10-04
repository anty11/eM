import type { Metadata } from "next";
import { PRODUCT, SiteFooter, SiteHeader } from "./components/site/SiteShell";
import { CompareTable } from "./components/site/content";
import { Firms, Hero } from "./components/site/Hero";

export const metadata: Metadata = {
  title: "Obozretne – overenie dodávateľa a odberateľa podľa IČO",
  description:
    "Overenie obchodného partnera vo verejných registroch SR za pol minúty: obchodný register, dane a DPH, poisťovne, konkurzy, závierky, médiá. Protokol o preverení ako doklad náležitej starostlivosti. S odbornou záštitou advokátskych kancelárií URBAN & PARTNERS a LEXNERA Legal.",
  alternates: { canonical: "/" },
};

export default function Home() {
  return (
    <div className="site">
      <SiteHeader active="home" />
      <Hero />

      <section className="s-band" id="preco">
        <div className="s-wrap">
          <div className="s-head">
            <span className="s-eyebrow">Prečo overovať</span>
            <h2>Náležitá starostlivosť je súčasťou podnikania. A dá sa preukázať.</h2>
            <p>
              Právo na odpočet DPH je chránené u podnikateľa, ktorý koná v dobrej viere a prijme opatrenia, ktoré od neho možno rozumne požadovať.
              Kto o problémoch partnera <b>vedel alebo vedieť mal</b>, ochranu stráca – a podľa § 69 ods. 14 zákona o DPH môže <b>ručiť za daň, ktorú dodávateľ nezaplatil</b>.
            </p>
          </div>
          <div className="s-why">
            <blockquote className="s-quote">
              „… hospodárskym subjektom, ktoré prijmú všetky opatrenia, ktoré od nich možno rozumne požadovať, aby sa uistili, že ich plnenia nie
              sú súčasťou podvodu, musí byť umožnené spoľahnúť sa na zákonnosť týchto plnení.“
              <small>Súdny dvor EÚ, Kittel a Recolta Recycling, C‑439/04 a C‑440/04</small>
            </blockquote>
            <div>
              <p style={{ marginTop: 0 }}>
                Správca dane aj súdy sa pýtajú rovnako: <b>čo ste urobili pre to, aby ste svojho partnera poznali – a viete to preukázať?</b>{" "}
                {PRODUCT} odpovedá na obe časti: overením v registroch k presnému času a protokolom, ktorý si založíte k zmluve alebo faktúre.
              </p>
              <a className="s-btn ghost" href="/pravny-zaklad">Právny základ a rozhodnutia súdov →</a>
            </div>
          </div>
        </div>
      </section>

      <section className="s-band alt">
        <div className="s-wrap">
          <div className="s-grid">
            <a className="s-card s-teaser" href="/co-overujeme">
              <span className="s-eyebrow">Čo overujeme</span>
              <h3>Sedemnásť registrov a zdrojov</h3>
              <p>Obchodný register, Finančná správa (dlžníci, DPH, index spoľahlivosti, bankové účty), Sociálna poisťovňa, závierky, konkurzy, RPVS, médiá. Výsledok, skóre a indikátory rizika podľa SKDP.</p>
              <span className="more">Podrobne →</span>
            </a>
            <a className="s-card s-teaser" href="/ako-to-funguje">
              <span className="s-eyebrow">Ako to funguje</span>
              <h3>Štyri kroky, pol minúty</h3>
              <p>Zadáte IČO, registre odpovedajú priebežne, dostanete prehľadný výsledok a uložíte zapečatený protokol. Overenie vykonajú vaši poverení zamestnanci.</p>
              <span className="more">Podrobne →</span>
            </a>
            <a className="s-card s-teaser" href="/pre-koho">
              <span className="s-eyebrow">Pre koho</span>
              <h3>Štyri situácie z praxe</h3>
              <p>Nový dodávateľ, odberateľ na faktúru, pravidelná kontrola stálych partnerov a deň, keď príde daňová kontrola s otázkou, čo ste o partnerovi vedeli.</p>
              <span className="more">Podrobne →</span>
            </a>
          </div>
        </div>
      </section>

      <section className="s-band warm" id="objednat">
        <div className="s-wrap">
          <div className="s-head">
            <span className="s-eyebrow">Objednávka</span>
            <h2>Dve verzie podľa potrieb vašej firmy.</h2>
            <p>Cena závisí od počtu poverených zamestnancov. Po odoslaní objednávky vám do jedného pracovného dňa pošleme ponuku, zmluvu a prístupy do klientskej sekcie.</p>
          </div>
          <CompareTable compact moreHref="/objednavka#porovnanie" />
        </div>
      </section>

      <section className="s-band" id="zastita">
        <div className="s-wrap">
          <div className="s-head">
            <span className="s-eyebrow">O projekte</span>
            <h2>Samostatný projekt s odbornou záštitou dvoch advokátskych kancelárií.</h2>
          </div>
          <Firms />
        </div>
      </section>

      <section className="s-band s-close">
        <div className="s-wrap">
          <div className="s-close-box">
            <div>
              <span className="s-eyebrow">Začnite dnes</span>
              <h2>Prvé preverenie môžete urobiť ešte tento týždeň.</h2>
              <p>Po objednávke vám do jedného pracovného dňa pošleme ponuku a prístupy do klientskej sekcie.</p>
            </div>
            <div className="s-actions">
              <a className="s-btn gold" href="/objednavka">Objednať pre našu firmu</a>
              <a className="s-btn ghost" href="/pravny-zaklad">Právny základ</a>
            </div>
          </div>
        </div>
      </section>
      <SiteFooter />
    </div>
  );
}
