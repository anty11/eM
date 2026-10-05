/** Obsah verejného webu na jednom mieste – zdieľajú ho úvodná strana, podstránky a objednávka. */

export const REGISTERS: { name: string; src: string }[] = [
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
  { name: "Zoznam bankových účtov platiteľov DPH – overenie IBAN z faktúry", src: "Finančná správa SR" },
  { name: "Kontrolný zoznam neverejných registrov (exekúcie, zdravotné poisťovne, Obchodný vestník, diskvalifikácie)", src: "na manuálne overenie – verzia Rozšírené" },
];

export interface Feature {
  name: string;
  note?: string;
  ext: boolean;
  std: boolean;
  /** Zobraziť aj v skrátenej tabuľke na úvodnej strane */
  key?: boolean;
}

export const FEATURES: Feature[] = [
  { name: "Všetkých 10 automatických zdrojov", note: "obchodný register, Finančná správa (dlžníci, DPH, index spoľahlivosti, daň z príjmov), Sociálna poisťovňa, závierky, konkurzy a likvidácie, RPVS, médiá", ext: true, std: true, key: true },
  { name: "Výsledok, skóre a 9 kľúčových otázok k partnerovi", note: "vrátane chýbajúcich závierok za 2+ období ako dôvodu na zrušenie súdom", ext: true, std: true },
  { name: "Indikátory rizika", note: "podľa Bulletinu SKDP 03/2024: predmet obchodu vs. predmet podnikania, overenie IBAN v zozname účtov Finančnej správy, posúdenie indikátorov povereným zamestnancom", ext: true, std: true, key: true },
  { name: "Dvojstranový PDF protokol s pečaťou", note: "čas preverenia, meno povereného zamestnanca, odtlačok SHA-256 a verejná overovacia stránka s kódom z protokolu", ext: true, std: true, key: true },
  { name: "Databáza preverených spoločností s pripomienkou po 180 dňoch", note: "zdieľaná v rámci firmy, opakované preverenie jedným klikom", ext: true, std: true, key: true },
  { name: "Karta kontaktu", note: "s kým u partnera komunikujete, kto od vás, overenie oprávnenia konať", ext: true, std: true },
  { name: "Neobmedzený počet preverení", ext: true, std: true },
  { name: "Kontrolný zoznam neverejných registrov so zápisom výsledku do protokolu", note: "exekúcie, zdravotné poisťovne, Obchodný vestník, diskvalifikácie, verejné obstarávanie – výsledok sa premietne do skóre", ext: true, std: false, key: true },
  { name: "Spätné preverenie existujúcej spolupráce k rozhodnému dátumu", note: "čo bolo z registrov zistiteľné pri začiatku spolupráce; protokol je vždy vyhotovený k dnešku", ext: true, std: false, key: true },
  { name: "Úvodné školenie poverených zamestnancov", ext: true, std: false },
  { name: "Komunikácia s advokátom obratom pri rizikovom náleze", note: "prednostný kontakt na advokátske kancelárie poskytujúce odbornú záštitu; právne služby nie sú v cene a účtujú sa osobitne", ext: true, std: false, key: true },
];

export const CASES: { title: string; text: string }[] = [
  { title: "Kittel a Recolta Recycling (C‑439/04, C‑440/04)", text: "Odpočet DPH možno odoprieť, ak platiteľ vedel alebo mal vedieť, že sa plnením zúčastňuje na podvode; kto prijme opatrenia, ktoré od neho možno rozumne požadovať, je chránený." },
  { title: "Mahagében a Dávid (C‑80/11, C‑142/11)", text: "Dôkazné bremeno o vedomosti nesie správca dane; od podnikateľa nemožno žiadať kontrolu namiesto úradu, pri indíciách nezrovnalostí sa však očakáva, že sa o partnerovi informuje." },
  { title: "PPUH Stehcemp (C‑277/14)", text: "Formálne nedostatky dodávateľa (neaktívna registrácia, chýbajúce sídlo) samy osebe odpočet nevylučujú – rozhoduje, čo odberateľ vedel a mohol zistiť." },
  { title: "Vikingo (C‑610/19), Ferimet (C‑281/20)", text: "Správca dane musí preukázať účasť na podvode objektívnymi skutočnosťami; nezrovnalosti v reťazci sú indíciou, nie automatickým dôvodom na odopretie odpočtu." },
  { title: "Aquila Part Prod Com (C‑512/21)", text: "Náležitú starostlivosť nemožno preniesť na tretiu osobu; platiteľ má vedieť preukázať vlastné overenie partnera." },
  { title: "§ 69 ods. 13 a § 69b zákona č. 222/2004 Z. z. o DPH", text: "Ručenie odberateľa za daň nezaplatenú dodávateľom, ak „vedel alebo vedieť mal a mohol“ – predpokladá sa pri neprimeranej cene (písm. a)), personálnom prepojení (písm. b)) a platbe na účet, ktorý nie je v zozname Finančnej správy (písm. c))." },
  { title: "NS SR 6Sžfk/52/2020, NSS SR 10Sžfk/26/2021", text: "Slovenské súdy uplatňujú kritériá Súdneho dvora: očakáva sa obozretnosť primeraná okolnostiam obchodu a schopnosť preukázať ju dokumentáciou z času pred obchodom." },
];

