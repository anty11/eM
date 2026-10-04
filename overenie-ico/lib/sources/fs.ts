import { runCheck, type CheckMeta } from "../check";
import { cached, fold, getJson, HttpError } from "../http";
import type { CheckResult, Ctx, Finding } from "../types";

/**
 * Finančná správa SR – OpenData API (iz.opendata.financnasprava.sk).
 * Vyžaduje bezplatný kľúč: https://opendata.financnasprava.sk/page/openapi (hlavička „key“).
 */
const API = "https://iz.opendata.financnasprava.sk/api";
const ZOZNAMY = "https://www.financnasprava.sk/sk/elektronicke-sluzby/verejne-sluzby/zoznamy";

interface Ds {
  slug: string;
  name: string;
  /** Stĺpce, v ktorých API dovoľuje vyhľadávať (z /lists). */
  searchable: string[];
}

const key = () => process.env.FS_API_KEY?.trim();
const hdr = () => ({ key: key() as string });

/**
 * Zistí dostupné zoznamy. Podľa špecifikácie API vracia /lists OBJEKT { slug: { name, slug, url, update_date, searchable[] } }.
 * Ak API zmení slugy, vyberieme zoznamy podľa názvu.
 */
/**
 * Prehľadávateľné stĺpce zo záznamu zoznamu – API ich uvádza pod rôznymi kľúčmi (searchable, searchable_columns, columns[].searchable…).
 */
function searchableOf(x: any): string[] {
  if (!x || typeof x !== "object") return [];
  for (const k of ["searchable", "searchable_columns", "searchableColumns", "search_columns", "searchColumns"]) {
    const v = x[k];
    // skutočný tvar API (overené 10/2026): reťazec oddelený čiarkou, napr. "ic_dph,ico" alebo "nazov_subjektu"
    if (typeof v === "string" && v.trim()) return v.split(",").map((c) => c.trim()).filter(Boolean);
    if (Array.isArray(v) && v.length) return v.map((c: any) => (typeof c === "string" ? c : String(c?.name || c?.column || c?.id || ""))).filter(Boolean);
    if (v && typeof v === "object") return Object.keys(v).filter((c) => v[c]);
  }
  const cols = x.columns || x.fields || x.schema;
  if (Array.isArray(cols)) {
    const s = cols.filter((c: any) => c && typeof c === "object" && (c.searchable === true || c.searchable === "true" || c.search === true)).map((c: any) => String(c.name || c.column || c.id || ""));
    if (s.length) return s.filter(Boolean);
  }
  return [];
}

async function lists(): Promise<Ds[]> {
  return cached("fs-lists", 6 * 3600e3, async () => {
    const raw = await getJson<any>(`${API}/lists`, { headers: hdr() });
    const arr: any[] = Array.isArray(raw) ? raw : Array.isArray(raw?.lists) ? raw.lists : Array.isArray(raw?.data) ? raw.data : Object.entries(raw || {}).map(([k, v]: [string, any]) => ({ slug: k, ...(v || {}) }));
    return arr
      .map((x) => ({
        slug: String(x.slug || x.id || ""),
        name: String(x.name || x.title || x.description || x.slug || ""),
        searchable: searchableOf(x),
      }))
      .filter((x) => x.slug);
  });
}

const DATASETS = {
  debtors: { slugs: ["ds_dsdd"], re: /da[nň]ov[ií]\S* dl[zž]n/i },
  vat: { slugs: ["ds_dphs"], re: /registrovan\S* .*dph|platitel\S* dph$/i },
  vatRisk: { slugs: ["ds_dphz"], re: /d[oô]vod\S* na zru[sš]en/i },
  vatDeleted: { slugs: ["ds_dphv"], re: /vymazan\S* .*dph/i },
  ids: { slugs: ["ds_iz_ran", "ds_ids", "ds_idsp", "ds_indexds"], re: /spo[lľ]ahliv/i },
  incomeTax: { slugs: ["ds_dppos", "ds_dppo", "ds_vdppo", "ds_dpppo"], re: /(vysk\S* dane|dan\S* z prijmov).*(pravnick|po\b)|pravnick\S* osob\S* .*dan/i },
  /** Zoznam platiteľov DPH s číslami bankových účtov oznámených FS (§ 6 ods. 6 ZDPH) – platba na neoznámený účet zakladá ručenie (§ 69 ods. 14 písm. c)). */
  bankAccounts: { slugs: ["ds_dph_iban", "ds_dphbu", "ds_bu", "ds_dphucty", "ds_ucty"], re: /bankov\S* [uú][cč]t|cisl\S* [uú][cč]t/i },
} as const;

