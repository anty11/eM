import { fetchWithTimeout, fold } from "../http";
import { kv } from "../auth/kv";
import type { CheckResult, Ctx, Finding } from "../types";
import { MANUAL } from "./manual";

/**
 * Register diskvalifikácií (zákaz výkonu funkcie štatutára, § 13a ObZ) – Ministerstvo spravodlivosti SR.
 * Stránka justice.gov.sk/registre/registerDiskvalifikacii je len obal; dáta dáva API aplikácie Infosud (ISU):
 *   GET https://obcan.justice.sk/pilot/api/ress-isu-service/v1/diskvalifikacia?page=1&size=10
 *   → { numFound, page (od 0), size, updateDate, filterList: [fazety], <zoznam záznamov> }
 * (zistené diagnostikou 6. 10. 2026 – 992 záznamov; zoznam `diskvalifikaciaList`, záznam { registreGuid, meno, datumRozhodnutia, sud, adresa,
 *  suradnice }; IČO ani dátum narodenia v zázname nie sú). Fulltext `?query=` ignoruje diakritiku (Szabó nájde aj Szabo). Oba hostitelia blokujú dátové centrá → ide sa cez proxy z Administrácie.
 *
 * Pri každom preverení sa register pýta nanovo – podľa IČO a podľa priezviska každého štatutára (nič sa nesťahuje ani neukladá,
 * pamätá sa len názov parametra vyhľadávania). Zhoda IČO = nález; zhoda mena a priezviska = možná zhoda (overiť totožnosť – RPO
 * nezverejňuje dátum narodenia), preto verdikt najviac „S výhradou“, nie „Neodporúčame“.
 */
export const DISKV_API = "https://obcan.justice.sk/pilot/api/ress-isu-service/v1/diskvalifikacia";
export const DISKV_PAGE = "https://www.justice.gov.sk/registre/registerDiskvalifikacii/";
const PARAM_KEY = "diskv:param";
const LOOKUP_SIZE = 50;
/** Adresa API (DISKV_API_URL len pre testy). */
const apiUrl = () => process.env.DISKV_API_URL || DISKV_API;

export type DiskvRecord = Record<string, string>;

/** Zoznam záznamov v odpovedi – prvé pole objektov okrem fazet (názov poľa nepoznáme naisto, napr. diskvalifikaciaList). */
export function recordsOf(j: any): { total: number | null; records: any[]; key?: string; updateDate?: string } {
  if (!j || typeof j !== "object") return { total: null, records: [] };
  if (Array.isArray(j)) return { total: j.length, records: j.filter((x) => x && typeof x === "object") };
  const total = typeof j.numFound === "number" ? j.numFound : typeof j.totalElements === "number" ? j.totalElements : null;
  for (const [k, v] of Object.entries(j)) {
    if (k === "filterList" || !Array.isArray(v)) continue;
    if (v.length === 0 || (v[0] && typeof v[0] === "object" && !("facetValueList" in v[0]))) return { total, records: v, key: k, updateDate: j.updateDate };
  }
  return { total, records: [], updateDate: j.updateDate };
}

/** Záznam → ploché textové polia (vnorené kľúče s bodkou), dlhé hodnoty skrátené. */
export function flatten(o: any, prefix = "", out: DiskvRecord = {}): DiskvRecord {
  if (o == null) return out;
  if (typeof o !== "object") {
    const v = String(o).replace(/\s+/g, " ").trim();
    if (v) out[prefix || "value"] = v.slice(0, 200);
    return out;
  }
  if (Array.isArray(o)) {
    o.slice(0, 5).forEach((x, i) => flatten(x, `${prefix}[${i}]`, out));
    return out;
  }
  for (const [k, v] of Object.entries(o)) flatten(v, prefix ? `${prefix}.${k}` : k, out);
  return out;
}

const TITLES = /^(ing|mgr|judr|mudr|mvdr|phdr|paeddr|rndr|rsdr|thdr|doc|prof|bc|dipl|arch|akad|mba|phd|csc|drsc|llm|msc|bsc|ma|ba|art|dr)$/;

