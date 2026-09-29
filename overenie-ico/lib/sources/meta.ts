import type { CategoryId, CheckResult } from "../types";

/** Automatické zdroje v poradí zobrazenia (zdieľané so serverom aj prehliadačom). */
export const META: Record<string, { name: string; category: CategoryId; source: string; sourceUrl: string }> = {
  rpo: { name: "Obchodný register / Register právnických osôb", category: "register", source: "Štatistický úrad SR – RPO", sourceUrl: "https://rpo.statistics.sk" },
  ruz: { name: "Register účtovných závierok", category: "financials", source: "Ministerstvo financií SR – registeruz.sk", sourceUrl: "https://www.registeruz.sk" },
  "fs-debtors": { name: "Zoznam daňových dlžníkov", category: "tax", source: "Finančná správa SR – OpenData", sourceUrl: "https://opendata.financnasprava.sk" },
  "fs-vat": { name: "Registrácia DPH a dôvody na zrušenie", category: "tax", source: "Finančná správa SR – OpenData", sourceUrl: "https://opendata.financnasprava.sk" },
  "fs-ids": { name: "Index daňovej spoľahlivosti", category: "tax", source: "Finančná správa SR – OpenData", sourceUrl: "https://opendata.financnasprava.sk" },
  "fs-dppo": { name: "Daňové priznanie k dani z príjmov", category: "tax", source: "Finančná správa SR – OpenData", sourceUrl: "https://opendata.financnasprava.sk" },
  socpoist: { name: "Dlžníci Sociálnej poisťovne", category: "insurance", source: "Sociálna poisťovňa – zoznam dlžníkov", sourceUrl: "https://www.socpoist.sk/nastroje-sluzby/zoznam-dlznikov" },
  insolvency: { name: "Register úpadcov a likvidácií (konkurz, reštrukturalizácia, likvidácia)", category: "insolvency", source: "Ministerstvo spravodlivosti SR – REPLIK", sourceUrl: "https://replik.justice.sk/ru-verejnost-web/" },
  rpvs: { name: "Register partnerov verejného sektora", category: "public", source: "Ministerstvo spravodlivosti SR – RPVS", sourceUrl: "https://rpvs.gov.sk/rpvs" },
  news: { name: "Médiá a internet (PR, správy)", category: "media", source: "Google News, Bing News a Bing web (SK)", sourceUrl: "https://news.google.com" },
};

export const AUTO_ORDER = Object.keys(META);

/** Zástupný výsledok počas overovania. */
export function pendingCheck(id: string): CheckResult {
  return { id, ...META[id], status: "pending", summary: "Overuje sa…", findings: [], checkedAt: new Date().toISOString(), durationMs: 0, automated: true };
}