async function resolve(kind: keyof typeof DATASETS): Promise<string | null> {
  const d = DATASETS[kind];
  let all: Ds[] = [];
  try {
    all = await lists();
  } catch {
    return d.slugs[0];
  }
  const bySlug = all.find((x) => (d.slugs as readonly string[]).includes(x.slug));
  if (bySlug) return bySlug.slug;
  const byName = all.find((x) => d.re.test(fold(x.name)) || d.re.test(x.name));
  return byName?.slug || (all.length ? null : d.slugs[0]);
}

function rowsOf(raw: any): any[] | null {
  if (Array.isArray(raw)) return raw;
  for (const k of ["data", "rows", "results", "items"]) if (Array.isArray(raw?.[k])) return raw[k];
  return null; // neznámy formát – nesmie sa vyhodnotiť ako „bez záznamu“
}

/** Vyhľadá IČO (resp. DIČ / IČ DPH) v zozname. Skúša viac názvov stĺpcov. */
/**
 * Vyhľadá IČO (resp. DIČ / IČ DPH) v zozname.
 * Podľa špecifikácie API: 200 = nájdené riadky, 404 „Search not found“ = subjekt v zozname NIE JE,
 * 400 „Column is not searchable“ = skúsime ďalší stĺpec.
 */
/** Detail zoznamu (GET /lists/{slug}) – obsahuje stĺpce, v ktorých sa dá vyhľadávať. */
async function listDetail(slug: string): Promise<Ds | null> {
  return cached(`fs-list-${slug}`, 6 * 3600e3, async () => {
    const x = await getJson<any>(`${API}/lists/${slug}`, { headers: hdr() }).catch(() => null);
    const d = x?.[slug] && typeof x[slug] === "object" ? x[slug] : x?.data && typeof x.data === "object" && !Array.isArray(x.data) ? x.data : x;
    if (!d) return null;
    return { slug, name: String(d.name || slug), searchable: searchableOf(d), keys: Object.keys(d).slice(0, 20) } as Ds & { keys?: string[] };
  });
}

