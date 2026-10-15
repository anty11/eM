import { fetchWithTimeout } from "../http";
import { kv } from "../auth/kv";
import type { CheckResult, Ctx, Finding, SearchLog } from "../types";
import { sq } from "../searchlog";
import { MANUAL } from "./manual";
import { browserFlow } from "./public";

/**
 * Exekúcie – poverenia na vykonanie exekúcie (Ministerstvo spravodlivosti SR, aplikácia Infosud, obcan.justice.sk/pilot/poverenia).
 * Zverejňujú sa poverenia Okresného súdu Banská Bystrica vydané od 1. 4. 2017 (Exekučný poriadok), a len z PREBIEHAJÚCICH exekučných
 * konaní – skončené exekúcie a konania začaté pred 1. 4. 2017 tu nie sú; úplný prehľad dáva len Centrálny register exekúcií (CRE,
 * spoplatnený výpis). Preto aj „bez záznamu“ nesie túto výhradu.
 *
 * Stránka má formulár „podľa IČO, resp. názvu povinného“ (pole IČO, tlačidlo „Hľadať poverenie“) – aplikácia React. Postup:
 *  1. naučená adresa API (šablóna z predchádzajúceho behu prehliadača, Redis `exek:api`) – priamy dopyt bez prehliadača (cez proxy);
 *  2. inak prehliadač na serveri (`exekFlow`): vyplní IČO, odošle, prečíta odpoveď aplikácie (JSON) alebo tabuľku; adresu dopytu
 *     s IČO si zapamätá ako šablónu na nabudúce.
 * Hostiteľ blokuje dátové centrá → proxy z Administrácie (rovnako ako register diskvalifikácií).
 */
export const EXEK_PAGE = "https://obcan.justice.sk/pilot/poverenia/";
const API_KEY = "exek:api";
const SINCE = "1. 4. 2017";
const CAVEAT = `zoznam obsahuje len poverenia na vykonanie exekúcie vydané Okresným súdom Banská Bystrica od ${SINCE} a len z prebiehajúcich konaní – skončené exekúcie a konania začaté pred ${SINCE} v ňom nie sú; úplný prehľad dáva Centrálny register exekúcií (CRE)`;

export interface ExekApi {
  url: string;
  method: string;
  post?: string;
  learnedAt: string;
}

export function getExekApi(): Promise<ExekApi | null> {
  return kv().get<ExekApi>(API_KEY).catch(() => null);
}
export async function setExekApi(t: { url: string; method: string; post?: string } | null) {
  if (!t) return kv().del(API_KEY).catch(() => undefined);
  await kv().set(API_KEY, { ...t, learnedAt: new Date().toISOString() } satisfies ExekApi).catch(() => undefined);
}

/** Vyhodnotenie JSON odpovede aplikácie: počet (numFound / totalElements / total) a záznamy s IČO; null = nie je JSON so zoznamom. */
export function judgeExekJson(body: string, ico: string): { verdict: "found" | "clean" | "unknown"; rows: string[]; evidence?: string; returned: number | null; note: string } | null {
  let j: any;
  try {
    j = JSON.parse(body);
  } catch {
    return null;
  }
  if (!j || typeof j !== "object") return null;
  const total = typeof j.numFound === "number" ? j.numFound : typeof j.totalElements === "number" ? j.totalElements : typeof j.total === "number" ? j.total : typeof j.count === "number" ? j.count : Array.isArray(j) ? j.length : null;
  const list: any[] = Array.isArray(j) ? j : (Object.values(j).find((v) => Array.isArray(v) && v.length && typeof v[0] === "object" && !("facetValueList" in v[0])) as any[]) || [];
  if (total === null && !Array.isArray(j) && !list.length) return null;
  const text = (x: any) => describePoverenie(flat(x));
  const re = new RegExp(`(^|\\D)${ico}(\\D|$)`);
  const hits = list.filter((x) => re.test(JSON.stringify(x)));
  if (hits.length) return { verdict: "found", rows: hits.slice(0, 10).map(text), evidence: text(hits[0]), returned: total ?? list.length, note: "odpoveď aplikácie (JSON) – záznamy s IČO" };
  if (total === 0 || (total !== null && list.length === 0)) return { verdict: "clean", rows: [], evidence: "odpoveď aplikácie: 0 záznamov", returned: 0, note: "odpoveď aplikácie (JSON): 0 záznamov" };
  if (total !== null && list.length >= total) return { verdict: "clean", rows: [], evidence: `odpoveď aplikácie: ${total} záznamov, žiadny s IČO ${ico}`, returned: total, note: "odpoveď aplikácie (JSON) – bez záznamu s IČO" };
  return { verdict: "unknown", rows: [], returned: total, note: `odpoveď aplikácie: ${total ?? "?"} záznamov, prečítaných ${list.length} – bez IČO` };
}

