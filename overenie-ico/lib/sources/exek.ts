import { fetchWithTimeout } from "../http";
import type { CheckResult, Ctx, Finding, SearchLog } from "../types";
import { sq } from "../searchlog";
import { MANUAL } from "./manual";
import { flatten, recordsOf, type DiskvRecord } from "./diskv";

/**
 * Exekúcie – poverenia na vykonanie exekúcie (Ministerstvo spravodlivosti SR, aplikácia Infosud, obcan.justice.sk/pilot/poverenia).
 * Zverejňujú sa poverenia Okresného súdu Banská Bystrica vydané od 1. 4. 2017 (Exekučný poriadok), a len z PREBIEHAJÚCICH exekučných
 * konaní – skončené exekúcie a konania začaté pred 1. 4. 2017 tu nie sú; úplný prehľad dáva len Centrálny register exekúcií (CRE,
 * spoplatnený výpis). Preto aj „bez záznamu“ nesie túto výhradu.
 *
 * Stránka je obal aplikácie React ako register diskvalifikácií; dáta dáva API tej istej služby (ress-isu-service). Presný názov zdroja
 * v API nie je potvrdený – skúšajú sa kandidáti, správny je ten, ktorý vráti JSON s `numFound` (nezmyselný výraz → 0). Hostiteľ blokuje
 * dátové centrá → ide sa cez proxy z Administrácie (rovnako ako diskvalifikácie).
 */
export const EXEK_PAGE = "https://obcan.justice.sk/pilot/poverenia/";
const API_BASE = "https://obcan.justice.sk/pilot/api/ress-isu-service/v1";
/** Kandidáti na názov zdroja v API (overí sa diagnostikou `exek`; prvý funkčný sa zapamätá v pamäti inštancie). */
export const EXEK_RESOURCES = ["poverenia", "poverenie", "exekucie", "exekucia", "poverenia-exekucie"];
const SINCE = "1. 4. 2017";
const CAVEAT = `zoznam obsahuje len poverenia na vykonanie exekúcie vydané Okresným súdom Banská Bystrica od ${SINCE} a len z prebiehajúcich konaní – skončené exekúcie a konania začaté pred ${SINCE} v ňom nie sú; úplný prehľad dáva Centrálny register exekúcií (CRE)`;

let resourceMemo: { exp: number; value: string } | null = null;

async function getJson(url: string): Promise<{ status: number; json: any }> {
  const r = await fetchWithTimeout(url, { headers: { Accept: "application/json" }, timeoutMs: 12000 });
  const txt = await r.text();
  let json: any = null;
  try {
    json = JSON.parse(txt);
  } catch {
    /* nie je JSON (HTML obal) */
  }
  return { status: r.status, json };
}

/** Nájde zdroj API: pri nezmyselnom výraze musí vrátiť JSON s numFound = 0. */
export async function exekResource(): Promise<{ resource: string; tried: Record<string, string> }> {
  const tried: Record<string, string> = {};
  if (resourceMemo && resourceMemo.exp > Date.now()) return { resource: resourceMemo.value, tried };
  const probe = "qxzvwkj";
  for (const res of process.env.EXEK_API_RESOURCE ? [process.env.EXEK_API_RESOURCE] : EXEK_RESOURCES) {
    try {
      const { status, json } = await getJson(`${API_BASE}/${res}?query=${probe}&page=1&size=5`);
      const got = recordsOf(json);
      tried[res] = `HTTP ${status}, numFound ${got.total ?? "–"}`;
      if (status === 200 && got.total === 0) {
        resourceMemo = { exp: Date.now() + 6 * 3600e3, value: res };
        return { resource: res, tried };
      }
    } catch (e) {
      tried[res] = `chyba: ${(e as Error).message.slice(0, 80)}`;
    }
  }
  throw Object.assign(new Error(`API poverení sa nenašlo (${Object.entries(tried).map(([k, v]) => `${k}: ${v}`).join("; ")})`), { tried });
}

export function matchExek(r: DiskvRecord, ico: string): boolean {
  return Object.values(r).some((v) => v.replace(/\s/g, "") === ico || new RegExp(`(^|\\D)${ico}(\\D|$)`).test(v));
}

export function describeExek(r: DiskvRecord): string {
  return Object.entries(r)
    .filter(([k, v]) => v && !/guid|suradnic|zemepis|^id$/i.test(k))
    .slice(0, 8)
    .map(([k, v]) => `${k.split(".").pop()}: ${v}`)
    .join(" · ")
    .slice(0, 400);
}

