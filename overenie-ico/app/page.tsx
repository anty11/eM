import type { Metadata } from "next";
import { FIRMS, PRODUCT, SiteFooter, SiteHeader } from "./components/site/SiteShell";

export const metadata: Metadata = {
  title: "Preverto – overenie dodávateľa a odberateľa podľa IČO",
  description:
    "Overenie obchodného partnera vo verejných registroch SR za pol minúty: obchodný register, dane a DPH, poisťovne, konkurzy, závierky, médiá. Protokol o preverení ako doklad náležitej starostlivosti. S odbornou záštitou advokátskych kancelárií URBAN & PARTNERS a LEXNERA Legal.",
  alternates: { canonical: "/" },
};

const REGISTERS: { name: string; src: string }[] = [
  { name: "Obchodný register a Register právnických osôb", src: "Štatistický úrad SR, Ministerstvo spravodlivosti SR" },
  { name: "Zoznam daňových dlžníkov", src: "Finančná správa SR" },
  { name: "Registrácia pre DPH a zoznam platiteľov s dôvodmi na zrušenie registrácie", src: "Finančná správa SR, EÚ VIES" },
  { name: "Index daňovej spoľahlivosti", src: "Finančná správa SR" },
  { name: "Podanie daňového priznania k dani z príjmov", src: "Finančná správa SR" },
  { name: "Register účtovných závierok – tržby, zisk, vlastné imanie, záväzky", src: "Ministerstvo financií SR" },
  { name: "Dlžníci Sociálnej poisťovne", src: "Sociálna poisťovňa" },
  { name: "Konkurz, reštrukturalizácia, likvidácia", src: "Register úpadcov REPLIK" },
  { name: "Register partnerov verejného sektora a koneční užívatelia výhod", src: "Ministerstvo spravodlivosti SR" },
  { name: "Médiá a internet – správy o spoločnosti a jej štatutároch", src: "slovenské spravodajské weby" },
  { name: "Vek spoločnosti, zmeny vlastníkov a štatutárov, predmet podnikania", src: "Obchodný register" },
  { name: "Kontrolný zoznam neverejných registrov (exekúcie, zdravotné poisťovne, Obchodný vestník, diskvalifikácie)", src: "na manuálne overenie" },
];

const FEATURES: { name: string; note?: string; ext: boolean; std: boolean }[] = [
  { name: "Všetkých 10 automatických zdrojov", note: "obchodný register, Finančná správa, Sociálna poisťovňa, závierky, konkurzy, RPVS, médiá", ext: true, std: true },
  { name: "Výsledok, skóre a 9 kľúčových otázok k partnerovi", ext: true, std: true },
  { name: "PDF protokol s časovou pečiatkou a menom zamestnanca", ext: true, std: true },
  { name: "Databáza preverených spoločností s pripomienkou po 180 dňoch", ext: true, std: true },
  { name: "Karta kontaktu", note: "s kým u partnera komunikujete a kto od vás", ext: true, std: true },
  { name: "Neobmedzený počet preverení", ext: true, std: true },
  { name: "Kontrolný zoznam neverejných registrov so zápisom výsledku do protokolu", note: "exekúcie, zdravotné poisťovne, Obchodný vestník, diskvalifikácie, verejné obstarávanie", ext: true, std: false },
  { name: "Prepočet výsledku po manuálnom overení povereným zamestnancom", ext: true, std: false },
  { name: "Voliteľné AI dohľadanie údajov v zdrojoch bez rozhrania", ext: true, std: false },
  { name: "Úvodné školenie poverených zamestnancov", ext: true, std: false },
  { name: "Zvýhodnená konzultácia s advokátom pri rizikovom náleze", ext: true, std: false },
];