/** Meno štatutára → krstné mená a priezvisko (bez titulov), zložené na malé písmená bez diakritiky; `raw` = priezvisko ako v RPO (na dopyt). */
export function nameParts(name: string): { given: string[]; surname: string; raw: string } | null {
  const words = name
    .replace(/,.*$/, "")
    .split(/\s+/)
    .map((w) => w.replace(/[^\p{L}-]/gu, ""))
    .filter((w) => w.length > 1 && !TITLES.test(fold(w)));
  if (words.length < 2) return null;
  const f = words.map((w) => fold(w));
  return { given: f.slice(0, -1), surname: f[f.length - 1], raw: words[words.length - 1] };
}

const word = (text: string, w: string) => new RegExp(`(^|[^a-z])${w.replace(/[.*+?^${}()|[\]\\-]/g, "\\$&")}([^a-z]|$)`).test(text);

/** Zhoda záznamu s firmou: IČO kdekoľvek v zázname, alebo meno + priezvisko štatutára. */
export function matchRecord(r: DiskvRecord, ico: string, names: string[]): { by: "ico" | "name"; who?: string } | null {
  const values = Object.values(r);
  if (values.some((v) => v.replace(/\s/g, "") === ico || new RegExp(`(^|\\D)${ico}(\\D|$)`).test(v))) return { by: "ico" };
  const text = fold(values.join(" | "));
  for (const n of names) {
    const p = nameParts(n);
    if (p && word(text, p.surname) && word(text, p.given[0])) return { by: "name", who: n };
  }
  return null;
}

/** Krátky popis záznamu do protokolu (polia API: meno, datumRozhodnutia, sud, adresa; bez guid a súradníc). */
export function describeRecord(r: DiskvRecord): string {
  const label: Record<string, string> = { meno: "", datumRozhodnutia: "rozhodnutie", sud: "súd", adresa: "adresa" };
  const known = Object.keys(label).filter((k) => r[k]);
  if (known.length) return known.map((k) => (label[k] ? `${label[k]} ${r[k]}` : r[k])).join(" · ").slice(0, 400);
  return Object.entries(r)
    .filter(([k]) => !/guid|suradnic|zemepis/i.test(k))
    .map(([k, v]) => `${k.split(".").pop()}: ${v}`)
    .join(" · ")
    .slice(0, 400);
}

/** Kandidáti na parameter vyhľadávania API (zistí sa za behu: správny parameter pri nezmyselnom výraze vráti numFound = 0). */
export const SEARCH_PARAMS = ["query", "q", "text", "hladanyText", "meno", "priezvisko", "ico"];
const PROBE = "qxzvwkj";
let paramMemo: { exp: number; value: string } | null = null;

async function getApi(qs: string, timeoutMs = 12000): Promise<any> {
  const r = await fetchWithTimeout(`${apiUrl()}?${qs}`, { headers: { Accept: "application/json" }, timeoutMs });
  if (!r.ok) throw new Error(`register diskvalifikácií: HTTP ${r.status}${r.status === 403 ? " (blokované – nastavte proxy v Administrácii → Prístupy)" : ""}`);
  const j = await r.json().catch(() => null);
  if (recordsOf(j).total == null) throw new Error("register diskvalifikácií: neznámy tvar odpovede (chýba numFound)");
  return j;
}

/** Ktorý parameter API filtruje – pamätá sa (nie dáta, len názov parametra) v inštancii 12 h a v Redise 7 dní. */
export async function searchParam(): Promise<string> {
  if (paramMemo && paramMemo.exp > Date.now()) return paramMemo.value;
  const stored = await kv().get<string>(PARAM_KEY).catch(() => null);
  if (stored) {
    paramMemo = { exp: Date.now() + 12 * 3600e3, value: stored };
    return stored;
  }
  for (const k of SEARCH_PARAMS) {
    const j = await getApi(`${k}=${PROBE}&page=1&size=1`).catch(() => null);
    if (j && recordsOf(j).total === 0) {
      paramMemo = { exp: Date.now() + 12 * 3600e3, value: k };
      await kv().set(PARAM_KEY, k, 7 * 86400).catch(() => {});
      return k;
    }
  }
  throw new Error("register diskvalifikácií: API nefiltruje podľa žiadneho známeho parametra (pošlite diagnostiku)");
}