/** Kontrola pre preverenie; vracia aj pri neúspechu (manuálne so záznamom, čo sa skúšalo). */
export async function checkExek(ctx: Ctx): Promise<CheckResult> {
  const def = MANUAL.find((m) => m.id === "exek")!;
  const t0 = Date.now();
  const base = { id: def.id, category: def.category, name: def.name, source: def.source, sourceUrl: def.sourceUrl, verifyUrl: EXEK_PAGE, checkedAt: new Date().toISOString() };
  const dataset = "Poverenia na vykonanie exekúcie (MS SR, API Infosud – obcan.justice.sk/pilot/poverenia)";
  let url = `${API_BASE}/?query=${ctx.ico}`;
  try {
    const { resource } = await exekResource();
    url = `${API_BASE}/${resource}?query=${ctx.ico}&page=1&size=50`;
    const { status, json } = await getJson(url);
    if (status !== 200 || !json) throw new Error(`HTTP ${status}`);
    const got = recordsOf(json);
    if (got.total === null) throw new Error("odpoveď bez počtu záznamov (numFound)");
    const records = got.records.map((x) => flatten(x));
    const hits = records.filter((r) => matchExek(r, ctx.ico));
    const search: SearchLog[] = [
      {
        dataset,
        asOf: got.updateDate,
        queries: [sq("IČO", ctx.ico, got.total, hits.length, url, `prečítaných ${records.length}${records.length < got.total ? " – NIE všetky" : ""}`)],
        rule: `poverenie s IČO subjektu (povinný); ${CAVEAT}`,
        sample: records.filter((r) => !matchExek(r, ctx.ico)).slice(0, 3).map(describeExek),
      },
    ];
    const asOf = got.updateDate ? `, stav k ${got.updateDate}` : "";
    if (hits.length) {
      const f: Finding[] = [{ severity: def.severityIfFound, text: `Prebiehajúca exekúcia – poverenie na vykonanie exekúcie (${hits.length}×): ${describeExek(hits[0])}`, penalty: def.penaltyIfFound }];
      return { ...base, status: def.severityIfFound === "critical" ? "critical" : "warning", summary: `${hits.length} ${hits.length === 1 ? "poverenie" : hits.length < 5 ? "poverenia" : "poverení"} na vykonanie exekúcie s IČO subjektu${asOf}: ${hits.slice(0, 3).map(describeExek).join("; ")}. Pozn.: ${CAVEAT}.`, findings: f, search, data: { penaltyIfFound: def.penaltyIfFound, severityIfFound: def.severityIfFound, rows: hits.slice(0, 10).map(describeExek), queriedUrl: url, updateDate: got.updateDate }, durationMs: Date.now() - t0, automated: true };
    }
    if (got.total > 0 && records.length < got.total)
      return { ...base, status: "manual", summary: `Dopyt podľa IČO vrátil ${got.total} záznamov, prečítalo sa len ${records.length} a žiadny nemá IČO subjektu – overte manuálne.`, findings: [], search, data: { penaltyIfFound: def.penaltyIfFound, severityIfFound: def.severityIfFound }, durationMs: Date.now() - t0, automated: false };
    return {
      ...base,
      status: "ok",
      summary: `Bez záznamu – žiadne poverenie na vykonanie exekúcie s IČO subjektu (dopyt podľa IČO vrátil ${got.total} záznamov${asOf}). UPOZORNENIE: ${CAVEAT}.`,
      findings: [{ severity: "info", text: `Exekúcie: bez poverenia v zozname MS SR (len prebiehajúce konania s poverením od ${SINCE}; skončené a staršie exekúcie tu nie sú – pri významnom obchode overte v CRE)`, penalty: 0 }],
      search,
      data: { penaltyIfFound: def.penaltyIfFound, severityIfFound: def.severityIfFound, rows: [], queriedUrl: url, updateDate: got.updateDate, coverageSince: "2017-04-01" },
      durationMs: Date.now() - t0,
      automated: true,
    };
  } catch (e) {
    const tried = (e as Error & { tried?: Record<string, string> }).tried;
    return {
      ...base,
      status: "manual",
      summary: `${def.note} (automatický dopyt zlyhal: ${(e as Error).message.slice(0, 160)})`,
      findings: [],
      search: [{ dataset, queries: [sq("IČO", ctx.ico, null, 0, url, `chyba: ${(e as Error).message.slice(0, 120)}${tried ? `; skúšané zdroje API: ${Object.entries(tried).map(([k, v]) => `${k} (${v})`).join(", ")}` : ""}`)], rule: `poverenie s IČO subjektu; ${CAVEAT}` }],
      data: { penaltyIfFound: def.penaltyIfFound, severityIfFound: def.severityIfFound, autoError: (e as Error).message.slice(0, 300) },
      durationMs: Date.now() - t0,
      automated: false,
    };
  }
}
