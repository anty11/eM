import { fold } from "./http";
import type { CheckResult, Finding } from "./types";

/**
 * Indikátory rizikovosti obchodu podľa Bulletinu Slovenskej komory daňových poradcov 03/2024 (s. 4 a nasl.)
 * – indikácie daňového podvodu, na ktoré sa správca dane pri kontrole pýta.
 *
 * Automaticky z registrov:   (i) vek, (ii) neaktivita, (iii) daňový raj spoločníka, (iv) zmeny vlastníkov/štatutárov
 *                             (aj tesne pred obchodom), (ix) predmet obchodu vs. predmet podnikania, (x) IBAN v zozname FS
 * Z karty kontaktu:          (v) komunikácia s osobou bez oprávnenia konať
 * Posúdi poverený zamestnanec (tento modul): (vi) dokumentácia, (vii) cena, (viii) porušovanie predpisov, (x) platobné metódy,
 *                             (xi) preprava, (xii) umelé zapojenie osôb, (xiii) referencie len od sprostredkovateľa, (xiv) tlak na čas
 * Nerieši sa: virtuálne sídlo (z registrov nezistiteľné).
 */

export interface Indicator {
  id: string;
  /** Číslo indikátora v bulletine */
  no: string;
  title: string;
  hint: string;
  severity: "critical" | "warning";
  penalty: number;
}

export const INDICATORS: Indicator[] = [
  { id: "docs", no: "vi", title: "Neúplná, nejasná alebo chýbajúca zmluvná dokumentácia", hint: "Zmluva, objednávka, dodací list, preberací protokol – chýbajú alebo si odporujú.", severity: "warning", penalty: 8 },
  { id: "price", no: "vii", title: "Cenová politika mimo trhu", hint: "Cena výrazne pod alebo nad obvyklou úrovňou bez ekonomického zdôvodnenia (porovnajte s § 69 ods. 14 písm. a) ZDPH).", severity: "warning", penalty: 10 },
  { id: "law", no: "viii", title: "Porušovanie právnych predpisov alebo nabádanie naň", hint: "Návrh fakturovať inak než sa dodáva, obísť DPH, clo, licenciu, zamestnanecké predpisy.", severity: "critical", penalty: 40 },
  { id: "cash", no: "x", title: "Platby v hotovosti namiesto bezhotovostnej úhrady", hint: "Partner požaduje alebo ponúka úhradu faktúr v hotovosti namiesto prevodu na účet – aj pod zákonným limitom (zákon č. 394/2012 Z. z. o obmedzení platieb v hotovosti), najmä opakovane alebo tesne pod limitom.", severity: "warning", penalty: 12 },
  { id: "payment", no: "x", title: "Iné nezvyčajné platobné metódy", hint: "Platba tretej osobe alebo na účet v inom štáte, krypto, zápočty s neznámymi subjektmi, platba vopred bez zabezpečenia.", severity: "warning", penalty: 10 },
  { id: "transport", no: "xi", title: "Nezvyčajné podmienky prepravy", hint: "Zmena zaužívaného spôsobu prepravy, dodávateľ nevie preukázať prepravu, tovar sa fyzicky nikdy nepresunul.", severity: "warning", penalty: 6 },
  { id: "chain", no: "xii", title: "Umelé zapojenie ďalších osôb do obchodu", hint: "Návrh fakturovať cez inú spoločnosť alebo zapojiť subjekt, ktorý v obchode nemá žiadnu úlohu.", severity: "critical", penalty: 40 },
  { id: "refs", no: "xiii", title: "Referencie len od sprostredkovateľa", hint: "Partnera poznáme len cez tretiu osobu bez právneho vzťahu k nám; priame referencie, prevádzka ani história nie sú známe.", severity: "warning", penalty: 8 },
  { id: "time", no: "xiv", title: "Tlak na čas", hint: "Naliehanie na rýchle uzavretie, neprimerane krátke dodacie lehoty, „ponuka platí len dnes“.", severity: "warning", penalty: 6 },
];

export type IndicatorAnswer = "none" | "found";
export type IndicatorAnswers = Record<string, IndicatorAnswer | undefined>;

