import type { CategoryId, CheckResult, Ctx } from "../types";

/**
 * Registre bez verejného strojového prístupu (spoplatnené, s prihlásením alebo s výslovným zákazom
 * automatizovaného overovania). Aplikácia pripraví presný odkaz a poverený zamestnanec výsledok potvrdí v rozhraní –
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
  /** Postih do skóre, ak poverený zamestnanec potvrdí negatívny záznam. */
  penaltyIfFound: number;
  severityIfFound: "critical" | "warning";
}

/**
 * ZAPARKOVANÉ – Centrálny register exekúcií (CRE, Slovenská komora exekútorov): výpis je spoplatnený (1,60 € za dopyt) a vyžaduje
 * registráciu prevádzkovateľa + certifikát k webovej službe. Exekúcie sa od v2.11.12 overujú zo zoznamu poverení MS SR (`exek`),
 * preto CRE nie je v preverení. Možný budúci doplnok pre klienta (platený výpis CRE na vyžiadanie) – definícia ostáva tu:
 */
export const CRE_PARKED: ManualDef = {
  id: "cre",
  category: "insolvency",
  name: "Centrálny register exekúcií",
  source: "Slovenská komora exekútorov – CRE",
  sourceUrl: "https://cre.sk",
  verifyUrl: () => "https://cre.sk",
  note: "Výpis je spoplatnený (1,60 € za dopyt) a vyžaduje registráciu na portáli Slovenskej komory exekútorov; automatické overenie cez webovú službu CRE bude dostupné po registrácii prevádzkovateľa a nastavení certifikátu. Overte, či je vedená exekúcia voči subjektu.",
  penaltyIfFound: 40,
  severityIfFound: "critical",
};

export const MANUAL: ManualDef[] = [
  {
    id: "exek",
    category: "insolvency",
    name: "Exekúcie – poverenia na vykonanie exekúcie",
    source: "Ministerstvo spravodlivosti SR – zoznam poverení (Infosud)",
    sourceUrl: "https://obcan.justice.sk/pilot/poverenia/",
    verifyUrl: () => "https://obcan.justice.sk/pilot/poverenia/",
    note: "Automatický dopyt do zoznamu poverení sa nepodaril – overte ručne podľa IČO. Zoznam obsahuje len poverenia Okresného súdu Banská Bystrica vydané od 1. 4. 2017 z prebiehajúcich exekučných konaní (skončené a staršie exekúcie tu nie sú – úplný prehľad dáva CRE).",
    penaltyIfFound: 25,
    severityIfFound: "warning",
  },
  {
    id: "vszp",
    category: "insurance",
    name: "Dlžníci Všeobecnej zdravotnej poisťovne",
    source: "VšZP – zoznam dlžníkov",
    sourceUrl: "https://www.vszp.sk/platitelia/platenie-poistneho/zoznam-dlznikov.html",
    verifyUrl: () => "https://www.vszp.sk/platitelia/platenie-poistneho/zoznam-dlznikov.html",
    note: "Automatický dopyt do zoznamu VšZP sa nepodaril – vyhľadajte v časti Zamestnávatelia a SZČO podľa IČO.",
    penaltyIfFound: 25,
    severityIfFound: "critical",
  },
  {
    id: "dovera",
    category: "insurance",
    name: "Dlžníci zdravotnej poisťovne Dôvera",
    source: "Dôvera – zoznam dlžníkov",
    sourceUrl: "https://www.dovera.sk/overenia/dlznici/zoznam-dlznikov",
    verifyUrl: (ico: string) => `https://www.dovera.sk/overenia/dlznici/zoznam-dlznikov?q=${ico}`,
    note: "Dôvera automatizované overovanie svojho zoznamu dlžníkov na stránke zakazuje; automaticky sa overuje cez licencovaný agregátor FirmAPI.sk (kľúč v Administrácii → Prístupy). Bez kľúča, alebo keď FirmAPI neodpovie, overte ručne – odkaz otvorí zoznam s IČO v adrese, po overení v prehliadači sa výsledok zobrazí sám.",
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
    note: "Automatický dopyt do zoznamu Union sa nepodaril – vyhľadajte podľa IČO alebo obchodného mena.",
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
    note: "Automatické vyhľadávanie v Obchodnom vestníku tentoraz neodpovedalo včas (stránka OV je chránená proti robotom a býva pomalá) – overte oznámenia o likvidácii, konkurze, znížení imania, výzvach veriteľom a dražbách tlačidlom AI overenia alebo ručne.",
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
    note: "Automatický dopyt do registra sa nepodaril – overte, či štatutárny orgán nemá zákaz výkonu funkcie (diskvalifikácia podľa § 13a ObZ).",
    penaltyIfFound: 25,
    severityIfFound: "critical",
  },
  {
    id: "uvo",
    category: "public",
    name: "Zákaz účasti vo verejnom obstarávaní",
    source: "Úrad pre verejné obstarávanie",
    sourceUrl: "https://www.uvo.gov.sk",
    verifyUrl: (ico: string) => `https://www.uvo.gov.sk/vyhladavanie/globalne-vyhladavanie?globalSearch=${ico}&searchType=OSZ`,
    note: "Automatický dopyt do registra ÚVO sa nepodaril – overte ručne; relevantné najmä pri zákazkách pre verejný sektor.",
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
