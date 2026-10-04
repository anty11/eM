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
  /** Vyplnené, ak výsledok pochádza zo záložného AI vyhľadávania. */
  ai?: {
    provider: string;
    model: string;
    at: string;
    evidence: { url: string; quote?: string }[];
    rawResult?: string;
    rejected?: string;
    usage?: unknown;
  };
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
  /** Kto preverenie spustil (doplní API). */
  scannedBy?: string;
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
}