async function search(slug: string, ctx: Ctx): Promise<any[]> {
  let ds = (await lists().catch(() => [] as Ds[])).find((d) => d.slug === slug);
  if (!ds?.searchable.length) ds = (await listDetail(slug)) || ds;
  const shortName = (ctx.profile.name || "")
    .replace(/,?\s*(spol\.\s*s\s*r\.\s*o\.|s\.\s*r\.\s*o\.|a\.\s*s\.|k\.\s*s\.|v\.\s*o\.\s*s\.|družstvo|advokátska kancelária).*$/i, "")
    .trim();
  const values: Record<string, string | undefined> = {
    ico: ctx.ico,
    dic: ctx.profile.dic,
    ic_dph: ctx.profile.icDph || (ctx.profile.dic ? `SK${ctx.profile.dic}` : undefined),
    name: shortName.length >= 5 ? shortName.slice(0, 60) : undefined,
  };
  const kindOf = (col: string) => {
    const c = fold(col);
    if (/ic_?dph|icdph/.test(c)) return "ic_dph";
    if (/(^|_)ico($|_)/.test(c)) return "ico";
    if (/(^|_)dic($|_)/.test(c)) return "dic";
    if (/nazov|obchodne|meno|subjekt/.test(c)) return "name";
    return null;
  };
  // poradie: presné identifikátory, až potom meno
  const order = ["ico", "dic", "ic_dph", "name"];
  let tries: [string, string, string][] = [];
  if (ds?.searchable.length) {
    for (const col of ds.searchable) {
      const k = kindOf(col);
      if (k && values[k]) tries.push([col, values[k]!, k]);
    }
    tries.sort((x, y) => order.indexOf(x[2]) - order.indexOf(y[2]));
  }
  if (!tries.length) {
    // bez informácie o stĺpcoch: bežné názvy stĺpcov v OpenData FS (rôzne zoznamy používajú rôzne varianty)
    const guess: [string, string][] = [["ico", "ico"], ["ICO", "ico"], ["ico_subjektu", "ico"], ["dic", "dic"], ["DIC", "dic"], ["ic_dph", "ic_dph"], ["icdph", "ic_dph"], ["IC_DPH", "ic_dph"], ["nazov_subjektu", "name"], ["nazov", "name"], ["obchodne_meno", "name"]];
    tries = guess.filter(([, k]) => values[k]).map(([c, k]) => [c, values[k]!, k]);
  }

  const matches = (r: any, kind: string) => {
    const s = JSON.stringify(r);
    if (s.includes(ctx.ico) || (ctx.profile.dic && s.includes(ctx.profile.dic))) return true;
    // pri hľadaní podľa mena bez IČO v riadku: zhoda celého mena (bez právnej formy) + obec sídla, ak je v riadku
    if (kind !== "name") return false;
    const rowName = fold(String(Object.entries(r).find(([k]) => /nazov|obchodne|meno|subjekt/.test(fold(k)))?.[1] || ""));
    if (!rowName || !rowName.startsWith(fold(shortName))) return false;
    const rowCity = fold(String(Object.entries(r).find(([k]) => /obec|mesto/.test(fold(k)))?.[1] || ""));
    const city = fold(ctx.profile.address || "");
    return !rowCity || city.includes(rowCity.split(" - ")[0].trim());
  };

  const errors: string[] = [];
  let answered = false;
  for (const [col, val, kind] of tries) {
    try {
      const raw = await getJson<any>(`${API}/data/${slug}/search?page=1&column=${encodeURIComponent(col)}&search=${encodeURIComponent(val)}`, { headers: hdr() });
      const all = rowsOf(raw);
      if (!all) continue;
      answered = true;
      const rows = all.filter((r) => matches(r, kind));
      if (rows.length) return rows;
      if (kind !== "name") return []; // presný identifikátor prehľadaný, subjekt v zozname nie je
    } catch (e) {
      if (e instanceof HttpError && (e.status === 401 || e.status === 403)) throw new Error("neplatný API kľúč Finančnej správy");
      if (e instanceof HttpError && e.status === 404) {
        answered = true; // „Search not found“ – v zozname nie je
        if (kind !== "name") return [];
        continue;
      }
      errors.push(`${col}: ${(e as Error).message}`);
    }
  }
  if (!answered) {
    const keys = (ds as any)?.keys as string[] | undefined;
    throw new Error(
      `API Finančnej správy odmietlo vyhľadávanie v zozname ${slug}${ds?.searchable.length ? ` (prehľadávateľné stĺpce: ${ds.searchable.join(", ")})` : ` (API neuviedlo prehľadávateľné stĺpce${keys?.length ? `; detail zoznamu obsahuje polia: ${keys.join(", ")}` : ""})`} – ${errors.slice(0, 3).join(" | ") || "neznámy formát"}`,
    );
  }
  return [];
}

/** Zoznam, ktorý API nezverejňuje – informácia namiesto chyby. */
function notPublished(what: string): CheckBodyLike {
  return {
    status: "info",
    summary: `${what}: Finančná správa tento zoznam cez OpenData API nezverejňuje. Údaj je v zozname na stránke Finančnej správy (odkaz).`,
    findings: [],
    verifyUrl: ZOZNAMY,
  };
}
type CheckBodyLike = { status: "info"; summary: string; findings: []; verifyUrl: string };

const pick = (row: any, re: RegExp) => {
  for (const [k, v] of Object.entries(row || {})) if (re.test(fold(k)) && v !== null && v !== "") return v as any;
  return undefined;
};

function noKey(meta: CheckMeta, what: string): Promise<CheckResult> {
  return runCheck({ ...meta, automated: false }, async () => ({
    status: "manual",
    summary: `${what}: automatické overenie nie je aktívne (chýba bezplatný API kľúč FS_API_KEY). Overte manuálne v zoznamoch Finančnej správy.`,
    findings: [],
    verifyUrl: ZOZNAMY,
  }));
}

const meta = (id: string, name: string): CheckMeta => ({
  id,
  category: "tax",
  name,
  source: "Finančná správa SR – OpenData",
  sourceUrl: "https://opendata.financnasprava.sk",
});