/** Jeden dopyt do registra podľa výrazu (IČO alebo priezvisko) – vráti nájdené záznamy a či sú kompletné. */
export async function lookupDiskv(term: string): Promise<{ total: number; records: DiskvRecord[]; complete: boolean; updateDate?: string; url: string }> {
  const k = await searchParam();
  const qs = (page: number) => `${k}=${encodeURIComponent(term)}&page=${page}&size=${LOOKUP_SIZE}`;
  const j = await getApi(qs(1));
  const got = recordsOf(j);
  const records = got.records.map((x) => flatten(x));
  // časté priezvisko (viac ako 50 záznamov) – ďalšie strany toho istého dopytu, najviac 4
  for (let page = 2; page <= 4 && records.length < got.total! && got.records.length; page++) {
    const more = recordsOf(await getApi(qs(page))).records;
    if (!more.length) break;
    records.push(...more.map((x) => flatten(x)));
  }
  return { total: got.total!, records, complete: records.length >= got.total!, updateDate: got.updateDate, url: `${apiUrl()}?${qs(1)}` };
}

/** Kontrola pre preverenie; null = nedá sa rozhodnúť (ostáva manuálne overenie). */
export async function checkDiskv(ctx: Ctx): Promise<CheckResult | null> {
  const def = MANUAL.find((m) => m.id === "diskv")!;
  const t0 = Date.now();
  const names = Array.from(new Set((ctx.profile.statutory || []).map((s) => s.name).filter(Boolean)));
  const terms = [ctx.ico, ...Array.from(new Set(names.map((n) => nameParts(n)?.raw).filter(Boolean) as string[])).slice(0, 8)];
  const results = await Promise.all(terms.map((t) => lookupDiskv(t)));
  const records = results.flatMap((r) => r.records);
  const complete = results.every((r) => r.complete);
  const updateDate = results.find((r) => r.updateDate)?.updateDate;
  const seen = new Set<string>();
  const hits = records
    .map((r) => ({ r, m: matchRecord(r, ctx.ico, names) }))
    .filter((x) => x.m)
    .filter((x) => {
      const id = JSON.stringify(x.r);
      return seen.has(id) ? false : (seen.add(id), true);
    });
  const byIco = hits.filter((h) => h.m!.by === "ico");
  const asOf = updateDate ? `, stav registra k ${updateDate}` : "";
  const f: Finding[] = [];
  let summary: string;
  let status: CheckResult["status"];
  if (byIco.length) {
    f.push({ severity: "critical", text: `Register diskvalifikácií: záznam s IČO firmy – ${describeRecord(byIco[0].r)}`, penalty: def.penaltyIfFound });
    summary = `Záznam s IČO firmy v registri diskvalifikácií${asOf}.`;
    status = "critical";
  } else if (hits.length) {
    const who = Array.from(new Set(hits.map((h) => h.m!.who))).join(", ");
    f.push({
      severity: "warning",
      text: `Register diskvalifikácií: možná zhoda mena štatutára (${who}) – ${describeRecord(hits[0].r)}`,
      penalty: def.penaltyIfFound,
      cap: "caution",
      ask: `Overte totožnosť: je ${who} tá istá osoba ako v registri diskvalifikácií (porovnajte adresu v zázname s adresou štatutára v obchodnom registri)? Výsledok zaznamenajte.`,
    });
    summary = `Možná zhoda mena štatutára v registri diskvalifikácií (${hits.length} ${hits.length === 1 ? "záznam" : "záznamy"})${asOf} – treba overiť totožnosť.`;
    status = "warning";
  } else {
    if (!complete || !names.length) return null; // neprečítané všetky výsledky alebo nepoznáme štatutárov → nerozhodujeme
    summary = `Bez záznamu – register diskvalifikácií nemá záznam pre IČO ani pre štatutárov (${names.length})${asOf}.`;
    status = "ok";
  }
  return {
    id: def.id,
    category: def.category,
    name: def.name,
    source: def.source,
    sourceUrl: def.sourceUrl,
    verifyUrl: DISKV_PAGE,
    status,
    summary,
    findings: f,
    data: { penaltyIfFound: def.penaltyIfFound, severityIfFound: def.severityIfFound, rows: hits.slice(0, 5).map((h) => describeRecord(h.r)), queriedUrl: results[0]?.url, queries: results.map((r) => r.url), updateDate, checkedNames: names },
    checkedAt: new Date().toISOString(),
    durationMs: Date.now() - t0,
    automated: true,
  };
}