/** Jurisdikcie so zvýšeným daňovým rizikom: zoznam EÚ nespolupracujúcich jurisdikcií (2025) + klasické offshore centrá. */
export const RISK_JURISDICTIONS: { re: RegExp; label: string }[] = [
  { re: /americk[aá] samoa|american samoa/i, label: "Americká Samoa" },
  { re: /anguill/i, label: "Anguilla" },
  { re: /fid[zž]i|fiji/i, label: "Fidži" },
  { re: /guam/i, label: "Guam" },
  { re: /palau/i, label: "Palau" },
  { re: /panam/i, label: "Panama" },
  { re: /rusk[aá] feder|russia/i, label: "Ruská federácia" },
  { re: /\bsamoa\b/i, label: "Samoa" },
  { re: /trinidad/i, label: "Trinidad a Tobago" },
  { re: /americk[eé] panensk|u\.?s\.? virgin/i, label: "Americké Panenské ostrovy" },
  { re: /vanuatu/i, label: "Vanuatu" },
  { re: /britsk[eé] panensk|british virgin|\bbvi\b/i, label: "Britské Panenské ostrovy" },
  { re: /kajmansk|cayman/i, label: "Kajmanské ostrovy" },
  { re: /seychel/i, label: "Seychely" },
  { re: /belize/i, label: "Belize" },
  { re: /marshallov|marshall islands/i, label: "Marshallove ostrovy" },
  { re: /baham/i, label: "Bahamy" },
  { re: /bermud/i, label: "Bermudy" },
  { re: /\bnauru\b|turks|caicos|svat[aá] luc|saint lucia|\bniue\b|\bcook/i, label: "offshore centrum" },
];

export function riskJurisdiction(country?: string): string | null {
  if (!country) return null;
  for (const j of RISK_JURISDICTIONS) if (j.re.test(country)) return j.label;
  return null;
}

/** Regulované činnosti – pri zhode s predmetom obchodu aplikácia pripomenie overenie povolenia / zápisu v registri (indikátor ix). */
export const REGULATED: { re: RegExp; what: string; where: string; url: string }[] = [
  { re: /pohonn|nafta|benz[ií]n|\bphm\b|palivo|miner[aá]ln\S* olej/i, what: "distribúcia pohonných látok", where: "Register distribútorov pohonných látok (Finančná správa SR)", url: "https://www.financnasprava.sk/sk/elektronicke-sluzby/verejne-sluzby/zoznamy" },
  { re: /alkohol|lieh|destil[aá]t|víno|vino\b|pivo/i, what: "obchod s liehom / alkoholom", where: "Povolenie na distribúciu spotrebiteľského balenia liehu (Finančná správa SR)", url: "https://www.financnasprava.sk/sk/elektronicke-sluzby/verejne-sluzby/zoznamy" },
  { re: /tabak|cigaret/i, what: "obchod s tabakovými výrobkami", where: "Povolenie na obchodovanie s tabakom (Finančná správa SR)", url: "https://www.financnasprava.sk/sk/elektronicke-sluzby/verejne-sluzby/zoznamy" },
  { re: /odpad|šrot|srot|kov\S* odpad|recykl/i, what: "nakladanie s odpadmi", where: "Informačný systém odpadového hospodárstva (ISOH) – registrácie a súhlasy", url: "https://www.isoh.gov.sk" },
  { re: /úver|uver|p[oô]ži[cč]k|leasing|platobn\S* slu[zž]|zmen[aá]re|investi[cč]|poist/i, what: "finančné služby", where: "Register subjektov finančného trhu (Národná banka Slovenska)", url: "https://subjekty.nbs.sk" },
  { re: /nákladn\S* doprav|cestn\S* doprav|preprav|špedí|spedic|zasielate/i, what: "cestná nákladná doprava / zasielateľstvo", where: "Jednotný informačný systém v cestnej doprave – povolenia a licencie", url: "https://www.jiscd.sk" },
  { re: /\blie[kč]|farmac|zdravotn\S* pom[oô]ck/i, what: "lieky a zdravotnícke pomôcky", where: "Štátny ústav pre kontrolu liečiv – povolenia na distribúciu", url: "https://www.sukl.sk" },
  { re: /zbra|strel|munic|výbu[sš]|vybus/i, what: "zbrane a strelivo", where: "Licencia Ministerstva hospodárstva SR / zbrojná licencia PZ", url: "https://www.mhsr.sk" },
  { re: /bezpe[cč]nostn\S* slu[zž]|\bsbs\b|str[aá][zž]n/i, what: "súkromná bezpečnostná služba", where: "Licencia na prevádzkovanie SBS (Ministerstvo vnútra SR)", url: "https://www.minv.sk/?sukromne-bezpecnostne-sluzby" },
  { re: /personáln|personaln|agent[uú]rn\S* zamestn|pren[aá]jom zamestn/i, what: "agentúrne zamestnávanie", where: "Register agentúr dočasného zamestnávania (ÚPSVaR)", url: "https://www.upsvr.gov.sk" },
  { re: /stavebn\S* pr[aá]c|stavb|výstavb|vystavb|rekon[sš]trukc/i, what: "stavebné práce", where: "Živnosť „uskutočňovanie stavieb“ (viazaná – stavbyvedúci); overte v živnostenskom registri", url: "https://www.zrsr.sk" },
  { re: /elektro(?:in[sš]tal|mont)|plyn|revíz|reviz/i, what: "vyhradené technické zariadenia", where: "Oprávnenie podľa vyhlášky č. 508/2009 Z. z. (Národný inšpektorát práce)", url: "https://www.ip.gov.sk" },
  { re: /potravin|mäso|maso|mlie[cč]/i, what: "potraviny", where: "Registrácia prevádzky (Štátna veterinárna a potravinová správa)", url: "https://www.svps.sk" },
  { re: /hazard|stávk|stavk|kasín|kasin/i, what: "hazardné hry", where: "Licencia Úradu pre reguláciu hazardných hier", url: "https://www.urhh.sk" },
];