export async function checkTaxDebtors(ctx: Ctx): Promise<CheckResult> {
  const m = meta("fs-debtors", "Zoznam daňových dlžníkov");
  if (!key()) return noKey(m, "Daňoví dlžníci");
  return runCheck(m, async () => {
    const slug = await resolve("debtors");
    if (!slug) throw new Error("zoznam daňových dlžníkov sa v API nenašiel");
    const rows = await search(slug, ctx);
    if (!rows.length)
      return { status: "ok", summary: "Subjekt NIE JE v zozname daňových dlžníkov.", findings: [], verifyUrl: ZOZNAMY, data: { slug } };
    const amount = pick(rows[0], /suma|nedoplat|dlh|vyska/);
    return {
      status: "critical",
      summary: `Subjekt JE v zozname daňových dlžníkov${amount ? ` – nedoplatok ${amount} €` : ""}.`,
      findings: [{ severity: "critical", text: `Daňový dlžník (Finančná správa)${amount ? `, nedoplatok ${amount} €` : ""}`, penalty: 45 }],
      verifyUrl: ZOZNAMY,
      data: { slug, rows: rows.slice(0, 3) },
    };
  });
}

/** EÚ VIES – verejné REST API (bez kľúča): platnosť IČ DPH. */
async function vies(dic: string): Promise<{ valid: boolean; name?: string; address?: string } | null> {
  try {
    const j = await getJson<any>(`https://ec.europa.eu/taxation_customs/vies/rest-api/ms/SK/vat/${dic}`, { timeoutMs: 8000 });
    if (typeof j?.isValid !== "boolean") return null;
    return { valid: j.isValid, name: j.name && j.name !== "---" ? j.name : undefined, address: j.address && j.address !== "---" ? j.address : undefined };
  } catch {
    return null;
  }
}

export async function checkVat(ctx: Ctx): Promise<CheckResult> {
  const m = meta("fs-vat", "Registrácia DPH a dôvody na zrušenie");
  if (!key()) {
    // bez kľúča FS: aspoň registrácia DPH cez VIES
    return runCheck({ ...m, source: "EÚ VIES (registrácia DPH); zoznamy Finančnej správy manuálne" }, async () => {
      const v = ctx.profile.dic ? await vies(ctx.profile.dic) : null;
      if (!v) return { status: "manual", summary: "DPH: automatické overenie nie je aktívne (chýba kľúč FS_API_KEY) a VIES neodpovedal. Overte manuálne.", findings: [], verifyUrl: ZOZNAMY, automated: false } as any;
      if (v.valid) ctx.profile.icDph = `SK${ctx.profile.dic}`;
      return {
        status: "info",
        summary: v.valid
          ? `Registrovaný platiteľ DPH SK${ctx.profile.dic} (podľa EÚ VIES${v.name ? `, ${v.name}` : ""}). Zoznam dôvodov na zrušenie registrácie vyžaduje kľúč FS – overte manuálne.`
          : `Nie je platiteľom DPH (podľa EÚ VIES). Zoznamy Finančnej správy vyžadujú kľúč FS.`,
        findings: v.valid ? [{ severity: "positive", text: `Registrovaný platiteľ DPH SK${ctx.profile.dic} (VIES)`, penalty: -2 }] : [],
        verifyUrl: ZOZNAMY,
        data: { icDph: v.valid ? `SK${ctx.profile.dic}` : undefined, vies: v },
      };
    });
  }
  return runCheck(m, async () => {
    const [sVat, sRisk, sDel] = await Promise.all([resolve("vat"), resolve("vatRisk"), resolve("vatDeleted")]);
    let vat: any[] = [];
    let risk: any[] = [];
    let del: any[] = [];
    let viesNote = "";
    try {
      [vat, risk, del] = await Promise.all([
        sVat ? search(sVat, ctx) : Promise.resolve([]),
        sRisk ? search(sRisk, ctx) : Promise.resolve([]),
        sDel ? search(sDel, ctx).catch(() => []) : Promise.resolve([]),
      ]);
    } catch (e) {
      // FS API zlyhalo – registráciu overíme cez EÚ VIES, zoznam rizikových platiteľov ostáva na manuálne overenie
      const v = ctx.profile.dic ? await vies(ctx.profile.dic) : null;
      if (!v) throw e;
      if (v.valid) ctx.profile.icDph = `SK${ctx.profile.dic}`;
      return {
        status: "manual",
        summary: `${v.valid ? `Registrovaný platiteľ DPH SK${ctx.profile.dic} (podľa EÚ VIES).` : "Nie je platiteľom DPH (podľa EÚ VIES)."} Zoznam platiteľov s dôvodmi na zrušenie registrácie Finančná správa nevrátila (${(e as Error).message.slice(0, 120)}) – overte manuálne alebo skúste znova.`,
        findings: v.valid ? [{ severity: "positive", text: `Registrovaný platiteľ DPH SK${ctx.profile.dic} (VIES)`, penalty: -2 }] : [],
        verifyUrl: ZOZNAMY,
        data: { icDph: v.valid ? `SK${ctx.profile.dic}` : undefined, vies: v },
      };
    }
    const f: Finding[] = [];
    const icDph = vat[0] ? pick(vat[0], /ic_?dph/) : undefined;
    if (icDph) ctx.profile.icDph = String(icDph);
    if (risk.length)
      f.push({
        severity: "critical",
        text: "Platiteľ DPH, u ktorého nastali dôvody na zrušenie registrácie (§ 81 ods. 4 písm. b) ZDPH) – riziko ručenia za DPH podľa § 69 ods. 14",
        penalty: 35,
      });
    if (!vat.length && del.length) f.push({ severity: "warning", text: "Registrácia pre DPH bola zrušená (vymazaný platiteľ DPH)", penalty: 8 });
    if (vat.length && !risk.length) f.push({ severity: "positive", text: `Registrovaný platiteľ DPH${icDph ? ` (${icDph})` : ""} bez dôvodov na zrušenie`, penalty: -2 });
    return {
      status: risk.length ? "critical" : f.some((x) => x.severity === "warning") ? "warning" : vat.length ? "ok" : "info",
      summary: vat.length
        ? `Registrovaný platiteľ DPH${icDph ? ` ${icDph}` : ""}.${risk.length ? " POZOR: v zozname subjektov s dôvodmi na zrušenie registrácie." : ""}`
        : del.length
          ? "Nie je platiteľom DPH – registrácia bola zrušená."
          : "Subjekt nie je registrovaný pre DPH.",
      findings: f,
      verifyUrl: ZOZNAMY,
      data: { icDph, slugs: { sVat, sRisk, sDel } },
    };
  });
}

