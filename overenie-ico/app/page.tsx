import type { Metadata } from "next";
import { FIRMS, OPERATOR, PRODUCT, SiteFooter, SiteHeader } from "./components/site/SiteShell";

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

      <section className="s-band warm" id="zastita">
        <div className="s-wrap">
          <div className="s-head">
            <span className="s-eyebrow">O projekte</span>
            <h2>Samostatný projekt s odbornou záštitou dvoch advokátskych kancelárií.</h2>
            <p>Rozsah overenia a hodnotenie rizika vychádzajú zo skúseností z daňových kontrol a súdnych konaní, v ktorých sa rozhodovalo práve o tom, či si podnikateľ svojho partnera preveril.</p>
          </div>
          <div className="s-operator">
            <div className="mark">§</div>
            <div>
              <h3>Prevádzkovateľom je {OPERATOR.name}</h3>
              <p>
                Samostatná spoločnosť, ktorá vyvíja a prevádzkuje aplikáciu, uzatvára zmluvy s klientmi a poskytuje podporu. Nie je advokátskou kanceláriou
                a neposkytuje právne služby; pri rizikovom náleze alebo významnom obchode odporúča konzultáciu s advokátom alebo daňovým poradcom.
              </p>
            </div>
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

      <section className="s-band" id="objednat">
        <div className="s-wrap">
          <div className="s-head">
            <span className="s-eyebrow">Objednávka</span>
            <h2>Dve verzie podľa potrieb vašej firmy.</h2>
            <p>Cena závisí od počtu poverených zamestnancov. Po odoslaní objednávky vám do jedného pracovného dňa pošleme ponuku, zmluvu a prístupy do klientskej sekcie.</p>
          </div>
          <div className="s-plans">
            <div className="s-plan">
              <h3>Štandard</h3>
              <div className="price">Pre bežný obchodný styk<small>verejné registre · protokol · databáza preverení</small></div>
              <ul>
                <li>Všetkých 10 automatických zdrojov vrátane Finančnej správy a Sociálnej poisťovne</li>
                <li>Výsledok, skóre a 9 kľúčových otázok k partnerovi</li>
                <li>PDF protokol s časovou pečiatkou a menom zamestnanca</li>
                <li>Databáza preverených spoločností s pripomienkou po 180 dňoch</li>
                <li>Karta kontaktu: s kým u partnera komunikujete a kto od vás</li>
                <li>Neobmedzený počet preverení</li>
              </ul>
              <a className="s-btn" href="/objednavka?plan=standard">Objednať Štandard</a>
            </div>
            <div className="s-plan featured">
              <h3>Rozšírené</h3>
              <div className="price">Pre väčšie obchody a regulované odvetvia<small>všetko zo Štandardu + neverejné registre</small></div>
              <ul>
                <li>Kontrolný zoznam neverejných registrov (exekúcie, zdravotné poisťovne, Obchodný vestník, diskvalifikácie, verejné obstarávanie) s odkazmi a zápisom výsledku do protokolu</li>
                <li>Výsledok sa prepočíta po manuálnom overení povereným zamestnancom</li>
                <li>Voliteľné AI dohľadanie údajov v zdrojoch bez rozhrania</li>
                <li>Úvodné školenie poverených zamestnancov</li>
                <li>Zvýhodnená konzultácia s advokátom pri rizikovom náleze</li>
              </ul>
              <a className="s-btn gold" href="/objednavka?plan=rozsirene">Objednať Rozšírené</a>
            </div>
          </div>
        </div>
      </section>

      <section className="s-band alt">
        <div className="s-wrap">
          <div className="s-head">
            <span className="s-eyebrow">Časté otázky</span>
            <h2>Čo sa podnikatelia pýtajú najčastejšie</h2>
          </div>
          <div className="s-faq">
            <details>
              <summary>Nahrádza protokol právne posúdenie?</summary>
              <p>Nie. Protokol je automatizovaný súhrn verejných údajov k času preverenia a doklad o tom, že ste partnera overili. Pri rizikovom náleze alebo významnom obchode odporúčame konzultáciu s advokátom alebo daňovým poradcom.</p>
            </details>
            <details>
              <summary>Kto overenie vykonáva?</summary>
              <p>Vaša spoločnosť sama. Administrátor vo vašej firme pridá poverených zamestnancov (e-mail a jednorazový kód), tí sa prihlásia a preverujú partnerov. Každé preverenie je zaznamenané s menom zamestnanca a časom.</p>
            </details>
            <details>
              <summary>Aký je vzťah projektu k advokátskym kanceláriám?</summary>
              <p>Aplikáciu prevádzkuje samostatná spoločnosť {OPERATOR.name}. Advokátske kancelárie {u.short} a {l.short} poskytli odbornú záštitu – nastavili rozsah overenia a hodnotenie rizika podľa svojej praxe z daňových kontrol. Zmluvu uzatvárate s prevádzkovateľom; právne služby si prípadne objednávate priamo u kancelárií.</p>
            </details>
            <details>
              <summary>Odkiaľ sú údaje a sú aktuálne?</summary>
              <p>Výlučne z oficiálnych verejných registrov (Štatistický úrad SR, Finančná správa SR, Sociálna poisťovňa, Ministerstvo spravodlivosti SR, Ministerstvo financií SR, EÚ VIES) a slovenských médií – vždy k momentu preverenia. Niektoré zoznamy aktualizujú úrady raz denne alebo mesačne; protokol uvádza, z akého zdroja údaj pochádza.</p>
            </details>
            <details>
              <summary>Čo sa deje s údajmi?</summary>
              <p>Aplikácia pracuje s údajmi o právnických osobách a podnikateľoch z verejných registrov. Osobné údaje spracúva len v rozsahu prihlásenia poverených zamestnancov a kontaktov, ktoré si k partnerovi sami zapíšete. Dáta sú uložené v EÚ.</p>
            </details>
            <details>
              <summary>Ako často treba overovať?</summary>
              <p>Pred každým novým obchodným vzťahom a pri významnej zmene (nový konateľ, zmena vlastníka, vyšší objem). Databáza preverení označí spoločnosti, ktorým uplynulo 180 dní od posledného overenia, a jedným klikom ich preveríte znova.</p>
            </details>
          </div>
          <div className="s-actions" style={{ marginTop: 32 }}>
            <a className="s-btn gold" href="/objednavka">Objednať pre našu firmu</a>
            <a className="s-btn ghost" href="/login">Klientska sekcia</a>
          </div>
        </div>
      </section>

      <SiteFooter />
    </div>
  );
}
