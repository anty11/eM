import type { CategoryId, CheckResult, Ctx } from "../types";

/**
 * Registre bez verejného strojového prístupu (spoplatnené, s prihlásením alebo s výslovným zákazom
 * automatizovaného overovania). Aplikácia pripraví presný odkaz a advokát výsledok potvrdí v rozhraní –
 * potvrdenie sa zapíše do protokolu a prepočíta verdikt.
 */
interface ManualDef {
  id: string;
  category: CategoryId;
  name: string;
  source: string;
  sourceUrl: string;
  verifyUrl: (ico: string, name?: string) => string;
  note: string;
  /** Postih do skóre, ak advokát potvrdí negatívny záznam. */
  penaltyIfFound: number;
  severityIfFound: "critical" | "warning";
}

export const MANUAL: ManualDef[] = [
  {
    id: "cre",
    category: "insolvency",
    name: "Centrálny register exekúcií",
    source: "Slovenská komora exekútorov – CRE",
    sourceUrl: "https://cre.sk",
    verifyUrl: () => "https://cre.sk",
    note: "Výpis je spoplatnený a vyžaduje registráciu (advokáti majú prístup cez účet). Overte, či je vedená exekúcia voči subjektu.",
    penaltyIfFound: 40,
    severityIfFound: "critical",
  },
  {
    id: "vszp",
    category: "insurance",
    name: "Dlžníci Všeobecnej zdravotnej poisťovne",
    source: "VšZP – zoznam dlžníkov",
    sourceUrl: "https://www.vszp.sk/platitelia/platenie-poistneho/zoznam-dlznikov.html",
    verifyUrl: () => "https://www.vszp.sk/platitelia/platenie-poistneho/zoznam-dlznikov.html",
    note: "Vyhľadajte v časti Zamestnávatelia a SZČO podľa IČO.",
    penaltyIfFound: 25,
    severityIfFound: "critical",
  },
  {
    id: "dovera",
    category: "insurance",
    name: "Dlžníci zdravotnej poisťovne Dôvera",
    source: "Dôvera – zoznam dlžníkov",
    sourceUrl: "https://www.dovera.sk/overenia/dlznici/zoznam-dlznikov",
    verifyUrl: () => "https://www.dovera.sk/overenia/dlznici/zoznam-dlznikov",
    note: "Dôvera výslovne neumožňuje automatizované overovanie – vyhľadajte podľa IČO.",
    penaltyIfFound: 25,
    severityIfFound: "critical",
  },
  {
    id: "union",
    category: "insurance",
    name: "Dlžníci zdravotnej poisťovne Union",
    source: "Union ZP – zoznam dlžníkov",
    sourceUrl: "https://portal.unionzp.sk/pub/dlznici",
    verifyUrl: () => "https://portal.unionzp.sk/pub/dlznici",
    note: "Vyhľadajte podľa IČO alebo obchodného mena.",
    penaltyIfFound: 25,
    severityIfFound: "critical",
  },
  {
    id: "ov",
    category: "insolvency",
    name: "Obchodný vestník",
    source: "Ministerstvo spravodlivosti SR – Obchodný vestník",
    sourceUrl: "https://obchodnyvestnik.justice.gov.sk",
    verifyUrl: () => "https://obchodnyvestnik.justice.gov.sk/ObchodnyVestnik/Formular/FormulareZverejnene.aspx",
    note: "Skontrolujte oznámenia o likvidácii, konkurze, znížení imania, výzvach veriteľom a dražbách.",
    penaltyIfFound: 30,
    severityIfFound: "warning",
  },
  {
    id: "diskv",
    category: "register",
    name: "Register diskvalifikácií (štatutári)",
    source: "Ministerstvo spravodlivosti SR",
    sourceUrl: "https://www.justice.gov.sk",
    verifyUrl: () => "https://www.justice.gov.sk/registre/registerDiskvalifikacii/?pageNum=1&size=10",
    note: "Overte, či štatutárny orgán nemá zákaz výkonu funkcie (diskvalifikácia podľa § 13a ObZ).",
    penaltyIfFound: 25,
    severityIfFound: "critical",
  },
  {
    id: "uvo",
    category: "public",
    name: "Zákaz účasti vo verejnom obstarávaní",
    source: "Úrad pre verejné obstarávanie",
    sourceUrl: "https://www.uvo.gov.sk",
    verifyUrl: () => "https://www.uvo.gov.sk/zaujemca-uchadzac/registre-o-hospodarskych-subjektoch/register-osob-so-zakazom",
    note: "Relevantné najmä pri zákazkách pre verejný sektor.",
    penaltyIfFound: 15,
    severityIfFound: "warning",
  },
];

export function manualChecks(ctx: Ctx): CheckResult[] {
  const now = new Date().toISOString();
  return MANUAL.map((m) => ({
    id: m.id,
    category: m.category,
    name: m.name,
    source: m.source,
    sourceUrl: m.sourceUrl,
    verifyUrl: m.verifyUrl(ctx.ico, ctx.profile.name),
    status: "manual",
    summary: m.note,
    findings: [],
    data: { penaltyIfFound: m.penaltyIfFound, severityIfFound: m.severityIfFound },
    checkedAt: now,
    durationMs: 0,
    automated: false,
  }));
}