export async function checkIds(ctx: Ctx): Promise<CheckResult> {
  const m = meta("fs-ids", "Index daňovej spoľahlivosti");
  if (!key()) return noKey(m, "Index daňovej spoľahlivosti");
  return runCheck(m, async () => {
    const slug = await resolve("ids");
    if (!slug) return notPublished("Index daňovej spoľahlivosti");
    const rows = await search(slug, ctx);
    const url = `${ZOZNAMY}/index-danovej-spolahlivosti`;
    if (!rows.length) return { status: "info", summary: "Subjekt nie je hodnotený v indexe daňovej spoľahlivosti.", findings: [], verifyUrl: url };
    // skutočný záznam API: { ico, dic, ids: "vysoko spoľahlivý", nazov_subjektu, obec, … }
    const raw = pick(rows[0], /^ids$|index|hodnot|spolahliv|kategor/) ?? Object.values(rows[0]).find((x) => /spo[lľ]ahliv/i.test(String(x)));
    const v = raw !== undefined ? String(raw) : "hodnotenie neuvedené";
    const fv = fold(v);
    const f: Finding[] = [];
    if (fv.includes("menej")) f.push({ severity: "warning", text: `Index daňovej spoľahlivosti: ${v}`, penalty: 20 });
    else if (fv.includes("vysoko")) f.push({ severity: "positive", text: `Index daňovej spoľahlivosti: ${v}`, penalty: -5 });
    else f.push({ severity: "info", text: `Index daňovej spoľahlivosti: ${v}`, penalty: 0 });
    return {
      status: fv.includes("menej") ? "warning" : "ok",
      summary: `Hodnotenie: ${v}.`,
      findings: f,
      verifyUrl: url,
      data: { slug, row: rows[0] },
    };
  });
}

/**
 * Daňové priznanie k dani z príjmov PO – Finančná správa zverejňuje výšku dane podľa podaných priznaní.
 * Záznam za posledný rok = priznanie bolo podané. Chýbajúci záznam nemusí znamenať nepodanie
 * (zoznam nemusí obsahovať subjekty s nulovou daňou), preto sa hodnotí len ako informácia.
 */
