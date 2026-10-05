import type { Metadata } from "next";
import { PRODUCT, SiteFooter, SiteHeader } from "../components/site/SiteShell";
import { CASES } from "../components/site/content";

export const metadata: Metadata = {
  title: "Právny základ – prečo si podnikateľ musí overiť dodávateľa a odberateľa",
  description:
    "Judikatúra Súdneho dvora EÚ (Kittel, Mahagében a Dávid, Aquila), rozhodovacia prax slovenských súdov a § 69 ods. 14 zákona o DPH: čo sa od podnikateľa očakáva pri overení obchodného partnera.",
};

export default function LawPage() {
  return (
    <div className="site">
      <SiteHeader active="law" />
      <section className="s-band">
        <div className="s-wrap">
          <article className="s-article wide">
            <span className="s-eyebrow">Právny základ</span>
            <h1 style={{ fontSize: "clamp(28px, 3.6vw, 40px)" }}>Právny základ overenia obchodného partnera</h1>
            <p className="s-lead" style={{ marginTop: 14 }}>
              Zhrnutie pre podnikateľov, nie právne stanovisko. Konkrétny obchodný prípad vždy posúdi advokát alebo daňový poradca.
            </p>

            <h2>1. Právo na odpočet DPH a dobrá viera podnikateľa</h2>
            <p>
              Odpočet DPH je základom neutrality dane a nemožno ho odoprieť len preto, že iný článok dodávateľského reťazca daň neodviedol.
              Súdny dvor EÚ však od rozhodnutia vo veciach <b>Kittel a Recolta Recycling (C‑439/04 a C‑440/04)</b> ustálene uvádza, že právo na odpočet
              stráca platiteľ, ktorý <b>vedel alebo mal vedieť</b>, že sa svojím nákupom zúčastňuje na plnení, ktoré je súčasťou podvodu na DPH.
            </p>
            <blockquote className="s-quote">
              Hospodárskym subjektom, ktoré prijmú všetky opatrenia, ktoré od nich možno rozumne požadovať, aby sa uistili, že ich plnenia nie sú súčasťou podvodu,
              musí byť umožnené spoľahnúť sa na zákonnosť týchto plnení.
              <small>Kittel, C‑439/04, bod 51; potvrdené v Mahagében a Dávid, C‑80/11 a C‑142/11, bod 53</small>
            </blockquote>
            <p>
              Vo veciach <b>Mahagében a Dávid (C‑80/11 a C‑142/11)</b> Súdny dvor dodal dve veci, ktoré sú pre podnikateľa kľúčové. Po prvé, dôkazné bremeno
              o tom, že platiteľ vedel alebo mal vedieť o podvode, nesie správca dane na základe objektívnych skutočností. Po druhé, od platiteľa nemožno
              všeobecne vyžadovať, aby vykonával kontrolu dodávateľa namiesto daňového úradu – <b>ak však existujú indície o nezrovnalostiach, obozretný
              podnikateľ sa o svojom partnerovi informuje</b>. Práve preto rozhoduje, čo bolo v čase obchodu z verejných zdrojov zistiteľné a či ste to zistili.
            </p>
            <p>
              Nadväzujúca judikatúra – <b>PPUH Stehcemp (C‑277/14)</b>, <b>Vikingo (C‑610/19)</b>, <b>Ferimet (C‑281/20)</b> – spresnila, že formálne nedostatky na strane
              dodávateľa (neaktívna registrácia, chýbajúce zamestnanci či prevádzka) samy osebe odpočet nevylučujú, ale sú presne tými indíciami, ktoré
              si obozretný odberateľ má všimnúť. Vo veci <b>Aquila Part Prod Com (C‑512/21)</b> Súdny dvor uviedol, že platiteľ nemôže zodpovednosť za náležitú
              starostlivosť presunúť na tretiu osobu a že správca dane môže skúmať, aké opatrenia platiteľ sám prijal.
            </p>

            <h2>2. Slovenská úprava: ručenie za daň a zoznamy Finančnej správy</h2>
            <p>
              Zákon č. 222/2004 Z. z. o dani z pridanej hodnoty v <b>§ 69 ods. 14</b> ustanovuje, že platiteľ, ktorému je alebo má byť dodaný tovar alebo služba,
              <b> ručí za daň z predchádzajúceho stupňa</b>, ak dodávateľ daň nezaplatil a odberateľ v čase vzniku daňovej povinnosti <b>vedel alebo na základe
              dostatočných dôvodov vedieť mal alebo vedieť mohol</b>, že daň nebude zaplatená. Zákon uvádza, kedy dostatočné dôvody sú – napríklad ak je
              protihodnota bez ekonomického opodstatnenia neprimerane vysoká či nízka, ak je dodávateľ personálne prepojený s odberateľom, alebo ak bol dodávateľ
              v čase plnenia <b>zverejnený v zozname platiteľov, u ktorých nastali dôvody na zrušenie registrácie</b> podľa § 69 ods. 15 (zoznam vedie Finančná správa SR).
              Od roku 2022 pribudol dôvod platby na bankový účet, ktorý dodávateľ neoznámil Finančnej správe.
            </p>
            <p>
              Inými slovami: slovenský zákon priamo spája ručenie odberateľa s informáciami, ktoré sú verejne dostupné. Kto si zoznamy Finančnej správy nepozrie,
              „vedieť mohol“ a ručí. Podobne sa na náležitú starostlivosť pozerá správca dane pri posudzovaní daňových výdavkov podľa zákona o dani z príjmov,
              kde sa skúma skutočné dodanie plnenia deklarovaným dodávateľom.
            </p>

            <h2>3. Rozhodovacia prax slovenských súdov</h2>
            <p>
              Najvyšší súd SR a od roku 2021 Najvyšší správny súd SR uplatňujú kritériá Súdneho dvora EÚ v desiatkach rozhodnutí (napríklad sp. zn. 6Sžfk/52/2020 či
              10Sžfk/26/2021). Súdy opakovane konštatujú, že od podnikateľa sa očakáva <b>primeraná miera obozretnosti zodpovedajúca okolnostiam obchodu</b> – čím
              väčší objem, neznámejší partner a neobvyklejšie podmienky, tým dôkladnejšie overenie. Zároveň platí, že obozretnosť treba vedieť <b>preukázať</b>:
              rozhoduje dokumentácia z času pred obchodom, nie dodatočné vysvetlenia pri kontrole.
            </p>

            <h2 id="rozhodnutia">4. Kľúčové rozhodnutia a ustanovenia v skratke</h2>
            <ul className="s-cases" style={{ margin: "16px 0 8px" }}>
              {CASES.map((c) => (
                <li key={c.title}><b>{c.title}</b><span>{c.text}</span></li>
              ))}
            </ul>

            <h2>5. Čo z toho vyplýva pre prax</h2>
            <p>Náležitá starostlivosť má v praxi tri zložky, ktoré aplikácia {PRODUCT} pokrýva:</p>
            <ul>
              <li><b>Overenie v registroch pred obchodom</b> – obchodný register, registrácia pre DPH a zoznamy Finančnej správy (dlžníci, dôvody na zrušenie registrácie, index spoľahlivosti), Sociálna poisťovňa, konkurzy a likvidácie, účtovné závierky, register partnerov verejného sektora, médiá.</li>
              <li><b>Vyhodnotenie indícií</b> – záporné vlastné imanie, nepodaná závierka, čerstvá zmena konateľa či vlastníka, veľmi mladá spoločnosť, negatívne správy v médiách o spoločnosti alebo jej štatutároch.</li>
              <li><b>Posúdenie indikátorov rizika obchodu</b> podľa Bulletinu Slovenskej komory daňových poradcov 03/2024 – cena, platby v hotovosti, preprava, sprostredkovatelia, tlak na čas, zapojenie ďalších osôb; overenie účtu partnera v zozname bankových účtov Finančnej správy (§ 69 ods. 14 písm. c) ZDPH).</li>
              <li><b>Preukázateľný záznam</b> – protokol s časom preverenia, menom povereného zamestnanca, výsledkami a odkazmi na zdroje, zapečatený odtlačkom SHA-256 s verejnou overovacou stránkou; databáza preverení s pripomienkou po 180 dňoch. Pri existujúcej spolupráci spätné preverenie k dátumu jej začiatku – protokol vždy uvádza skutočný dátum vyhotovenia.</li>
            </ul>
            <p>
              Overenie vykonáva spoločnosť sama prostredníctvom poverených zamestnancov – tak, ako to judikatúra predpokladá: starostlivosť podnikateľa je jeho vlastná
              a nemožno ju delegovať. Rozsah overenia nastavili advokátske kancelárie poskytujúce projektu odbornú záštitu podľa toho, na čo sa pri kontrolách a v súdnych konaniach
              skutočne pýta.
            </p>
            <div className="s-actions" style={{ marginTop: 28 }}>
              <a className="s-btn gold" href="/objednavka">Objednať pre našu firmu</a>
              <a className="s-btn ghost" href="/">Späť na úvod</a>
            </div>
            <p style={{ fontSize: 13, color: "var(--s-muted)", marginTop: 28 }}>
              Zdroje: rozsudky Súdneho dvora EÚ C‑439/04 a C‑440/04 (Kittel a Recolta Recycling), C‑80/11 a C‑142/11 (Mahagében a Dávid), C‑277/14 (PPUH Stehcemp),
              C‑610/19 (Vikingo), C‑281/20 (Ferimet), C‑512/21 (Aquila Part Prod Com); zákon č. 222/2004 Z. z. o DPH, § 49 – 51 a § 69 ods. 14 a 15; rozhodnutia NS SR / NSS SR
              sp. zn. 6Sžfk/52/2020 a 10Sžfk/26/2021. Text je informatívny a zodpovedá stavu právnej úpravy k dátumu zverejnenia.
            </p>
          </article>
        </div>
      </section>
      <SiteFooter />
    </div>
  );
}