export function regulatedFor(subject: string) {
  return REGULATED.filter((r) => r.re.test(subject));
}

/** Zhoda predmetu obchodu s predmetom podnikania: aspoň jedno významové slovo (kmeň ≥ 5 znakov) sa nachádza v činnostiach alebo hlavnej činnosti. */
export function subjectMatchesActivities(subject: string, activities: string[], mainActivity?: string): { match: boolean; words: string[] } {
  const stop = new Set(["dodav", "dodan", "predaj", "nakup", "kupa", "sluzb", "tovar", "prace", "praca", "dodavk", "zabezp", "vykon", "realiz", "poskyt", "inych", "podla", "zmluv", "projek"]);
  const words = [...new Set(fold(subject).split(/[^a-z0-9]+/).filter((w) => w.length >= 5).map((w) => w.slice(0, 5)))].filter((w) => !stop.has(w));
  if (!words.length) return { match: true, words: [] };
  const hay = fold([...activities, mainActivity || ""].join(" "));
  const hit = words.filter((w) => hay.includes(w));
  return { match: hit.length > 0, words };
}

export function normalizeIban(s: string) {
  return (s || "").replace(/\s+/g, "").toUpperCase();
}
export function ibanValid(iban: string) {
  const s = normalizeIban(iban);
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(s)) return false;
  const rearranged = s.slice(4) + s.slice(0, 4);
  const digits = rearranged.replace(/[A-Z]/g, (ch) => String(ch.charCodeAt(0) - 55));
  let rem = 0;
  for (const d of digits) rem = (rem * 10 + Number(d)) % 97;
  return rem === 1;
}

export interface DealInput {
  direction: "buy" | "sell";
  subject: string;
  iban: string;
  value: string;
  indicators: IndicatorAnswers;
}

export interface BankAccountResult {
  status: "listed" | "not_listed" | "not_vat_payer" | "unknown";
  message: string;
  verifyUrl?: string;
}