export const STEPS: { title: string; text: string }[] = [
  { title: "Zadáte IČO", text: "Dodávateľa, odberateľa alebo iného partnera. Stačí IČO – názov, DIČ a IČ DPH si aplikácia doplní z registrov. Ak IČO v registri neexistuje, preverenie sa zastaví a aplikácia poradí, čo skontrolovať." },
  { title: "Registre odpovedajú priebežne", text: "Výsledky sa zobrazujú, ako jednotlivé registre odpovedajú. Celé preverenie trvá zvyčajne 10 – 30 sekúnd; zdroj, ktorý neodpovie, sa dá zopakovať jedným klikom." },
  { title: "Dostanete prehľadný výsledok", text: "Odporúčame · S výhradou · Neodporúčame, so skóre a odpoveďami na kľúčové otázky: podaná závierka, likvidácia, nedoplatky, spoľahlivý platiteľ DPH, zmeny vlastníkov. Doplníte predmet obchodu a IBAN partnera a posúdite indikátory rizika podľa SKDP." },
  { title: "Uložíte protokol", text: "Dvojstranový PDF protokol s časom preverenia, menom zamestnanca a odkazmi na zdroje, zapečatený odtlačkom, ktorý si ktokoľvek overí na verejnej stránke s kódom z protokolu. Spoločnosť sa uloží do databázy preverení s pripomienkou po 180 dňoch." },
];

export const AUDIENCES: { title: string; text: string; more: string }[] = [
  { title: "Nový dodávateľ", text: "Pred prvou objednávkou alebo zmluvou. Protokol založíte k zmluve ako doklad náležitej starostlivosti.", more: "Najčastejšia situácia pri daňovej kontrole: dodávateľ neodviedol DPH a správca dane sa pýta, čo ste o ňom vedeli. Protokol z času pred obchodom ukáže, že ste si overili registráciu pre DPH, zoznam dlžníkov, konkurzy aj účet, na ktorý ste platili." },
  { title: "Odberateľ na faktúru", text: "Pred dodaním tovaru alebo služby s odloženou splatnosťou – nedoplatky, konkurz a záporné imanie uvidíte vopred.", more: "Pri odberateľovi nejde len o dane, ale o to, či vám zaplatí. Záporné vlastné imanie, strata dva roky po sebe, chýbajúce závierky alebo začaté konkurzné konanie sú signály, ktoré vidno skôr, než príde prvá neuhradená faktúra." },
  { title: "Pravidelná kontrola", text: "Databáza preverených spoločností pripomenie, komu sa blíži 180 dní od posledného overenia. Jedným klikom preveríte znova.", more: "Partner, ktorý bol v poriadku pred rokom, v poriadku byť nemusí. Databáza preverení je spoločná pre celú firmu – vidíte, kto a kedy partnera preveril, a po 180 dňoch dostanete pripomienku." },
  { title: "Daňová kontrola", text: "Predložíte protokoly s časom preverenia, menom zamestnanca a pečaťou, ktorú si kontrolór overí na verejnej stránke.", more: "Každý protokol má odtlačok a overovaciu stránku, kde si správca dane sám overí, kedy preverenie prebehlo a že obsah nebol zmenený. Pri partneroch, s ktorými spolupracujete dlhšie, než máte aplikáciu, vyhotovíte spätné preverenie k dátumu začiatku spolupráce – protokol pritom vždy uvádza skutočný dátum vyhotovenia." },
];

/** Porovnávacia tabuľka verzií; `compact` zobrazí len kľúčové riadky. */
export function CompareTable({ compact = false, moreHref }: { compact?: boolean; moreHref?: string }) {
  const rows = compact ? FEATURES.filter((f) => f.key) : FEATURES;
  return (
    <>
      <div className={`s-compare-wrap${compact ? " compact" : ""}`}>
        <table className="s-compare">
          <thead>
            <tr>
              <th className="feat"><span>Čo je súčasťou</span></th>
              <th className="plan hi">
                <span className="pn">Rozšírené</span>
                <span className="pd">pre väčšie obchody a regulované odvetvia</span>
                <a className="s-btn gold" href="/objednavka?plan=rozsirene">{compact ? "Objednať" : "Objednať Rozšírené"}</a>
              </th>
              <th className="plan">
                <span className="pn">Štandard</span>
                <span className="pd">pre bežný obchodný styk</span>
                <a className="s-btn ghost" href="/objednavka?plan=standard">{compact ? "Objednať" : "Objednať Štandard"}</a>
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((f) => (
              <tr key={f.name}>
                <td className="feat">{f.name}{!compact && f.note && <small>{f.note}</small>}</td>
                <td className="plan hi">{f.ext ? <span className="yes">✓</span> : <span className="no">–</span>}</td>
                <td className="plan">{f.std ? <span className="yes">✓</span> : <span className="no">–</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {compact && moreHref && (
        <p className="s-compare-more" style={{ marginTop: 14, fontSize: 15 }}>
          <a href={moreHref}>Úplné porovnanie verzií ({FEATURES.length} položiek) →</a>
        </p>
      )}
    </>
  );
}