/** Poverenie ľudsky: „Poverenie z 11. 9. 2025 (zverejnené 21. 9. 2025), ECLI:… – SUPERQUAD SLOVAKIA s.r.o., Agátová 3406/7A, Bratislava“ (polia aplikácie 10/2026). */
export function describePoverenie(r: Record<string, string>): string {
  const skd = (v?: string) => {
    const m = (v || "").match(/^(\d{4})-(\d{2})-(\d{2})/);
    return m ? `${Number(m[3])}. ${Number(m[2])}. ${m[1]}` : v || "";
  };
  const get = (re: RegExp) => Object.entries(r).find(([k]) => re.test(k))?.[1];
  const issued = get(/datumPoverenia|datum_poverenia|datumVydania/i);
  const published = get(/datumZverejnenia|datum_zverejnenia/i);
  const ecli = get(/ecli/i);
  const name = get(/^nazov$|nazov_povinneho|povinny/i);
  const addr = [get(/^ulica/i), [get(/^psc/i), get(/^mesto|^obec/i)].filter(Boolean).join(" ")].filter(Boolean).join(", ");
  const exekutor = get(/exekutor/i);
  const znacka = get(/spisova|znacka|cislo_konania/i);
  if (!issued && !ecli && !name) {
    return Object.entries(r)
      .filter(([k, v]) => v && !/guid|suradnic|zemepis|^id$|url|href/i.test(k))
      .slice(0, 10)
      .map(([k, v]) => `${k.split(".").pop()}: ${v}`)
      .join(" · ")
      .slice(0, 300);
  }
  return [
    `Poverenie${issued ? ` z ${skd(issued)}` : ""}${published ? ` (zverejnené ${skd(published)})` : ""}`,
    ecli ? ecli : "",
    znacka ? `sp. zn. ${znacka}` : "",
    exekutor ? `exekútor ${exekutor}` : "",
    name ? `povinný ${name}${addr ? `, ${addr}` : ""}` : "",
  ]
    .filter(Boolean)
    .join(" – ")
    .slice(0, 300);
}

function flat(o: any, prefix = "", out: Record<string, string> = {}): Record<string, string> {
  if (o == null) return out;
  if (typeof o !== "object") {
    const v = String(o).replace(/\s+/g, " ").trim();
    if (v) out[prefix || "value"] = v.slice(0, 200);
    return out;
  }
  if (Array.isArray(o)) {
    o.slice(0, 5).forEach((x, i) => flat(x, `${prefix}[${i}]`, out));
    return out;
  }
  for (const [k, v] of Object.entries(o)) flat(v, prefix ? `${prefix}.${k}` : k, out);
  return out;
}

