import { fetchWithTimeout, fold, stripHtml } from "../http";
import type { CheckResult, Ctx, Finding } from "../types";
import { MANUAL } from "./manual";

/**
 * Registre bez API, ale s verejným vyhľadávaním (justice.gov.sk – diskvalifikácie, ÚVO – zákaz účasti, VšZP a Union – dlžníci).
 * Server položí dopyt priamo registru (bez AI) a odpoveď vyhodnotí PRÍSNE:
 *  - „found“ len vtedy, keď odpoveď obsahuje riadok s IČO (alebo menom štatutára pri diskvalifikáciách),
 *  - „clean“ len vtedy, keď register výslovne napíše, že nič nenašiel,
 *  - inak ostáva kontrola na manuálne overenie (nikdy sa nevyhodnotí „bez záznamu“ len preto, že sme odpoveď neprečítali).
 * Presné adresy a parametre vyhľadávania sa dolaďujú podľa diagnostiky (/api/diag?source=…): každý pokus si odloží výňatok odpovede.
 * Dopyty sú zdvorilé: jeden dopyt na IČO a register, výsledok sa drží 24 h v pamäti (`cached`).
 */
export interface Attempt {
  url: string;
  method?: "GET" | "POST";
  body?: string;
  contentType?: string;
}
export interface ProbeOutcome {
  result: "found" | "clean" | "unknown";
  rows: string[];
  attempts: { url: string; status?: number; ms: number; error?: string; excerpt: string; verdict: "found" | "clean" | "unknown" }[];
}

const NO_RESULTS = /(ziadne|ziadny|neboli najdene|nebol najdeny|nenasli sa|nenasiel sa|sa nenachadza|nenachadza sa|nebol zisteny|0 zaznamov|pocet zaznamov: 0|no records|no results|nothing found)/;

/** Riadky tabuľky, ktoré obsahujú hľadaný identifikátor (IČO alebo meno). */
export function matchingRows(html: string, needles: string[]): string[] {
  const rows = html.match(/<tr[\s\S]*?<\/tr>/gi) || [];
  const hits = rows.map((r) => stripHtml(r)).filter((t) => needles.some((n) => n && fold(t).includes(fold(n))));
  if (hits.length) return hits.slice(0, 10);
  // JSON odpovede (Union portál a pod.)
  try {
    const j = JSON.parse(html);
    const arr = Array.isArray(j) ? j : Array.isArray(j?.data) ? j.data : Array.isArray(j?.items) ? j.items : Array.isArray(j?.content) ? j.content : null;
    if (arr) return arr.filter((x: any) => needles.some((n) => n && JSON.stringify(x).includes(n))).slice(0, 10).map((x: any) => JSON.stringify(x).slice(0, 300));
  } catch {
    /* nie je JSON */
  }
  return [];
}

export function judge(html: string, needles: string[]): { verdict: "found" | "clean" | "unknown"; rows: string[] } {
  const rows = matchingRows(html, needles);
  if (rows.length) return { verdict: "found", rows };
  const text = fold(stripHtml(html));
  // JSON prázdne pole = register odpovedal, nič nenašiel
  if (/^\s*(\[\s*\]|\{\s*"(data|items|content)"\s*:\s*\[\s*\][^}]*\})\s*$/.test(html.trim())) return { verdict: "clean", rows: [] };
  // „bez záznamu“ len keď register výslovne hlási prázdny výsledok A zároveň v odpovedi vidno náš dopyt (IČO v poli formulára)
  const raw = fold(html);
  if (NO_RESULTS.test(text) && needles.some((n) => n && raw.includes(fold(n)))) return { verdict: "clean", rows: [] };
  return { verdict: "unknown", rows: [] };
}

export async function probe(attempts: Attempt[], needles: string[], timeoutMs = 12000): Promise<ProbeOutcome> {
  const out: ProbeOutcome = { result: "unknown", rows: [], attempts: [] };
  for (const a of attempts) {
    const t0 = Date.now();
    try {
      const r = await fetchWithTimeout(a.url, {
        method: a.method || "GET",
        body: a.body,
        headers: a.body ? { "Content-Type": a.contentType || "application/x-www-form-urlencoded", Accept: "text/html,application/json" } : { Accept: "text/html,application/json" },
        timeoutMs,
      });
      const html = await r.text();
      const j = r.ok ? judge(html, needles) : { verdict: "unknown" as const, rows: [] };
      out.attempts.push({ url: a.url, status: r.status, ms: Date.now() - t0, excerpt: stripHtml(html).slice(0, 1500), verdict: j.verdict });
      if (j.verdict !== "unknown") {
        out.result = j.verdict;
        out.rows = j.rows;
        return out;
      }
    } catch (e) {
      out.attempts.push({ url: a.url, ms: Date.now() - t0, error: (e as Error).message, excerpt: "", verdict: "unknown" });
    }
  }
  return out;
}

const enc = encodeURIComponent;

