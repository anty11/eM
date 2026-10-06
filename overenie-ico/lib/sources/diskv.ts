import { fetchWithTimeout, fold } from "../http";
import { kv } from "../auth/kv";
import type { CheckResult, Ctx, Finding } from "../types";
import { MANUAL } from "./manual";

/**
 * Register diskvalifikácií (zákaz výkonu funkcie štatutára, § 13a ObZ) – Ministerstvo spravodlivosti SR.
 * Stránka justice.gov.sk/registre/registerDiskvalifikacii je len obal; dáta dáva API aplikácie Infosud (ISU):
 *   GET https://obcan.justice.sk/pilot/api/ress-isu-service/v1/diskvalifikacia?page=1&size=10
 *   → { numFound, page (od 0), size, updateDate, filterList: [fazety], <zoznam záznamov> }
 * (zistené diagnostikou 6. 10. 2026 – 992 záznamov). Oba hostitelia blokujú dátové centrá → ide sa cez proxy z Administrácie.
 *
 * Register je malý, preto si ho stiahneme celý (najviac raz za 6 h a denne cronom, uložený v Redise) a štatutárov porovnávame lokálne – nezávisle od toho,
 * ako sa volá parameter vyhľadávania. Zhoda IČO = nález; zhoda mena a priezviska = možná zhoda (overiť totožnosť – RPO nezverejňuje
 * dátum narodenia), preto verdikt najviac „S výhradou“, nie „Neodporúčame“.
 */
export const DISKV_API = "https://obcan.justice.sk/pilot/api/ress-isu-service/v1/diskvalifikacia";
export const DISKV_PAGE = "https://www.justice.gov.sk/registre/registerDiskvalifikacii/";
const KEY = "diskv:index";
/** Adresa API (DISKV_API_URL len pre testy). */
const apiUrl = () => process.env.DISKV_API_URL || DISKV_API;
const TTL_SEC = 6 * 3600; // register sa mení zriedka (updateDate), 6 h je kompromis medzi čerstvosťou a počtom dopytov cez proxy
const MAX_PAGES = 40;

export type DiskvRecord = Record<string, string>;
export interface DiskvIndex {
  at: string;
  updateDate?: string;
  total: number;
  records: DiskvRecord[];
  /** celý register stiahnutý (počet záznamov zodpovedá numFound) */
  complete: boolean;
}

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

/** Meno štatutára → krstné mená a priezvisko (bez titulov), zložené na malé písmená bez diakritiky. */
export function nameParts(name: string): { given: string[]; surname: string } | null {
  const words = fold(name.replace(/,.*$/, ""))
    .replace(/[^a-z\s.-]/g, " ")
    .split(/\s+/)
    .map((w) => w.replace(/\.+$/, ""))
    .filter((w) => w.length > 1 && !TITLES.test(w));
  if (words.length < 2) return null;
  return { given: words.slice(0, -1), surname: words[words.length - 1] };
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

/** Krátky popis záznamu do protokolu – polia s menom, súdom, dátumami a rozsahom zákazu. */
export function describeRecord(r: DiskvRecord): string {
  const pick = Object.entries(r).filter(([k]) => /meno|priezv|nazov|titul|narod|sud|datum|zakaz|trv|platn|od$|do$|dovod|spis|funkc|obec|mesto/i.test(k));
  const parts = (pick.length ? pick : Object.entries(r)).map(([k, v]) => `${k.split(".").pop()}: ${v}`);
  return parts.join(" · ").slice(0, 400);
}

/** Stiahne celý register (stránkovanie podľa numFound). */
export async function downloadDiskv(opts: { pageSize?: number; timeoutMs?: number } = {}): Promise<DiskvIndex> {
  const want = opts.pageSize || 100;
  const records: DiskvRecord[] = [];
  let total = 0;
  let updateDate: string | undefined;
  for (let page = 1; page <= MAX_PAGES; page++) {
    const r = await fetchWithTimeout(`${apiUrl()}?page=${page}&size=${want}`, { headers: { Accept: "application/json" }, timeoutMs: opts.timeoutMs || 15000 });
    if (!r.ok) throw new Error(`register diskvalifikácií: HTTP ${r.status}${r.status === 403 ? " (blokované – nastavte proxy v Administrácii → Prístupy)" : ""}`);
    const j = await r.json().catch(() => null);
    const got = recordsOf(j);
    if (got.total == null) throw new Error("register diskvalifikácií: neznámy tvar odpovede (chýba numFound)");
    total = got.total;
    updateDate = got.updateDate || updateDate;
    records.push(...got.records.map((x) => flatten(x)));
    if (!got.records.length || records.length >= total) break;
  }
  return { at: new Date().toISOString(), updateDate, total, records, complete: records.length >= total };
}

let memo: { exp: number; value: DiskvIndex } | null = null;

/** Index registra: pamäť inštancie → Redis (6 h) → stiahnutie. */
export async function diskvIndex(opts: { fresh?: boolean } = {}): Promise<DiskvIndex> {
  if (!opts.fresh && memo && memo.exp > Date.now()) return memo.value;
  if (!opts.fresh) {
    const stored = await kv().get<DiskvIndex>(KEY).catch(() => null);
    if (stored && Date.now() - Date.parse(stored.at) < TTL_SEC * 1000) {
      memo = { exp: Date.now() + 3600e3, value: stored };
      return stored;
    }
  }
  const value = await downloadDiskv();
  if (value.complete) await kv().set(KEY, value, TTL_SEC).catch(() => {});
  memo = { exp: Date.now() + 3600e3, value };
  return value;
}

/** Kontrola pre preverenie; null = nedá sa rozhodnúť (ostáva manuálne overenie). */
export async function checkDiskv(ctx: Ctx): Promise<CheckResult | null> {
  const def = MANUAL.find((m) => m.id === "diskv")!;
  const t0 = Date.now();
  const names = Array.from(new Set((ctx.profile.statutory || []).map((s) => s.name).filter(Boolean)));
  const idx = await diskvIndex();
  const hits = idx.records.map((r) => ({ r, m: matchRecord(r, ctx.ico, names) })).filter((x) => x.m);
  const byIco = hits.filter((h) => h.m!.by === "ico");
  const asOf = idx.updateDate ? `, stav registra k ${idx.updateDate}` : "";
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
      ask: `Overte totožnosť: je ${who} tá istá osoba ako v registri diskvalifikácií (dátum narodenia, bydlisko)? Výsledok zaznamenajte.`,
    });
    summary = `Možná zhoda mena štatutára v registri diskvalifikácií (${hits.length} ${hits.length === 1 ? "záznam" : "záznamy"})${asOf} – treba overiť totožnosť.`;
    status = "warning";
  } else {
    if (!idx.complete || !names.length) return null; // neúplný register alebo nepoznáme štatutárov → nerozhodujeme
    summary = `Bez záznamu – žiadny zo štatutárov (${names.length}) ani IČO nie je v registri diskvalifikácií (${idx.total} záznamov${asOf}).`;
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
    data: { penaltyIfFound: def.penaltyIfFound, severityIfFound: def.severityIfFound, rows: hits.slice(0, 5).map((h) => describeRecord(h.r)), queriedUrl: DISKV_API, total: idx.total, updateDate: idx.updateDate, checkedNames: names },
    checkedAt: new Date().toISOString(),
    durationMs: Date.now() - t0,
    automated: true,
  };
}
