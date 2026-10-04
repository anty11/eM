import { createHash } from "node:crypto";
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
  /** Register, ktorému dopyt patrí (vyhodnotenie podľa registra) */
  source?: string;
  url: string;
  method?: "GET" | "POST";
  body?: string;
  contentType?: string;
  /** Načítať cez Edge runtime vlastného nasadenia (iné sieťové adresy) – pre weby blokujúce dátové centrá */
  viaEdge?: boolean;
  /** Prípravný krok (napr. vypnutie ochrany formulára) – jeho cookies sa pošlú s hlavným dopytom */
  pre?: { url: string; method?: "GET" | "POST"; body?: string };
  /** Len na diagnostiku – nie je to dopyt do registra (napr. hľadanie otvorených dát) */
  info?: string;
  /** Popis pokusu (zobrazí sa v diagnostike; pokus sa normálne vyhodnocuje) */
  label?: string;
}

/** Adresa vlastného nasadenia (Vercel) a token pre interné volanie Edge načítania. */
function selfOrigin(): string | null {
  const h = process.env.VERCEL_PROJECT_PRODUCTION_URL || process.env.VERCEL_URL;
  return h ? `https://${h}` : process.env.SELF_ORIGIN || null;
}
function internalToken(): string {
  return createHash("sha256").update(`edgefetch:${process.env.SESSION_SECRET || "dev-only-secret-dev-only-secret-dev-only"}`).digest("hex");
}
async function fetchViaEdge(url: string, timeoutMs: number): Promise<{ status: number; body: string; contentType: string | null } | null> {
  const origin = selfOrigin();
  if (!origin) return null;
  const r = await fetchWithTimeout(`${origin}/api/edgefetch?url=${encodeURIComponent(url)}`, { headers: { "x-internal": internalToken() }, timeoutMs: timeoutMs + 3000 });
  const j = await r.json().catch(() => null);
  if (!j || typeof j.status !== "number") throw new Error(`edge: ${j?.error || `HTTP ${r.status}`}`);
  return { status: j.status, body: String(j.body || ""), contentType: j.contentType || null };
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
  attempts: { url: string; status?: number; ms: number; error?: string; excerpt: string; verdict: "found" | "clean" | "unknown"; evidence?: string; forms?: string[]; scripts?: string[]; links?: string[]; inlineScripts?: string[]; apiHints?: string[]; codeAround?: string[]; around?: string[]; mainText?: string; selects?: string[]; chunks?: string[]; raw?: string; contentType?: string; info?: string }[];
}