/** Pokusy o dopyt pre jednotlivé registre – poradie od najpravdepodobnejšieho; dolaďuje sa podľa diagnostiky. */
export function attemptsFor(id: string, ctx: Ctx): { attempts: Attempt[]; needles: string[] } {
  const ico = ctx.ico;
  const statutory = (ctx.profile.statutory || []).map((s) => s.name).filter(Boolean);
  switch (id) {
    case "diskv": {
      const base = "https://www.justice.gov.sk/registre/registerDiskvalifikacii/";
      return {
        attempts: [
          { url: `${base}?ico=${ico}&pageNum=1&size=50` },
          { url: `${base}?identifikacneCislo=${ico}&pageNum=1&size=50` },
          { url: `${base}?search=${ico}&pageNum=1&size=50` },
          ...statutory.slice(0, 3).map((n) => ({ url: `${base}?meno=${enc(n.split(" ").slice(-1)[0])}&pageNum=1&size=50` })),
        ],
        needles: [ico, ...statutory],
      };
    }
    case "uvo": {
      const base = "https://www.uvo.gov.sk/zaujemca-uchadzac/registre-o-hospodarskych-subjektoch/register-osob-so-zakazom";
      return { attempts: [{ url: `${base}?ico=${ico}` }, { url: `${base}?search=${ico}` }, { url: `${base}?q=${ico}` }, { url: base }], needles: [ico] };
    }
    case "vszp": {
      const base = "https://www.vszp.sk/platitelia/platenie-poistneho/zoznam-dlznikov.html";
      return {
        attempts: [
          { url: `${base}?ico=${ico}` },
          { url: `${base}?typ=zamestnavatel&ico=${ico}` },
          { url: base, method: "POST", body: `ico=${ico}` },
        ],
        needles: [ico],
      };
    }
    case "union": {
      return {
        attempts: [
          { url: `https://portal.unionzp.sk/pub/api/dlznici?ico=${ico}` },
          { url: `https://portal.unionzp.sk/pub/dlznici/api?ico=${ico}` },
          { url: `https://portal.unionzp.sk/pub/dlznici?ico=${ico}` },
          { url: `https://portal.unionzp.sk/api/pub/dlznici?ico=${ico}` },
        ],
        needles: [ico],
      };
    }
    default:
      return { attempts: [], needles: [] };
  }
}

export const PUBLIC_QUERY_IDS = ["diskv", "uvo", "vszp", "union"] as const;

function amountIn(rows: string[]): string | undefined {
  for (const r of rows) {
    const m = r.match(/(\d{1,3}(?:[  .]\d{3})*(?:[,.]\d{2})?)\s*(€|eur)/i);
    if (m) return `${m[1].replace(/ /g, " ")} €`;
  }
  return undefined;
}

/**
 * Pokus o automatické overenie registra bez API. Vráti výsledok kontroly, alebo null, keď odpoveď registra nebola jednoznačná
 * (vtedy ostáva pôvodná manuálna kontrola). `diag` = výňatky odpovedí pre diagnostiku (len na /api/diag).
 */
export async function queryPublicRegister(id: string, ctx: Ctx, opts: { diag?: boolean } = {}): Promise<{ check: CheckResult | null; outcome: ProbeOutcome }> {
  const def = MANUAL.find((m) => m.id === id);
  const { attempts, needles } = attemptsFor(id, ctx);
  if (!def || !attempts.length) return { check: null, outcome: { result: "unknown", rows: [], attempts: [] } };
  const t0 = Date.now();
  const outcome = await probe(attempts, needles);
  if (outcome.result === "unknown") return { check: null, outcome };
  const now = new Date().toISOString();
  const used = outcome.attempts.find((a) => a.verdict !== "unknown");
  const f: Finding[] = [];
  let summary: string;
  if (outcome.result === "found") {
    const amount = amountIn(outcome.rows);
    f.push({ severity: def.severityIfFound, text: `${def.name}: záznam nájdený${amount ? ` (${amount})` : ""}`, penalty: def.penaltyIfFound });
    summary = `Záznam nájdený: ${outcome.rows[0].slice(0, 240)}`;
  } else summary = "Bez záznamu – register na dopyt podľa IČO nevrátil žiadny záznam.";
  return {
    check: {
      id: def.id,
      category: def.category,
      name: def.name,
      source: def.source,
      sourceUrl: def.sourceUrl,
      verifyUrl: used?.url || def.verifyUrl(ctx.ico, ctx.profile.name),
      status: outcome.result === "found" ? (def.severityIfFound === "critical" ? "critical" : "warning") : "ok",
      summary,
      findings: f,
      data: { penaltyIfFound: def.penaltyIfFound, severityIfFound: def.severityIfFound, rows: outcome.rows, queriedUrl: used?.url, ...(opts.diag ? { diag: outcome.attempts } : {}) },
      checkedAt: now,
      durationMs: Date.now() - t0,
      automated: true,
    },
    outcome,
  };
}
