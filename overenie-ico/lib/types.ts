/** Výsledok jednej kontroly (jeden register / zdroj). */
export type CheckStatus =
  | "ok" // overené, bez negatívneho záznamu
  | "warning" // overené, zistené riziko strednej závažnosti
  | "critical" // overené, zistený závažný negatívny záznam
  | "info" // informatívny údaj bez hodnotenia
  | "manual" // nie je možné overiť automaticky – treba manuálne overenie
  | "error" // zdroj nedostupný / chyba
  | "pending"; // práve sa overuje (priebežné zobrazenie)

export type Severity = "critical" | "warning" | "info" | "positive";

export interface Finding {
  severity: Severity;
  text: string;
  /** Body, ktoré sa odpočítajú (kladné) alebo pripočítajú (záporné) od skóre 100. */
  penalty: number;
  /** Odporúčaná otázka na partnera – odpoveď zaznamená poverený zamestnanec do protokolu (napr. dôvod chýbajúcej závierky). */
  ask?: string;
  /** Zistenie nedovolí verdikt „Odporúčame“ – najlepšie „S výhradou“ (napr. chýbajúca závierka), aj keď by skóre stačilo. */
  cap?: "caution";
}

/** Jeden dopyt do zdroja – podľa čoho, akou hodnotou, koľko záznamov zdroj vrátil a koľko sa zhodovalo. */
export interface SearchQuery {
  /** podľa čoho: „IČO“, „obchodné meno“, „priezvisko štatutára“ … */
  by: string;
  value: string;
  /** adresa dopytu (bez kľúčov) – dá sa zopakovať a overiť */
  url?: string;
  /** koľko záznamov zdroj na dopyt vrátil (null = zdroj počet neuvádza) */
  returned: number | null;
  /** koľko z nich zodpovedalo preverovanému subjektu */
  matched: number;
  note?: string;
}

/**
 * Záznam vyhľadávania v zdroji – do protokolu: čo sa prehľadalo, ako, koľko záznamov a podľa akého pravidla sa rozhodlo.
 * Bez neho by „nenájdené“ nebolo preskúmateľné (podnet 10/2026: chybné nastavenie zdroja sa prejavilo len ako „nie je v zozname“).
 */
export interface SearchLog {
  /** zdroj a zoznam (dataset) */
  dataset: string;
  queries: SearchQuery[];
  /** pravidlo zhody slovami (napr. „zhoda IČO“, „celé obchodné meno vrátane právnej formy“) */
  rule: string;
  /** veľkosť zoznamu, ak ju zdroj uvádza */
  total?: number | null;
  /** stav zoznamu k (dátum aktualizácie), ak ho zdroj uvádza */
  asOf?: string;
  /** ukážka vrátených záznamov, ktoré sa NEzhodovali – na kontrolu, či hľadanie mieri správne */
  sample?: string[];
}

export interface CheckResult {
  id: string;
  category: CategoryId;
  name: string;
  source: string;
  sourceUrl: string;
  /** Odkaz na overenie konkrétneho subjektu priamo v zdroji. */
  verifyUrl?: string;
  status: CheckStatus;
  summary: string;
  findings: Finding[];
  data?: Record<string, unknown>;
  checkedAt: string;
  durationMs: number;
  automated: boolean;
  /** Výsledok z vyrovnávacej pamäte servera (čas uloženia) – registre sa menia nanajvýš denne, opakované preverenia ich nezaťažujú. */
  cachedAt?: string;
  /** Vyplnené, ak výsledok pochádza zo záložného AI vyhľadávania. */
  ai?: {
    provider: string;
    model: string;
    at: string;
    evidence: { url: string; quote?: string }[];
    rawResult?: string;
    rejected?: string;
    usage?: unknown;
    /** browser = agent s prehliadačom na serveri (vyplnil formulár), web = webové vyhľadávanie/načítanie stránok */
    mode?: "browser" | "web";
    /** Počet krokov agenta a stručný záznam akcií (otvoriť / vyplniť / kliknúť) */
    steps?: number;
    trace?: string[];
    note?: string;
  };
  /** Ako sa v zdroji hľadalo (dopyty, počty záznamov, pravidlo zhody) – zobrazí sa pri kontrole aj v protokole. */
  search?: SearchLog[];
  /** Vyplnené, ak výsledok určil poverený zamestnanec manuálne (s prípadnou poznámkou, čo zistil). */
  manual?: { answer: "clean" | "found"; note?: string };
}