export default function Home() {
  const u = FIRMS.urban;
  const l = FIRMS.lexnera;
  return (
    <div className="site">
      <SiteHeader active="home" />

      <section className="s-hero">
        <div className="s-wrap">
          <div>
            <span className="s-eyebrow">Overenie obchodného partnera</span>
            <h1>Prever to. Obchodného partnera preveríte rýchlo, spoľahlivo a s protokolom.</h1>
            <p className="s-lead">
              Zadáte IČO a do pol minúty máte prehľad o dodávateľovi alebo odberateľovi: obchodný register, dane a DPH, poisťovne, konkurzy,
              účtovné závierky aj médiá. Výsledkom je protokol s časom preverenia – doklad náležitej starostlivosti, akú od podnikateľov
              očakáva judikatúra Súdneho dvora EÚ.
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

      <section className="s-band" id="preco">
        <div className="s-wrap">
          <div className="s-law">
            <div>
              <span className="s-eyebrow">Prečo overovať</span>
              <h2>Náležitá starostlivosť je súčasťou podnikania. A dá sa preukázať.</h2>
              <p style={{ marginTop: 14 }}>
                Podľa ustálenej judikatúry Súdneho dvora EÚ je právo na odpočet DPH chránené u podnikateľa, ktorý koná v dobrej viere a prijme
                opatrenia, ktoré od neho možno rozumne požadovať. Kto o problémoch svojho partnera <b>vedel alebo vedieť mal</b>, túto ochranu stráca.
                Slovenský zákon o DPH na to nadväzuje v § 69 ods. 14: odberateľ môže <b>ručiť za daň, ktorú dodávateľ nezaplatil</b>, ak dôvody
                na opatrnosť boli zistiteľné – napríklad z verejných zoznamov Finančnej správy.
              </p>
              <blockquote className="s-quote">
                „… hospodárskym subjektom, ktoré prijmú všetky opatrenia, ktoré od nich možno rozumne požadovať, aby sa uistili, že ich plnenia nie
                sú súčasťou podvodu, musí byť umožnené spoľahnúť sa na zákonnosť týchto plnení bez toho, aby riskovali stratu svojho práva na odpočet.“
                <small>Súdny dvor EÚ, Kittel a Recolta Recycling, C‑439/04 a C‑440/04; potvrdené v Mahagében a Dávid, C‑80/11 a C‑142/11</small>
              </blockquote>
              <p>
                Správca dane aj slovenské súdy sa pri kontrole pýtajú rovnako: <b>čo ste urobili pre to, aby ste svojho partnera poznali, a viete to
                preukázať?</b> {PRODUCT} odpovedá na obe časti – overením v registroch k presnému času a protokolom, ktorý si založíte k zmluve alebo faktúre.
              </p>
              <a className="s-btn ghost" href="/pravny-zaklad">Právny základ podrobne →</a>
            </div>
            <ul className="s-cases">
              <li><b>Kittel a Recolta Recycling (C‑439/04, C‑440/04)</b><span>Odpočet možno odoprieť, ak platiteľ vedel alebo mal vedieť, že sa plnením zúčastňuje na podvode.</span></li>
              <li><b>Mahagében a Dávid (C‑80/11, C‑142/11)</b><span>Dôkazné bremeno nesie správca dane; od podnikateľa sa očakáva obozretnosť primeraná okolnostiam.</span></li>
              <li><b>PPUH Stehcemp (C‑277/14), Vikingo (C‑610/19), Ferimet (C‑281/20)</b><span>Formálne nedostatky dodávateľa samy osebe neprekážajú – rozhoduje, čo odberateľ vedel a mohol zistiť.</span></li>
              <li><b>Aquila Part Prod Com (C‑512/21)</b><span>Náležitú starostlivosť nemožno preniesť na iného; platiteľ má vedieť preukázať vlastné overenie partnera.</span></li>
              <li><b>§ 69 ods. 14 a 15 zákona č. 222/2004 Z. z. o DPH</b><span>Ručenie odberateľa za nezaplatenú daň, ak „vedel alebo vedieť mal a mohol“ – napr. pri partnerovi zo zverejneného zoznamu Finančnej správy.</span></li>
            </ul>
          </div>
        </div>
      </section>

      <section className="s-band alt" id="co">
        <div className="s-wrap">
          <div className="s-head">
            <span className="s-eyebrow">Čo overujeme</span>
            <h2>Sedemnásť zdrojov, jeden prehľadný výsledok.</h2>
            <p>Všetky údaje pochádzajú z oficiálnych verejných registrov Slovenskej republiky a EÚ. Každý nález má odkaz na zdroj, kde si ho môžete overiť. Prioritou je priamy dodávateľ a odberateľ.</p>
          </div>
          <ul className="s-regs">
            {REGISTERS.map((r) => (
              <li key={r.name}>
                <span>
                  {r.name}
                  <small>{r.src}</small>
                </span>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section className="s-band">
        <div className="s-wrap">
          <div className="s-head">
            <span className="s-eyebrow">Ako to funguje</span>
            <h2>Overenie vykoná vaša spoločnosť sama. Trvá pol minúty.</h2>
            <p>Nie je potrebný externý poradca – overenie vykonajú vaši poverení zamestnanci priamo v klientskej sekcii. Každé preverenie je zaznamenané: kto, kedy a s akým výsledkom.</p>
          </div>
          <div className="s-steps">
            <div className="s-step"><h3>Zadáte IČO</h3><p>Dodávateľa, odberateľa alebo iného partnera. Stačí IČO – názov, DIČ a IČ DPH si aplikácia doplní z registrov.</p></div>
            <div className="s-step"><h3>Registre odpovedajú priebežne</h3><p>Výsledky sa zobrazujú, ako jednotlivé registre odpovedajú. Celé preverenie trvá zvyčajne 10 – 30 sekúnd.</p></div>
            <div className="s-step"><h3>Dostanete prehľadný výsledok</h3><p>Odporúčame · S výhradou · Neodporúčame, so skóre a odpoveďami na kľúčové otázky: podaná závierka, likvidácia, nedoplatky, spoľahlivý platiteľ DPH, zmeny vlastníkov.</p></div>
            <div className="s-step"><h3>Uložíte protokol</h3><p>Dvojstranový PDF protokol s časom preverenia, menom zamestnanca a odkazmi na zdroje. Spoločnosť sa uloží do databázy preverení s pripomienkou po 180 dňoch.</p></div>
          </div>
        </div>
      </section>

      <section className="s-band dark">
        <div className="s-wrap">
          <div className="s-head">
            <span className="s-eyebrow">Pre koho</span>
            <h2>Pre každú firmu, ktorá nakupuje alebo predáva.</h2>
            <p>Od prvej objednávky u nového dodávateľa po pravidelnú kontrolu stálych partnerov.</p>
          </div>
          <div className="s-grid four">
            <div className="s-card"><div className="num">1</div><h3>Nový dodávateľ</h3><p>Pred prvou objednávkou alebo zmluvou. Protokol založíte k zmluve ako doklad náležitej starostlivosti.</p></div>
            <div className="s-card"><div className="num">2</div><h3>Odberateľ na faktúru</h3><p>Pred dodaním tovaru alebo služby s odloženou splatnosťou – nedoplatky, konkurz a záporné imanie uvidíte vopred.</p></div>
            <div className="s-card"><div className="num">3</div><h3>Pravidelná kontrola</h3><p>Databáza preverených spoločností pripomenie, komu sa blíži 180 dní od posledného overenia. Jedným klikom preveríte znova.</p></div>
            <div className="s-card"><div className="num">4</div><h3>Daňová kontrola</h3><p>Pri otázke „čo ste o partnerovi vedeli?“ predložíte protokoly s časom preverenia a menom zamestnanca, ktorý ho vykonal.</p></div>
          </div>
        </div>
      </section>

      <section className="s-band alt" id="zastita">
        <div className="s-wrap">
          <div className="s-head">
            <span className="s-eyebrow">O projekte</span>
            <h2>Samostatný projekt s odbornou záštitou dvoch advokátskych kancelárií.</h2>
            <p>Rozsah overenia a hodnotenie rizika vychádzajú zo skúseností z daňových kontrol a súdnych konaní, v ktorých sa rozhodovalo práve o tom, či si podnikateľ svojho partnera preveril.</p>
          </div>
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
        </div>
      </section>

      <section className="s-band warm" id="objednat">
        <div className="s-wrap">
          <div className="s-head">
            <span className="s-eyebrow">Objednávka</span>
            <h2>Dve verzie podľa potrieb vašej firmy.</h2>
            <p>Cena závisí od počtu poverených zamestnancov. Po odoslaní objednávky vám do jedného pracovného dňa pošleme ponuku, zmluvu a prístupy do klientskej sekcie.</p>
          </div>
          <div className="s-compare-wrap">
            <table className="s-compare">
              <thead>
                <tr>
                  <th className="feat"><span>Čo je súčasťou</span></th>
                  <th className="plan hi">
                    <span className="pn">Rozšírené</span>
                    <span className="pd">pre väčšie obchody a regulované odvetvia</span>
                    <a className="s-btn gold" href="/objednavka?plan=rozsirene">Objednať Rozšírené</a>
                  </th>
                  <th className="plan">
                    <span className="pn">Štandard</span>
                    <span className="pd">pre bežný obchodný styk</span>
                    <a className="s-btn ghost" href="/objednavka?plan=standard">Objednať Štandard</a>
                  </th>
                </tr>
              </thead>
              <tbody>
                {FEATURES.map((f) => (
                  <tr key={f.name}>
                    <td className="feat">{f.name}{f.note && <small>{f.note}</small>}</td>
                    <td className="plan hi">{f.ext ? <span className="yes">✓</span> : <span className="no">–</span>}</td>
                    <td className="plan">{f.std ? <span className="yes">✓</span> : <span className="no">–</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
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
