import type { CompanyProfile } from "../types";

/**
 * Zadania pre AI vyhľadávanie – jedno na každý zdroj.
 * „kind“ určuje význam nálezu:
 *   negative = nález je negatívny (dlžník, konkurz, zákaz…) → „found“ = riziko, „clean“ = bez záznamu
 *   data     = zdroj poskytuje údaje (identifikácia, závierky, DPH) → hodnotia sa vrátené zistenia
 * Podrobný popis: docs/ZDROJE.md
 */
export interface AiSpec {
  id: string;
  kind: "negative" | "data";
  /** Oficiálne domény, z ktorých musí pochádzať dôkaz. */
  domains: string[];
  /** Presné odkazy vložené do zadania (Claude web_fetch smie otvoriť len URL zo zadania). */
  urls: (ico: string, p: CompanyProfile) => string[];
  task: (ico: string, p: CompanyProfile) => string;
  /** Požadované údaje v poli "data" odpovede. */
  dataPoints: string;
  /** Postih pri potvrdenom negatívnom náleze (kind=negative). */
  penalty?: number;
  foundText?: string;
  /** AI sa pre tento zdroj nepoužije – s dôvodom. */
  disabled?: string;
  /** Register je len za formulárom / aplikáciou – AI použije agenta s prehliadačom na serveri (vyplní pole a odošle). */
  browser?: boolean;
  /** Doplnkové pokyny pre agenta s prehliadačom (kde je pole, ktorú časť zvoliť). */
  browserHint?: (ico: string, p: CompanyProfile) => string;
  /** Rýchle vyhodnotenie výsledku klasifikátorom Jev (po anglicky): čo je negatívny záznam a čo sú bežné, neškodné položky. */
  jev?: { register: string; negative: string; routine?: string };
}

const who = (ico: string, p: CompanyProfile) => `${p.name ? `„${p.name}“, ` : ""}IČO ${ico}${p.address ? `, sídlo ${p.address}` : ""}`;
const statutory = (p: CompanyProfile) => (p.statutory || []).map((s) => s.name).filter(Boolean);

