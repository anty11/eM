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
    task: (ico, p) => `Over, či je subjekt ${who(ico, p)} v zozname dlžníkov Všeobecnej zdravotnej poisťovne (časť Zamestnávatelia a SZČO).`,
    dataPoints: `"amount" (EUR alebo null)`,
    penalty: 25,
    foundText: "Dlh voči VšZP",
  },
  union: {
    id: "union",
    kind: "negative",
    domains: ["unionzp.sk", "portal.unionzp.sk", "union.sk", "www.union.sk"],
    urls: () => ["https://portal.unionzp.sk/pub/dlznici", "https://www.union.sk/zoznam-dlznikov/"],
    task: (ico, p) => `Over, či je subjekt ${who(ico, p)} v zozname dlžníkov zdravotnej poisťovne Union.`,
    dataPoints: `"amount" (EUR alebo null)`,
    penalty: 25,
    foundText: "Dlh voči Union ZP",
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
  },
  diskv: {
    id: "diskv",
    kind: "negative",
    domains: ["justice.gov.sk", "www.justice.gov.sk", "obcan.justice.sk"],
    urls: () => ["https://www.justice.gov.sk/registre/registerDiskvalifikacii/?pageNum=1&size=10"],
    task: (ico, p) =>
      `V Registri diskvalifikácií (Ministerstvo spravodlivosti SR) over, či niektorá z osôb nemá zákaz výkonu funkcie štatutára: ${statutory(p).join(", ") || "(štatutári neznámi – over podľa výpisu z OR)"}. Spoločnosť: ${who(ico, p)}. Zhodu posudzuj opatrne (rovnaké meno ≠ rovnaká osoba – porovnaj dátum narodenia/bydlisko, ak je uvedené).`,
    dataPoints: `"persons": [{"name","until","note"}]`,
    penalty: 25,
    foundText: "Štatutár je v Registri diskvalifikácií",
  },
  uvo: {
    id: "uvo",
    kind: "negative",
    domains: ["uvo.gov.sk", "www.uvo.gov.sk"],
    urls: () => ["https://www.uvo.gov.sk/zaujemca-uchadzac/registre-o-hospodarskych-subjektoch/register-osob-so-zakazom"],
    task: (ico, p) => `Over, či je subjekt ${who(ico, p)} v Registri osôb so zákazom účasti vo verejnom obstarávaní (ÚVO).`,
    dataPoints: `"until" (dátum konca zákazu alebo null)`,
    penalty: 15,
    foundText: "Zákaz účasti vo verejnom obstarávaní",
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