/** Priamy dopyt naučenou adresou API (bez prehliadača). */
async function viaApi(api: ExekApi, ico: string): Promise<{ url: string; judged: ReturnType<typeof judgeExekJson>; status: number }> {
  const url = api.url.split("{ico}").join(ico);
  const post = api.post ? api.post.split("{ico}").join(ico) : undefined;
  const r = await fetchWithTimeout(url, { method: api.method || "GET", body: post, headers: { Accept: "application/json", ...(post ? { "Content-Type": /^\s*[[{]/.test(post) ? "application/json" : "application/x-www-form-urlencoded" } : {}) }, timeoutMs: 12000 });
  const body = await r.text();
  return { url, judged: r.ok ? judgeExekJson(body, ico) : null, status: r.status };
}

/** Kontrola pre preverenie; pri neúspechu manuálne so záznamom, čo sa skúšalo. */
export async function checkExek(ctx: Ctx): Promise<CheckResult> {
  const def = MANUAL.find((m) => m.id === "exek")!;
  const t0 = Date.now();
  const base = { id: def.id, category: def.category, name: def.name, source: def.source, sourceUrl: def.sourceUrl, verifyUrl: EXEK_PAGE, checkedAt: new Date().toISOString() };
  const dataset = "Poverenia na vykonanie exekúcie (MS SR, aplikácia Infosud – obcan.justice.sk/pilot/poverenia)";
  const queries: SearchLog["queries"] = [];
  const attempts: string[] = [];
  let judged: ReturnType<typeof judgeExekJson> | undefined;
  let queriedUrl = EXEK_PAGE;
  let via = "";
  // 1) naučená adresa API
  const api = await getExekApi();
  if (api) {
    try {
      const r = await viaApi(api, ctx.ico);
      queries.push(sq("IČO", ctx.ico, r.judged?.returned ?? null, r.judged?.rows.length ?? 0, r.url, `priamy dopyt API (naučený ${api.learnedAt.slice(0, 10)}); ${r.judged ? r.judged.note : `HTTP ${r.status} – odpoveď nie je zoznam`}`));
      if (r.judged && r.judged.verdict !== "unknown") {
        judged = r.judged;
        queriedUrl = r.url;
        via = "api";
      } else attempts.push(`API: ${r.judged ? r.judged.note : `HTTP ${r.status}`}`);
    } catch (e) {
      queries.push(sq("IČO", ctx.ico, null, 0, api.url, `priamy dopyt API zlyhal: ${(e as Error).message.slice(0, 100)}`));
      attempts.push(`API: ${(e as Error).message.slice(0, 100)}`);
    }
  }
  // 2) prehliadač na serveri (formulár aplikácie) – zapamätá si adresu dopytu
  if (!judged && process.env.BROWSER_DISABLED !== "1") {
    const r = (await browserFlow("exek", ctx.ico)) as Awaited<ReturnType<typeof browserFlow>> & { apiTemplate?: { url: string; method: string; post?: string } };
    queries.push(sq("IČO", ctx.ico, r.searched?.returned ?? null, r.searched?.matched ?? 0, r.url || EXEK_PAGE, `prehliadač na serveri (formulár „podľa IČO“)${r.searched?.note ? `: ${r.searched.note}` : ""}${r.error ? `; chyba: ${r.error.slice(0, 120)}` : ""}`));
    if (r.apiTemplate) await setExekApi(r.apiTemplate);
    if (r.verdict !== "unknown") {
      judged = { verdict: r.verdict, rows: r.rows, evidence: r.evidence, returned: r.searched?.returned ?? null, note: r.searched?.note || "" };
      queriedUrl = r.url || EXEK_PAGE;
      via = "browser";
    } else attempts.push(`prehliadač: ${r.error || r.searched?.note || "výsledok sa nedal prečítať"}`);
  } else if (!judged) attempts.push("prehliadač na serveri je vypnutý");

  const search: SearchLog[] = [{ dataset, queries, rule: `poverenie s IČO subjektu (povinný); ${CAVEAT}` }];
  if (!judged) {
    return {
      ...base,
      status: "manual",
      summary: `${def.note} (automatický dopyt zlyhal: ${attempts.join("; ").slice(0, 220)})`,
      findings: [],
      search,
      data: { penaltyIfFound: def.penaltyIfFound, severityIfFound: def.severityIfFound, autoError: attempts.join("; ").slice(0, 300) },
      durationMs: Date.now() - t0,
      automated: false,
    };
  }
  if (judged.verdict === "found") {
    const f: Finding[] = [{ severity: def.severityIfFound, text: `Prebiehajúca exekúcia – poverenie na vykonanie exekúcie (${judged.rows.length}×): ${judged.rows[0]}`, penalty: def.penaltyIfFound }];
    return { ...base, status: def.severityIfFound === "critical" ? "critical" : "warning", summary: `${judged.rows.length} ${judged.rows.length === 1 ? "poverenie" : judged.rows.length < 5 ? "poverenia" : "poverení"} na vykonanie exekúcie s IČO subjektu: ${judged.rows.slice(0, 3).join("; ")}. Pozn.: ${CAVEAT}.`, findings: f, search, data: { penaltyIfFound: def.penaltyIfFound, severityIfFound: def.severityIfFound, rows: judged.rows, queriedUrl, via }, durationMs: Date.now() - t0, automated: true };
  }
  return {
    ...base,
    status: "ok",
    summary: `Bez záznamu – žiadne poverenie na vykonanie exekúcie s IČO subjektu (${judged.evidence || judged.note}). UPOZORNENIE: ${CAVEAT}.`,
    findings: [{ severity: "info", text: `Exekúcie: bez poverenia v zozname MS SR (len prebiehajúce konania s poverením od ${SINCE}; skončené a staršie exekúcie tu nie sú – pri významnom obchode overte v CRE)`, penalty: 0 }],
    search,
    data: { penaltyIfFound: def.penaltyIfFound, severityIfFound: def.severityIfFound, rows: [], queriedUrl, via, coverageSince: "2017-04-01" },
    durationMs: Date.now() - t0,
    automated: true,
  };
}