/** Zostaví z údajov o obchode syntetickú kontrolu „Údaje o obchode a indikátory rizika“ pre výpočet verdiktu a protokol. */
export function buildDealCheck(
  deal: DealInput,
  profile: { activities?: string[]; mainActivity?: string },
  bank: BankAccountResult | null,
  at = new Date().toISOString(),
): CheckResult | null {
  const f: Finding[] = [];
  const subject = deal.subject.trim();
  const answered = INDICATORS.filter((i) => deal.indicators[i.id]);
  const found = INDICATORS.filter((i) => deal.indicators[i.id] === "found");
  const anyInput = subject || normalizeIban(deal.iban) || answered.length;
  if (!anyInput) return null;

  if (subject) {
    const m = subjectMatchesActivities(subject, profile.activities || [], profile.mainActivity);
    if (!m.match && (profile.activities?.length || profile.mainActivity))
      f.push({ severity: "warning", text: `Predmet obchodu „${subject}“ nezodpovedá predmetu podnikania partnera zapísanému v registri – overte, či ide o jeho etablovanú činnosť (indikátor i / ix)`, penalty: 8 });
    for (const r of regulatedFor(subject))
      f.push({ severity: "info", text: `Regulovaná činnosť (${r.what}) – overte povolenie / zápis: ${r.where} – ${r.url} (indikátor ix)`, penalty: 0 });
  }
  if (normalizeIban(deal.iban)) {
    if (!ibanValid(deal.iban)) f.push({ severity: "warning", text: `IBAN ${normalizeIban(deal.iban)} nie je platný (kontrolný súčet) – overte číslo účtu na faktúre`, penalty: 5 });
    else if (bank?.status === "not_listed")
      f.push({ severity: "critical", text: `Účet ${normalizeIban(deal.iban)} nie je v zozname bankových účtov oznámených Finančnej správe – platba naň zakladá ručenie za DPH podľa § 69 ods. 14 písm. c) ZDPH (indikátor x)`, penalty: 35 });
    else if (bank?.status === "listed") f.push({ severity: "positive", text: `Účet ${normalizeIban(deal.iban)} je v zozname bankových účtov oznámených Finančnej správe`, penalty: -2 });
    else if (bank?.status === "not_vat_payer") f.push({ severity: "info", text: `Partner nie je platiteľ DPH – zoznam bankových účtov FS sa naň nevzťahuje; účet ${normalizeIban(deal.iban)} overte zmluvne`, penalty: 0 });
    else f.push({ severity: "info", text: `Účet ${normalizeIban(deal.iban)} sa nepodarilo overiť v zozname FS – skontrolujte manuálne (${bank?.verifyUrl || "https://www.financnasprava.sk/sk/elektronicke-sluzby/verejne-sluzby/zoznamy"})`, penalty: 0 });
  }
  for (const i of found) f.push({ severity: i.severity, text: `Indikátor ${i.no}: ${i.title} – potvrdený povereným zamestnancom (SKDP 03/2024)`, penalty: i.penalty });

  const status = f.some((x) => x.severity === "critical") ? "critical" : f.some((x) => x.severity === "warning") ? "warning" : "ok";
  const parts: string[] = [];
  if (subject) parts.push(`${deal.direction === "buy" ? "Nakupujeme" : "Dodávame"}: ${subject}${deal.value ? ` (${deal.value})` : ""}.`);
  if (normalizeIban(deal.iban)) parts.push(`Účet partnera ${normalizeIban(deal.iban)}.`);
  parts.push(`Indikátory rizika SKDP 03/2024: posúdených ${answered.length} z ${INDICATORS.length}, potvrdených ${found.length}${answered.length < INDICATORS.length ? `, neposúdených ${INDICATORS.length - answered.length}` : ""}.`);

  return {
    id: "deal",
    category: "deal",
    name: "Údaje o obchode a indikátory rizika",
    source: "Poverený zamestnanec · Bulletin SKDP 03/2024 · zoznamy Finančnej správy SR",
    sourceUrl: "https://www.skdp.sk",
    status,
    summary: parts.join(" "),
    findings: f,
    checkedAt: at,
    durationMs: 0,
    automated: false,
    data: { ...deal, bank, answered: answered.map((i) => i.id), found: found.map((i) => i.id) },
  };
}
