import type { SearchLog, SearchQuery } from "./types";

/**
 * Záznam vyhľadávania ľudskými slovami (do protokolu aj na obrazovku): čo sa prehľadalo, podľa čoho, koľko záznamov zdroj vrátil,
 * koľko sa zhodovalo a podľa akého pravidla. Bez závislostí – používa ho server aj prehliadač.
 */
const n = (x: number) => x.toLocaleString("sk-SK");
const records = (x: number) => (x === 1 ? "záznam" : x >= 2 && x <= 4 ? "záznamy" : "záznamov");

export function queryLine(q: SearchQuery): string {
  const got = q.returned === null ? "počet záznamov zdroj neuvádza" : `vrátil ${n(q.returned)} ${records(q.returned)}`;
  return `podľa ${q.by} „${q.value}“ – ${got}, zhoda ${n(q.matched)}${q.note ? ` (${q.note})` : ""}`;
}

export function searchLine(s: SearchLog): string {
  const head = `${s.dataset}${s.total ? ` (${n(s.total)} ${records(s.total)}` + (s.asOf ? `, stav k ${s.asOf})` : ")") : s.asOf ? ` (stav k ${s.asOf})` : ""}`;
  const qs = s.queries.length ? s.queries.map(queryLine).join("; ") : "žiadny dopyt sa nevykonal";
  return `Prehľadané: ${head} – ${qs}. Pravidlo zhody: ${s.rule}.`;
}

/** Pomocník na zostavenie dopytu. */
export const sq = (by: string, value: string, returned: number | null, matched: number, url?: string, note?: string): SearchQuery => ({ by, value, returned, matched, ...(url ? { url } : {}), ...(note ? { note } : {}) });