/** Text hlavného obsahu (od <main>/<h1>) – bez navigácie, na čítanie výsledkov v diagnostike. */
export function mainText(html: string): string {
  const i = Math.max(html.search(/<main\b/i), html.search(/<h1\b/i), html.search(/id=["']main["']/i));
  return stripHtml(i > 0 ? html.slice(i) : html).slice(0, 5000);
}

/** Výberové polia formulárov s hodnotami možností (napr. typ vyhľadávania ÚVO). */
export function selectOptions(html: string): string[] {
  return (html.match(/<select\b[^>]*>[\s\S]*?<\/select>/gi) || []).slice(0, 6).map((sel) => {
    const name = sel.match(/name=["']([^"']+)["']/i)?.[1] || "(bez mena)";
    const opts = (sel.match(/<option\b[^>]*>[\s\S]*?<\/option>/gi) || []).slice(0, 20).map((o) => `${o.match(/value=["']([^"']*)["']/i)?.[1] ?? ""}=${stripHtml(o).slice(0, 40)}`);
    return `${name}: ${opts.join(" | ")}`;
  });
}

/**
 * Vyhodnotenie podľa registra. VšZP: výsledková tabuľka (Obchodné meno · Obec · Ulica · PSČ · Pohľadávka …) neobsahuje IČO,
 * preto sa pri dopyte podľa IČO počítajú dátové riadky tabuľky; „Nenašli sa žiadne záznamy.“ = bez záznamu.
 */
export function judgeFor(source: string, html: string, needles: string[]): { verdict: "found" | "clean" | "unknown"; rows: string[]; evidence?: string } {
  const ico = needles[0] || "";
  if (source === "union") {
    try {
      const j = JSON.parse(html);
      const data: any[] = Array.isArray(j?.data) ? j.data : Array.isArray(j) ? j : [];
      const total = typeof j?.totalRows === "number" ? j.totalRows : data.length;
      const hit = data.filter((r) => String(r?.rplIco ?? r?.ico ?? "").replace(/\s/g, "") === ico);
      if (hit.length) return { verdict: "found", rows: hit.slice(0, 5).map((r) => `${r.rplNazov || r.nazov || ""} · IČO ${ico} · pohľadávka ${r.suma ?? "?"} €${r.obec ? ` · ${r.obec}` : ""}`), evidence: JSON.stringify(hit[0]).slice(0, 300) };
      if (total === 0) return { verdict: "clean", rows: [], evidence: "totalRows = 0" };
      return { verdict: "unknown", rows: [] }; // filter zrejme nezabral (server vrátil iných dlžníkov)
    } catch {
      return { verdict: "unknown", rows: [] };
    }
  }
  if (source === "uvo") {
    const main = mainText(html);
    const f = fold(main);
    const echoed = fold(html).includes(ico);
    const m = f.match(/(\d+)\s+zaznam/);
    if (echoed && m) {
      const n = Number(m[1]);
      if (n === 0) return { verdict: "clean", rows: [], evidence: main.slice(Math.max(0, (m.index || 0) - 60), (m.index || 0) + 60) };
      if (f.includes(`ico ${ico}`) || f.includes(ico)) {
        const i = main.indexOf(ico);
        const row = main.slice(Math.max(0, i - 220), i + 160);
        if (/z[aá]kaz/i.test(row)) return { verdict: "found", rows: [row], evidence: row };
      }
    }
    return { verdict: "unknown", rows: [] };
  }
  if (source === "vszp") {
    const text = stripHtml(html);
    const f = fold(text);
    const head = f.indexOf("obchodne meno");
    const echoed = fold(html).includes(fold(needles[0] || ""));
    if (head >= 0 && echoed) {
      const after = text.slice(head);
      if (/nena[sš]li sa [zž]iadne z[aá]znamy/i.test(after.slice(0, 400))) return { verdict: "clean", rows: [], evidence: after.slice(0, 160) };
      // dátové riadky tabuľky za hlavičkou
      const tables = html.match(/<table[\s\S]*?<\/table>/gi) || [];
      const results = tables.find((t) => /obchodn[eé] meno/i.test(stripHtml(t)) && /poh[lľ]ad[aá]vka/i.test(stripHtml(t)));
      if (results) {
        const rows = (results.match(/<tr[\s\S]*?<\/tr>/gi) || []).map((r) => stripHtml(r)).filter((r) => /\d/.test(r) && !/obchodn[eé] meno/i.test(r));
        if (rows.length) return { verdict: "found", rows: rows.slice(0, 10), evidence: rows[0].slice(0, 200) };
      }
    }
  }
  return judge(html, needles);
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
      let status: number, html: string, contentType: string | null;
      if (a.viaEdge) {
        const e = await fetchViaEdge(a.url, timeoutMs);
        if (!e) {
          out.attempts.push({ url: a.url, ms: Date.now() - t0, error: "Edge načítanie nie je k dispozícii (bez adresy nasadenia)", excerpt: "", verdict: "unknown", info: a.info });
          continue;
        }
        ({ status, body: html, contentType } = e);
      } else {
        const r = await fetchWithTimeout(a.url, {
          method: a.method || "GET",
          body: a.body,
          headers: { ...BROWSER_HEADERS, ...(a.body ? { "Content-Type": a.contentType || "application/x-www-form-urlencoded", Origin: new URL(a.url).origin, Referer: a.url, "Sec-Fetch-Site": "same-origin", "Sec-Fetch-Mode": "navigate" } : {}), ...(cookie ? { Cookie: cookie } : {}) },
          timeoutMs,
        });
        status = r.status;
        html = await r.text();
        contentType = r.headers.get("content-type");
      }
      const ok = status >= 200 && status < 300;
      const j = ok && !a.info ? judgeFor(a.source || "", html, needles) : { verdict: "unknown" as const, rows: [] };
      const d = describePage(html);
      const rec: ProbeOutcome["attempts"][number] = { url: a.url, status, ms: Date.now() - t0, excerpt: stripHtml(html).slice(0, opts.diag ? 3000 : 1500), verdict: j.verdict, evidence: j.evidence, forms: d.forms, scripts: d.scripts, links: d.links, raw: html.slice(0, opts.diag ? 3000 : 1500), contentType: contentType || undefined, info: [a.info, a.label, a.viaEdge ? "[cez Edge]" : ""].filter(Boolean).join(" ") || undefined };
      if (opts.diag) {
        rec.around = around(html, needles);
        rec.inlineScripts = inlineScripts(html);
        rec.mainText = mainText(html);
        rec.selects = selectOptions(html);
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
        // lenivo načítané časti aplikácie (Vue/Vite) týkajúce sa dlžníkov – v nich je volanie API
        const chunkNames = [...new Set((rec.codeAround.join(" ").match(/\.\/(Debtors[^"')]+\.js|[A-Za-z]*[Dd]lzn[^"')]+\.js)/g) || []).map((m) => m.replace(/^\.\//, "")))];
        const chunks: string[] = [];
        for (const name of chunkNames.slice(0, 2)) {
          try {
            const js = (await (await fetchWithTimeout(new URL(`/assets/${name}`, a.url).toString(), { timeoutMs })).text()).slice(0, 2_000_000);
            chunks.push(`${name}: ${apiHints(js).join(" , ")}`);
            chunks.push(...codeAround(js, ["api", "axios", ".get(", ".post(", "dlzn", "ico"], 8).map((c) => `${name} › ${c}`));
          } catch {
            /* časť sa nepodarilo načítať */
          }
        }
        rec.chunks = chunks.slice(0, 14);
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
      // justice.gov.sk blokuje adresy dátových centier (403 zo serverových funkcií) – skúšame cez Edge runtime vlastného nasadenia
      const base = "https://www.justice.gov.sk/registre/registerDiskvalifikacii/";
      return {
        attempts: [
          { url: `${base}?pageNum=1&size=10`, viaEdge: true },
          { url: `${base}?ico=${ico}&pageNum=1&size=50`, viaEdge: true },
          ...statutory.slice(0, 2).map((n) => ({ url: `${base}?priezvisko=${enc(n.replace(/^(ing|mgr|judr|mudr|phdr|bc|doc|prof)\.?\s+/i, "").split(" ").slice(-1)[0])}&pageNum=1&size=50`, viaEdge: true })),
          { url: `${base}?pageNum=1&size=10` },
          { url: "https://data.slovensko.sk/api/datasets/search?q=diskvalifik%C3%A1ci%C3%AD", info: "otvorené dáta (data.slovensko.sk) – hľadanie datasetu" },
        ],
        needles: [ico, ...statutory],
      };
    }
    case "uvo": {
      const base = "https://www.uvo.gov.sk/zaujemca-uchadzac/registre-o-hospodarskych-subjektoch/register-osob-so-zakazom";
      return {
        attempts: [
          // globálne vyhľadávanie ÚVO, výber searchType=OSZ („Osoba so zákazom“); výsledok „N záznamov“ / „Zadaný výraz nebol nájdený.“ + bloky s IČO.
          // Najprv podľa obchodného mena (register môže indexovať len názov; nález sa potvrdí IČO v zázname), potom podľa IČO.
          ...(ctx.profile.name ? [{ url: `https://www.uvo.gov.sk/vyhladavanie/globalne-vyhladavanie?globalSearch=${enc(ctx.profile.name)}&searchType=OSZ`, label: "podľa názvu" }] : []),
          { url: `https://www.uvo.gov.sk/vyhladavanie/globalne-vyhladavanie?globalSearch=${ico}&searchType=OSZ` },
          { url: base, info: "stránka registra" },
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
      // Portál Union (Vue): POST /ehip-server/rest/debtors s JSON { order, count, start, <hľadaný text> } → { data: [{ rplNazov, rplIco, suma, typZs, … }], totalRows }
      // názov poľa pre hľadaný text sa doladí podľa diagnostiky – skúšajú sa bežné varianty; nesprávne pole = server vráti všetkých (nikdy „bez záznamu“)
      const api = "https://portal.unionzp.sk/ehip-server/rest/debtors";
      const body = (key: string) => JSON.stringify({ order: { ascending: false, property: "dlznikId" }, count: 50, start: 0, [key]: ico });
      return {
        attempts: ["searchText", "text", "hladanyText", "search", "filter", "query", "ico", "rplIco"].map((k) => ({ url: api, method: "POST" as const, body: body(k), contentType: "application/json", label: `pole ${k}` })),
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
  const outcome = await probe(attempts.map((a) => ({ ...a, source: id })), needles, undefined, opts);
  // Union: API portálu vyžaduje token aplikácie (401) → skriptovaný dopyt cez prehliadač na serveri (bez AI)
  if (outcome.result === "unknown" && id === "union" && process.env.BROWSER_DISABLED !== "1") {
    const { unionFlow } = await import("../browser/flows");
    const r = await unionFlow(ctx.ico, { diag: opts.diag });
    outcome.attempts.push({ url: r.url, ms: r.ms, error: r.error, excerpt: (r.rendered || "").slice(0, opts.diag ? 6000 : 400), verdict: r.verdict, evidence: r.evidence, info: "prehliadač na serveri (skript)" });
    if (r.verdict !== "unknown") {
      outcome.result = r.verdict;
      outcome.rows = r.rows;
    }
  }
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