export const AI_SPECS: Record<string, AiSpec> = {
  rpo: {
    id: "rpo",
    kind: "data",
    domains: ["orsr.sk", "www.orsr.sk", "rpo.statistics.sk", "statistics.sk", "api.statistics.sk"],
    urls: (ico) => [`https://www.orsr.sk/hladaj_ico.asp?ICO=${ico}&SID=0`, `https://api.statistics.sk/rpo/v1/search?identifier=${ico}`],
    task: (ico) =>
      `Identifikuj subjekt s IČO ${ico} v Obchodnom registri SR (orsr.sk) alebo v Registri právnických osôb. Otvor výpis (aktuálny aj úplný), zisti údaje nižšie. Zisti, či je spoločnosť v likvidácii, v konkurze, zrušená alebo vymazaná, a či je v zápise uvedené konanie o zrušení / výmaze.`,
    dataPoints: `"name", "legalForm", "established" (YYYY-MM-DD), "terminated" (YYYY-MM-DD alebo null), "address", "statutory": [{"name","role","since"}], "owners": [{"name","since"}], "activities": [text], "lastStatutoryChange" (YYYY-MM-DD), "lastOwnershipChange" (YYYY-MM-DD), "inLiquidation" (bool), "dissolutionProceedings" (bool), "registrationNumber"`,
  },
  ruz: {
    id: "ruz",
    kind: "data",
    domains: ["registeruz.sk", "www.registeruz.sk"],
    urls: (ico) => [
      `https://www.registeruz.sk/cruz-public/domain/accountingentity/simplesearch?ico=${ico}`,
      `https://www.registeruz.sk/cruz-public/api/uctovne-jednotky?zmenene-od=2000-01-01&ico=${ico}`,
    ],
    task: (ico, p) =>
      `V Registri účtovných závierok nájdi subjekt ${who(ico, p)}. Zisti poslednú uloženú riadnu účtovnú závierku (za aký rok, kedy bola uložená) a z nej tržby, výsledok hospodárenia po zdanení, vlastné imanie a záväzky. Upozorni na záporné vlastné imanie, stratu alebo chýbajúce závierky za posledné roky.`,
    dataPoints: `"lastFiledYear" (číslo), "lastFiledOn" (YYYY-MM-DD), "years": [roky so závierkou], "revenue", "profit", "equity", "liabilities" (čísla v EUR za posledný rok)`,
  },
  "fs-debtors": {
    id: "fs-debtors",
    kind: "negative",
    domains: ["financnasprava.sk", "www.financnasprava.sk", "opendata.financnasprava.sk"],
    urls: () => ["https://www.financnasprava.sk/sk/elektronicke-sluzby/verejne-sluzby/zoznamy", "https://opendata.financnasprava.sk/page/data"],
    task: (ico, p) => `Over, či je subjekt ${who(ico, p)} v aktuálnom Zozname daňových dlžníkov Finančnej správy SR. Ak áno, zisti výšku nedoplatku.`,
    dataPoints: `"amount" (nedoplatok v EUR alebo null), "listDate" (ku ktorému dátumu je zoznam)`,
    penalty: 45,
    foundText: "Daňový dlžník (Finančná správa)",
  },
  "fs-vat": {
    id: "fs-vat",
    kind: "data",
    domains: ["financnasprava.sk", "www.financnasprava.sk", "opendata.financnasprava.sk", "ec.europa.eu"],
    urls: (ico) => ["https://www.financnasprava.sk/sk/elektronicke-sluzby/verejne-sluzby/zoznamy", `https://ec.europa.eu/taxation_customs/vies/`],
    task: (ico, p) =>
      `Over DPH status subjektu ${who(ico, p)}${p.dic ? `, DIČ ${p.dic}` : ""}: je registrovaný platiteľ DPH (IČ DPH)? Je v zozname platiteľov DPH, u ktorých nastali dôvody na zrušenie registrácie (§ 81 ods. 4 písm. b) zákona o DPH)? Je v zozname vymazaných platiteľov DPH?`,
    dataPoints: `"registered" (bool), "icDph" (SK…), "deregistrationReasons" (bool), "deleted" (bool)`,
  },
  "fs-ids": {
    id: "fs-ids",
    kind: "data",
    domains: ["financnasprava.sk", "www.financnasprava.sk", "opendata.financnasprava.sk"],
    urls: () => ["https://www.financnasprava.sk/sk/elektronicke-sluzby/verejne-sluzby/zoznamy/index-danovej-spolahlivosti"],
    task: (ico, p) => `Zisti hodnotenie subjektu ${who(ico, p)} v Indexe daňovej spoľahlivosti Finančnej správy (vysoko spoľahlivý / spoľahlivý / menej spoľahlivý).`,
    dataPoints: `"rating" (text hodnotenia alebo null), "period"`,
  },
  "fs-dppo": {
    id: "fs-dppo",
    kind: "data",
    domains: ["financnasprava.sk", "www.financnasprava.sk", "opendata.financnasprava.sk"],
    urls: () => ["https://www.financnasprava.sk/sk/elektronicke-sluzby/verejne-sluzby/zoznamy", "https://opendata.financnasprava.sk/page/data"],
    task: (ico, p) => `Zisti, či subjekt ${who(ico, p)} podal daňové priznanie k dani z príjmov právnickej osoby za posledné obdobie a aká bola daň (zoznam daňových subjektov s výškou dane).`,
    dataPoints: `"filed" (bool alebo null), "year", "tax" (EUR)`,
  },
  socpoist: {
    id: "socpoist",
    kind: "negative",
    domains: ["socpoist.sk", "www.socpoist.sk"],
    urls: (ico, p) => [
      `https://www.socpoist.sk/nastroje-sluzby/zoznam-dlznikov?search=${encodeURIComponent(p.name || ico)}`,
      `https://www.socpoist.sk/nastroje-sluzby/zoznam-dlznikov?search=${ico}`,
    ],
    task: (ico, p) => `Over, či je subjekt ${who(ico, p)} v Zozname dlžníkov Sociálnej poisťovne. Zhodu posudzuj podľa IČO (zoznam obsahuje stĺpec IČO), nie len podľa názvu.`,
    dataPoints: `"amount" (dlh v EUR alebo null)`,
    penalty: 35,
    foundText: "Dlh voči Sociálnej poisťovni",
  },
  insolvency: {
    id: "insolvency",
    kind: "negative",
    domains: ["replik.justice.sk", "justice.sk", "obchodnyvestnik.justice.gov.sk", "justice.gov.sk", "www.justice.gov.sk"],
    urls: (ico) => [`https://replik.justice.sk/ru-verejnost-web/pages/searchKonanie.xhtml?query=${ico}`, "https://obchodnyvestnik.justice.gov.sk/ObchodnyVestnik/Formular/FormulareZverejnene.aspx"],
    task: (ico, p) =>
      `Over v Registri predinsolvenčných, likvidačných a insolvenčných konaní (REPLIK) a v Obchodnom vestníku, či voči subjektu ${who(ico, p)} prebieha alebo prebehlo konanie: konkurz, reštrukturalizácia, likvidácia, zrušenie. Uveď druh a stav konania.`,
    dataPoints: `"kind" ("konkurz" | "reštrukturalizácia" | "likvidácia" | "zrušenie" | iné), "state" (prebieha / skončené), "since"`,
    penalty: 80,
    foundText: "Insolvenčné / likvidačné konanie",
  },
  rpvs: {
    id: "rpvs",
    kind: "data",
    domains: ["rpvs.gov.sk"],
    urls: (ico) => [`https://rpvs.gov.sk/rpvs/Partner/Partner/VyhladavaniePartnera?Ico=${ico}`],
    task: (ico, p) => `Zisti, či je subjekt ${who(ico, p)} zapísaný v Registri partnerov verejného sektora a kto sú jeho koneční užívatelia výhod.`,
    dataPoints: `"registered" (bool), "kuv": [mená konečných užívateľov výhod]`,
  },
  // ---- Registre bez verejného API (pôvodne len manuálne) ----
  vszp: {
    id: "vszp",
    kind: "negative",
    domains: ["vszp.sk", "www.vszp.sk"],
    urls: () => ["https://www.vszp.sk/platitelia/platenie-poistneho/zoznam-dlznikov.html"],
    task: (ico, p) => `Over, či je subjekt ${who(ico, p)} v zozname dlžníkov Všeobecnej zdravotnej poisťovne (časť Zamestnávatelia a SZČO). Zoznam je vyhľadávací formulár – ak sa k výsledku pre dané IČO nedostaneš (formulár sa odosiela metódou POST), vráť "unknown"; nikdy neodvodzuj „clean“ len z toho, že stránka zoznamu neukazuje tento subjekt.`,
    dataPoints: `"amount" (EUR alebo null)`,
    penalty: 25,
    foundText: "Dlh voči VšZP",
    jev: { register: "VšZP list of debtors (health insurance)", negative: "the company is listed as a debtor of the health insurer (a row with its name or ID and an amount in 'Pohľadávka')" },
    browser: true,
    browserHint: (ico) => `Na stránke zoznamu dlžníkov VšZP je formulár s výberom typu platiteľa a poľom pre IČO/meno; zvoľ „Zamestnávatelia“ (resp. typ podľa subjektu), zadaj IČO ${ico} a odošli. Výsledok je tabuľka (Obchodné meno · Obec · Ulica · PSČ · Pohľadávka) alebo text „Nenašli sa žiadne záznamy.“`,
  },
  union: {
    id: "union",
    kind: "negative",
    domains: ["unionzp.sk", "portal.unionzp.sk", "union.sk", "www.union.sk"],
    urls: () => ["https://portal.unionzp.sk/pub/dlznici", "https://www.union.sk/zoznam-dlznikov/"],
    task: (ico, p) => `Over, či je subjekt ${who(ico, p)} v zozname dlžníkov zdravotnej poisťovne Union. Portál je aplikácia – ak sa k výsledku vyhľadávania pre dané IČO nedostaneš, vráť "unknown"; „clean“ len po skutočnom prehľadaní.`,
    dataPoints: `"amount" (EUR alebo null)`,
    penalty: 25,
    foundText: "Dlh voči Union ZP",
    jev: { register: "Union health insurance list of debtors", negative: "the company is listed as a debtor (a row with its ID (IČO) and an amount in 'Pohľadávka')" },
    browser: true,
    browserHint: (ico, p) => `Portál https://portal.unionzp.sk/pub/dlznici je aplikácia so zoznamom dlžníkov a vyhľadávacím poľom (hľadá podľa názvu alebo IČO). Zadaj IČO ${ico}${p.name ? ` (ak nič nenájde, skús názov „${p.name}“)` : ""}, počkaj na načítanie (wait) a prečítaj tabuľku; všimni si počet riadkov / hlásenie o prázdnom výsledku.`,
  },
  ov: {
    id: "ov",
    kind: "negative",
    domains: ["obchodnyvestnik.justice.gov.sk", "justice.gov.sk", "www.justice.gov.sk"],
    urls: () => ["https://obchodnyvestnik.justice.gov.sk/ObchodnyVestnik/Formular/FormulareZverejnene.aspx"],
    task: (ico, p) =>
      `V Obchodnom vestníku vyhľadaj oznámenia k subjektu ${who(ico, p)} za posledné 3 roky: likvidácia, konkurz, zrušenie bez likvidácie, výzva veriteľom, zníženie základného imania, dražba. Bežné oznámenia (napr. zverejnenie závierky) za negatívne nepovažuj.`,
    dataPoints: `"notices": [{"date","type","text"}]`,
    penalty: 30,
    foundText: "Negatívne oznámenie v Obchodnom vestníku",
    jev: {
      register: "Obchodný vestník (Slovak Commercial Bulletin) – published notices",
      negative: "a notice about liquidation (likvidácia), bankruptcy (konkurz), restructuring (reštrukturalizácia), dissolution (zrušenie), auction (dražba), reduction of registered capital (zníženie základného imania) or a call to creditors (výzva veriteľom)",
      routine: "'Podanie Obchodného registra', financial statements (účtovná závierka), annual reports – these are routine filings, not negative",
    },
    browser: true,
    browserHint: (ico, p) => `Na stránke „Zverejnené formuláre“ Obchodného vestníka je vyhľadávací formulár s poľami pre IČO a obchodné meno a s výberom obdobia. Zadaj IČO ${ico}${p.name ? ` (prípadne názov „${p.name}“)` : ""}, obdobie nastav čo najširšie (posledné 3 roky) a odošli („Hľadať“/„Vyhľadať“). Prečítaj tabuľku oznámení (dátum, typ, text) a posúď, ktoré sú negatívne.`,
  },
  diskv: {
    id: "diskv",
    kind: "negative",
    domains: ["justice.gov.sk", "www.justice.gov.sk", "obcan.justice.sk"],
    urls: (ico) => [`https://www.justice.gov.sk/registre/registerDiskvalifikacii/?ico=${ico}&pageNum=1&size=50`, "https://www.justice.gov.sk/registre/registerDiskvalifikacii/?pageNum=1&size=10"],
    task: (ico, p) =>
      `V Registri diskvalifikácií (Ministerstvo spravodlivosti SR) over, či niektorá z osôb nemá zákaz výkonu funkcie štatutára: ${statutory(p).join(", ") || "(štatutári neznámi – over podľa výpisu z OR)"}. Spoločnosť: ${who(ico, p)}. Zhodu posudzuj opatrne (rovnaké meno ≠ rovnaká osoba – porovnaj dátum narodenia/bydlisko, ak je uvedené).`,
    dataPoints: `"persons": [{"name","until","note"}]`,
    penalty: 25,
    foundText: "Štatutár je v Registri diskvalifikácií",
    jev: { register: "Register of disqualifications (Ministry of Justice)", negative: "a person (statutory body) of the company is listed with a disqualification" },
    browser: true,
    browserHint: () => `Register diskvalifikácií má formulár s poľami pre meno/priezvisko a IČO spoločnosti. Vyhľadaj podľa IČO aj podľa mien štatutárov. Ak stránka vráti chybu 403 / prístup odmietnutý, vráť "unknown".`,
  },
  uvo: {
    id: "uvo",
    kind: "negative",
    domains: ["uvo.gov.sk", "www.uvo.gov.sk"],
    urls: (ico) => [`https://www.uvo.gov.sk/vyhladavanie/globalne-vyhladavanie?globalSearch=${ico}&searchType=OSZ`, "https://www.uvo.gov.sk/zaujemca-uchadzac/registre-o-hospodarskych-subjektoch/register-osob-so-zakazom"],
    task: (ico, p) => `Over, či je subjekt ${who(ico, p)} v Registri osôb so zákazom účasti vo verejnom obstarávaní (ÚVO). Otvor prvý odkaz (globálne vyhľadávanie s výberom „Osoba so zákazom“) a prečítaj počet záznamov a výsledky.`,
    dataPoints: `"until" (dátum konca zákazu alebo null)`,
    penalty: 15,
    foundText: "Zákaz účasti vo verejnom obstarávaní",
    jev: { register: "ÚVO register of persons banned from public procurement", negative: "the company is listed with a ban on participation in public procurement (Osoba so zákazom)" },
    browser: true,
    browserHint: (ico, p) => `Otvor prvý odkaz (globálne vyhľadávanie ÚVO so zvoleným typom „Osoba so zákazom“ a IČO v poli). Prečítaj hlásenie („Zadaný výraz nebol nájdený.“ alebo počet záznamov). Potom skús aj obchodné meno${p.name ? ` „${p.name}“` : ""} v tom istom poli s typom „Osoba so zákazom“, lebo register môže hľadať len podľa názvu.`,
  },
  cre: {
    id: "cre",
    kind: "negative",
    domains: ["cre.sk"],
    urls: () => ["https://cre.sk"],
    task: () => "",
    dataPoints: "",
    disabled: "Centrálny register exekúcií je dostupný len po prihlásení a zaplatení výpisu – AI k nemu nemá prístup.",
  },
  dovera: {
    id: "dovera",
    kind: "negative",
    domains: ["dovera.sk"],
    urls: () => [],
    task: () => "",
    dataPoints: "",
    disabled: "Dôvera výslovne zakazuje automatizované overovanie dlžníkov – treba overiť ručne.",
  },
};

export const aiCapable = (id: string) => Boolean(AI_SPECS[id] && !AI_SPECS[id].disabled);
