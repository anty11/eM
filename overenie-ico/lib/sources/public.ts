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
  /** Prípravný krok (napr. vypnutie ochrany formulára) – jeho cookies sa pošlú s hlavným dopytom */
  pre?: { url: string; method?: "GET" | "POST"; body?: string };
  /** Len na diagnostiku – nie je to dopyt do registra (napr. hľadanie otvorených dát) */
  info?: string;
}

/** Hlavičky bežného prehliadača – niektoré weby (nginx/WAF) odmietajú požiadavky bez nich. */
const BROWSER_HEADERS: Record<string, string> = {
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,application/json;q=0.8,*/*;q=0.7",
  "Accept-Language": "sk-SK,sk;q=0.9,cs;q=0.8,en;q=0.7",
  "Upgrade-Insecure-Requests": "1",
  "Sec-Fetch-Dest": "document",
  "Sec-Fetch-Mode": "navigate",
  "Sec-Fetch-Site": "none",
  "Sec-Fetch-User": "?1",
  "Cache-Control": "max-age=0",
};

/** Z JS balíka jednostránkovej aplikácie (Union portál) vytiahne kandidátov na adresy API. */
export function apiHints(js: string): string[] {
  const out = new Set<string>();
  for (const m of js.matchAll(/["'`](https?:\/\/[^"'`\s]{6,160}|\/[A-Za-z0-9_\-./{}$]{2,120})["'`]/g)) {
    const u = m[1];
    if (/api|rest|service|dlzn|debt|search|vyhlad|zoznam|graphql|odata/i.test(u) && !/\.(js|css|png|svg|woff2?|ico|jpg)(\?|$)/i.test(u)) out.add(u);
  }
  return [...out].slice(0, 60);
}
export interface ProbeOutcome {
  result: "found" | "clean" | "unknown";
  rows: string[];
  attempts: { url: string; status?: number; ms: number; error?: string; excerpt: string; verdict: "found" | "clean" | "unknown"; evidence?: string; forms?: string[]; scripts?: string[]; links?: string[]; inlineScripts?: string[]; apiHints?: string[]; codeAround?: string[]; around?: string[]; raw?: string; contentType?: string; info?: string }[];
}

/** Textové okolie hľadaných reťazcov v odpovedi (diagnostika) – kde sa IČO alebo hlásenie o výsledku nachádza. */
export function around(html: string, needles: string[], max = 6): string[] {
  const text = stripHtml(html);
  const f = fold(text);
  const out: string[] = [];
  for (const n of [...needles, "žiadn", "nenašl", "nenachádz", "neboli", "dlžník", "záznam"]) {
    const i = f.indexOf(fold(n));
    if (i >= 0) out.push(`…${text.slice(Math.max(0, i - 160), i + 220)}…`);
    if (out.length >= max) break;
  }
  return out;
}

/** Úryvky kódu okolo kľúčových slov v JS balíku (diagnostika SPA) – odhalia volania API. */
export function codeAround(js: string, words: string[], max = 6): string[] {
  const out: string[] = [];
  for (const w of words) {
    let from = 0;
    while (out.length < max) {
      const i = js.indexOf(w, from);
      if (i < 0) break;
      out.push(js.slice(Math.max(0, i - 260), i + 260).replace(/\s+/g, " "));
      from = i + w.length;
    }
  }
  return out;
}

/** Z HTML vytiahne formuláre (action, metóda, polia) a skripty – na doladenie dopytov podľa diagnostiky bez prístupu k stránke. */
export function describePage(html: string): { forms: string[]; scripts: string[]; links: string[] } {
  const links = (html.match(/<a\b[^>]*href=["']([^"'#]+)["'][^>]*>([\s\S]{0,120}?)<\/a>/gi) || [])
    .map((a) => {
      const href = a.match(/href=["']([^"'#]+)["']/i)?.[1] || "";
      const text = stripHtml(a).slice(0, 60);
      return `${text} → ${href}`;
    })
    .filter((l) => /zakaz|register|vyhlad|search|api|export|csv|xml|json|opendata|otvoren|dlzn|zoznam|diskvalif/i.test(l))
    .slice(0, 40);
  const forms = (html.match(/<form[\s\S]*?<\/form>/gi) || []).slice(0, 6).map((f) => {
    const action = f.match(/action=["']([^"']*)["']/i)?.[1] || "(bez action)";
    const method = f.match(/method=["']([^"']*)["']/i)?.[1] || "GET";
    const fields = (f.match(/<(input|select|textarea|button)\b[^>]*>/gi) || [])
      .map((i) => {
        const name = i.match(/name=["']([^"']*)["']/i)?.[1];
        const type = i.match(/type=["']([^"']*)["']/i)?.[1] || i.match(/^<(\w+)/)?.[1];
        const value = i.match(/value=["']([^"']{0,40})["']/i)?.[1];
        return name ? `${name}:${type}${value ? `=${value}` : ""}` : null;
      })
      .filter(Boolean);
    return `${method.toUpperCase()} ${action} [${fields.join(", ")}]`;
  });
  const scripts = (html.match(/<script[^>]*\ssrc=["']([^"']+)["']/gi) || []).map((s) => s.match(/src=["']([^"']+)["']/i)![1]).slice(0, 15);
  return { forms, scripts, links };
}

/** Vložené skripty, ktoré volajú server (ajax/fetch/eID/api) – diagnostika TYPO3 a pod. */
export function inlineScripts(html: string): string[] {
  return (html.match(/<script(?![^>]*\ssrc=)[^>]*>([\s\S]*?)<\/script>/gi) || [])
    .map((s) => s.replace(/<\/?script[^>]*>/gi, "").trim())
    .filter((s) => /ajax|fetch\(|XMLHttpRequest|eID|\/api\/|action=|dataTable|DataTable/i.test(s))
    .slice(0, 5)
    .map((s) => s.replace(/\s+/g, " ").slice(0, 700));
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

export function judge(html: string, needles: string[]): { verdict: "found" | "clean" | "unknown"; rows: string[]; evidence?: string } {
  const rows = matchingRows(html, needles);
  if (rows.length) return { verdict: "found", rows };
  const text = fold(stripHtml(html));
  // JSON prázdne pole = register odpovedal, nič nenašiel
  if (/^\s*(\[\s*\]|\{\s*"(data|items|content)"\s*:\s*\[\s*\][^}]*\})\s*$/.test(html.trim())) return { verdict: "clean", rows: [], evidence: "prázdna odpoveď JSON" };
  // „bez záznamu“ len keď register výslovne hlási prázdny výsledok, hlásenie sa týka hľadania (v okolí je slovo o zázname / dlžníkovi / výsledku / subjekte)
  // a zároveň v odpovedi vidno náš dopyt (IČO v poli formulára) – navigačné texty typu „žiadne poplatky“ sa tak neuznajú
  const raw = fold(html);
  const echoed = needles.some((n) => n && raw.includes(fold(n)));
  if (echoed) {
    for (const m of text.matchAll(new RegExp(NO_RESULTS.source, "g"))) {
      const win = text.slice(Math.max(0, m.index! - 120), m.index! + m[0].length + 120);
      if (/(zaznam|dlzn|vysledk|subjekt|osob|zhod|polozk|record|result)/.test(win)) return { verdict: "clean", rows: [], evidence: win.trim() };
    }
  }
  return { verdict: "unknown", rows: [] };
}

export async function probe(attempts: Attempt[], needles: string[], timeoutMs = 12000, opts: { diag?: boolean } = {}): Promise<ProbeOutcome> {
  const out: ProbeOutcome = { result: "unknown", rows: [], attempts: [] };
  for (const a of attempts) {
    const t0 = Date.now();
    try {
      let cookie = "";
      if (a.pre) {
        const pr = await fetchWithTimeout(a.pre.url, { method: a.pre.method || "GET", body: a.pre.body, headers: { ...BROWSER_HEADERS, ...(a.pre.body ? { "Content-Type": "application/x-www-form-urlencoded" } : {}) }, timeoutMs, redirect: "manual" });
        const setCookies = (pr.headers as any).getSetCookie?.() as string[] | undefined;
        cookie = (setCookies && setCookies.length ? setCookies : [pr.headers.get("set-cookie") || ""]).map((c) => c.split(";")[0]).filter(Boolean).join("; ");
      }
      const r = await fetchWithTimeout(a.url, {
        method: a.method || "GET",
        body: a.body,
        headers: { ...BROWSER_HEADERS, ...(a.body ? { "Content-Type": a.contentType || "application/x-www-form-urlencoded", Origin: new URL(a.url).origin, Referer: a.url, "Sec-Fetch-Site": "same-origin", "Sec-Fetch-Mode": "navigate" } : {}), ...(cookie ? { Cookie: cookie } : {}) },
        timeoutMs,
      });
      const html = await r.text();
      const j = r.ok && !a.info ? judge(html, needles) : { verdict: "unknown" as const, rows: [] };
      const d = describePage(html);
      const rec: ProbeOutcome["attempts"][number] = { url: a.url, status: r.status, ms: Date.now() - t0, excerpt: stripHtml(html).slice(0, opts.diag ? 3000 : 1500), verdict: j.verdict, evidence: j.evidence, forms: d.forms, scripts: d.scripts, links: d.links, raw: html.slice(0, opts.diag ? 3000 : 1500), contentType: r.headers.get("content-type") || undefined, info: a.info };
      if (opts.diag) {
        rec.around = around(html, needles);
        rec.inlineScripts = inlineScripts(html);
      }
      // jednostránková aplikácia bez obsahu – v diagnostike prezrieme jej skripty a vytiahneme adresy API a kód okolo kľúčových slov
      if (opts.diag && j.verdict === "unknown" && d.scripts.length && stripHtml(html).length < 400) {
        const hints = new Set<string>();
        const code: string[] = [];
        for (const src of d.scripts.filter((s) => !/^https?:/.test(s) || new URL(s).origin === new URL(a.url).origin).slice(0, 3)) {
          try {
            const js = (await (await fetchWithTimeout(new URL(src, a.url).toString(), { timeoutMs })).text()).slice(0, 4_000_000);
            apiHints(js).forEach((h) => hints.add(h));
            for (const m of js.matchAll(/["'`](https?:\/\/[^"'`\s]{8,160})["'`]/g)) if (!/\.(js|css|png|svg|woff2?|ico|jpg)(\?|$)/i.test(m[1]) && !/w3\.org|schema\.org|react|npm|github/i.test(m[1])) hints.add(m[1]);
            code.push(...codeAround(js, ["dlznici", "dlznik", "baseURL", "baseUrl", "VITE_", "/pub/"], 8));
          } catch {
            /* skript sa nepodarilo načítať */
          }
        }
        rec.apiHints = [...hints].slice(0, 80);
        rec.codeAround = code.slice(0, 10);
      }
      out.attempts.push(rec);
      if (j.verdict !== "unknown") {
        out.result = j.verdict;
        out.rows = j.rows;
        return out;
      }
    } catch (e) {
      out.attempts.push({ url: a.url, ms: Date.now() - t0, error: (e as Error).message, excerpt: "", verdict: "unknown", info: a.info });
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
      // justice.gov.sk vracia zo serverov v dátových centrách 403 (nginx) – skúšame s hlavičkami prehliadača; záložne otvorené dáta (data.gov.sk)
      const base = "https://www.justice.gov.sk/registre/registerDiskvalifikacii/";
      return {
        attempts: [
          { url: `${base}?pageNum=1&size=10` },
          { url: `https://justice.gov.sk/registre/registerDiskvalifikacii/?pageNum=1&size=10`, info: "variant bez www" },
          { url: `http://www.justice.gov.sk/registre/registerDiskvalifikacii/?pageNum=1&size=10`, info: "variant http" },
          { url: `${base}?ico=${ico}&pageNum=1&size=50` },
          ...statutory.slice(0, 2).map((n) => ({ url: `${base}?priezvisko=${enc(n.replace(/^(ing|mgr|judr|mudr|phdr|bc|doc|prof)\.?\s+/i, "").split(" ").slice(-1)[0])}&pageNum=1&size=50` })),
          { url: "https://data.slovensko.sk/api/datasets?q=diskvalifik%C3%A1ci%C3%AD", info: "otvorené dáta (data.slovensko.sk) – hľadanie datasetu" },
          { url: "https://data.slovensko.sk/api/v1/datasets/search?q=diskvalifik%C3%A1ci%C3%AD", info: "otvorené dáta (data.slovensko.sk) – variant API" },
        ],
        needles: [ico, ...statutory],
      };
    }
    case "uvo": {
      const base = "https://www.uvo.gov.sk/zaujemca-uchadzac/registre-o-hospodarskych-subjektoch/register-osob-so-zakazom";
      return {
        attempts: [
          { url: base },
          { url: "https://www.uvo.gov.sk/dohlad/spravne-delikty/prehlad-rozhodnuti-o-ulozeni-pokuty-a-sankcie-zakazu-ucasti-vo-vo" },
          { url: "https://www.uvo.gov.sk/vyhladavanie/globalne-vyhladavanie?globalSearch=" + ico + "&searchType=zakaz" },
          { url: "https://data.slovensko.sk/api/datasets?q=z%C3%A1kaz%20%C3%BA%C4%8Dasti", info: "otvorené dáta (data.slovensko.sk) – hľadanie datasetu ÚVO" },
        ],
        needles: [ico],
      };
    }
    case "vszp": {
      // Formulár (WebJET): POST typ (0 = samoplatitelia, 1 = zamestnávatelia a SZČO), nazov, docid=227, proceed=true; pred ním vypnutie ochrany formulára
      const base = "https://www.vszp.sk/platitelia/platenie-poistneho/zoznam-dlznikov.html";
      const body = `typ=1&nazov=${ico}&docid=227&proceed=true`;
      const pre = { url: `https://www.vszp.sk/components/form/spamprotectiondisable.jsp?backurl=${enc("/platitelia/platenie-poistneho/zoznam-dlznikov.html")}`, method: "POST" as const, body: "words=" };
      return {
        attempts: [
          { url: base, method: "POST", body, pre },
          { url: base, method: "POST", body },
          { url: `${base}?typ=1&nazov=${ico}&docid=227&proceed=true` },
          { url: base, method: "POST", body: `typ=0&nazov=${ico}&docid=227&proceed=true`, pre },
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