export type CategoryId =
  | "register"
  | "tax"
  | "insurance"
  | "insolvency"
  | "financials"
  | "public"
  | "media"
  | "deal";

export const CATEGORIES: Record<CategoryId, string> = {
  register: "Obchodný register a identifikácia",
  tax: "Dane a DPH",
  insurance: "Sociálna a zdravotné poisťovne",
  insolvency: "Konkurz, reštrukturalizácia, exekúcie",
  financials: "Účtovné závierky a hospodárenie",
  public: "Verejný sektor",
  media: "Médiá a internet",
  deal: "Údaje o obchode a indikátory rizika",
};

export interface CompanyProfile {
  /** Názov a sídlo z Registra účtovných závierok – záloha, keď Register právnických osôb neodpovie včas */
  ruzName?: string;
  ruzAddress?: string;
  ico: string;
  dic?: string;
  icDph?: string;
  name?: string;
  formerNames?: string[];
  address?: string;
  legalForm?: string;
  established?: string;
  terminated?: string;
  registrationOffice?: string;
  registrationNumber?: string;
  mainActivity?: string;
  statutory?: { name: string; role: string; since?: string }[];
  equity?: number;
  activities?: string[];
  owners?: { name: string; role: string; since?: string; country?: string }[];
  lastOwnershipChange?: string;
  lastStatutoryChange?: string;
  /** IČO sa v Registri právnických osôb nenašlo – ostatné kontroly sa nevykonávajú. */
  notFound?: boolean;
}

export type VerdictLevel = "recommended" | "caution" | "not_recommended";

export interface Verdict {
  level: VerdictLevel;
  label: string;
  score: number;
  reasons: string[];
  preliminary: boolean;
  pendingManual: number;
}

/** Odpoveď na jednu z kľúčových otázok (prehľad na začiatku protokolu). */
export interface KeyFact {
  id: string;
  question: string;
  answer: string;
  /** good = v poriadku, bad = riziko, warn = pozor, neutral = informácia, unknown = nezistené */
  tone: "good" | "bad" | "warn" | "neutral" | "unknown";
  source?: string;
}

export interface ScanReport {
  scanId: string;
  ico: string;
  scannedAt: string;
  profile: CompanyProfile;
  checks: CheckResult[];
  verdict: Verdict;
  appVersion: string;
  keyFacts: KeyFact[];
  /** IČO nebolo nájdené v registri – preverenie sa skončilo pri obchodnom registri. */
  notFound?: boolean;
  /** Spojenie sa prerušilo pred koncom preverenia – nedokončené zdroje sú označené ako nedostupné. */
  incomplete?: boolean;
  /** Spätné preverenie: rozhodný dátum začiatku spolupráce (protokol je vyhotovený dnes, k tomuto dátumu uvádza, čo bolo zistiteľné). */
  asOf?: string;
  /** Kto preverenie spustil – len meno povereného zamestnanca, bez e-mailu (doplní API; e-mail ostáva v audite). */
  scannedBy?: string;
  /** Názov firmy, ktorá preverenie vykonala (do hlavičky protokolu) */
  orgName?: string;
  /** Dostupnosť záložného AI vyhľadávania (doplní API). */
  ai?: { available: boolean; auto?: boolean; noApiSources?: boolean; provider?: string };
}

/** Kontext zdieľaný medzi kontrolami (výstup RPO / RÚZ pre ďalšie kroky). */
export interface Ctx {
  ico: string;
  profile: CompanyProfile;
  /** Splnené po dokončení identifikácie (RPO) – ostatné kontroly naň čakajú len ak potrebujú meno/vek. */
  rpoDone?: Promise<unknown>;
  /** Splnené, keď je známe DIČ (z RÚZ) alebo je jasné, že nie je. */
  dicReady?: Promise<unknown>;
  /** Interné: vyriešenie dicReady. */
  resolveDic?: () => void;
  /** Rozhodný dátum existujúcej spolupráce (YYYY-MM-DD) – zdroje doplnia, čo bolo k tomuto dňu zistiteľné (spätné preverenie, len verzia Rozšírené). */
  asOf?: string;
}