export async function checkIncomeTax(ctx: Ctx): Promise<CheckResult> {
  const m = meta("fs-dppo", "Daňové priznanie k dani z príjmov");
  if (!key()) return noKey(m, "Daňové priznanie");
  return runCheck(m, async () => {
    const slug = await resolve("incomeTax");
    if (!slug) return notPublished("Daň z príjmov PO");
    const rows = await search(slug, ctx);
    if (!rows.length)
      return {
        status: "info",
        summary: "Subjekt sa v zozname daní z príjmov PO nenachádza (môže ísť aj o nulovú daň alebo stratu). Podanie overte podľa závierky v RÚZ.",
        findings: [],
        verifyUrl: ZOZNAMY,
        data: { slug, filed: undefined },
      };
    const withYear = rows
      .map((r) => ({ r, y: Number(String(pick(r, /^rok|obdobi|zdanovac/) ?? "").match(/\d{4}/)?.[0] || 0) }))
      .sort((a, b) => b.y - a.y);
    const top = withYear[0];
    // výška dane: číselná hodnota v stĺpci typu „dan / vyska / suma“ (nie dátum zdaňovacieho obdobia)
    const isAmount = (v: any) => /^-?[\d\s.,]+$/.test(String(v).trim()) && !/^\d{1,2}\.\d{1,2}\.\d{4}$/.test(String(v).trim()) && !/^\d{4}-\d{2}-\d{2}/.test(String(v));
    const taxEntry = Object.entries(top.r).find(([k, v]) => /dan|vysk|suma/.test(fold(k)) && !/obdobi|datum|od$|do$/.test(fold(k)) && isAmount(v));
    const tax = taxEntry?.[1];
    return {
      status: "ok",
      summary: `Daňové priznanie podané${top.y ? ` za rok ${top.y}` : ""}${tax !== undefined ? ` – daň ${tax} €` : ""}.`,
      findings: [],
      verifyUrl: ZOZNAMY,
      data: { slug, filed: true, year: top.y || undefined, tax },
    };
  });
}


import { normalizeIban, type BankAccountResult } from "../deal";

/**
 * Overí, či je účet partnera v zozname bankových účtov platiteľov DPH oznámených Finančnej správe.
 * Výsledok: listed / not_listed / not_vat_payer / unknown (zoznam nedostupný, bez kľúča FS…).
 */
export async function checkBankAccount(ctx: Ctx, ibanIn: string): Promise<BankAccountResult> {
  const iban = normalizeIban(ibanIn);
  const verifyUrl = ZOZNAMY;
  if (!key()) return { status: "unknown", message: "Zoznam bankových účtov FS vyžaduje kľúč FS_API_KEY – overte manuálne.", verifyUrl };
  try {
    const slug = await resolve("bankAccounts");
    if (!slug) return { status: "unknown", message: "API Finančnej správy zoznam bankových účtov neponúka – overte manuálne.", verifyUrl };
    const rows = await search(slug, ctx);
    if (!rows.length) {
      // subjekt v zozname nie je: buď nie je platiteľ DPH, alebo neoznámil žiadny účet
      const vatSlug = await resolve("vat").catch(() => null);
      const isVat = vatSlug ? (await search(vatSlug, ctx).catch(() => [])).length > 0 : Boolean(ctx.profile.icDph);
      return isVat
        ? { status: "not_listed", message: "Platiteľ DPH nemá v zozname FS oznámený žiadny bankový účet.", verifyUrl }
        : { status: "not_vat_payer", message: "Partner nie je v zozname platiteľov DPH – zoznam účtov sa naň nevzťahuje.", verifyUrl };
    }
    const accounts = rows.flatMap((r) => Object.values(r).map((v) => normalizeIban(String(v ?? "")))).filter((v) => /^[A-Z]{2}\d{2}[A-Z0-9]{8,}$/.test(v));
    if (accounts.includes(iban)) return { status: "listed", message: `Účet je v zozname FS (oznámených účtov: ${accounts.length}).`, verifyUrl };
    return { status: "not_listed", message: `Účet nie je medzi ${accounts.length} účtami, ktoré partner oznámil FS.`, verifyUrl };
  } catch (e) {
    return { status: "unknown", message: `Zoznam bankových účtov FS sa nepodarilo overiť: ${(e as Error).message}`, verifyUrl };
  }
}
