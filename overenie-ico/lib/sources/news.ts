import { runCheck } from "../check";
import { fold, getText } from "../http";
import type { CheckResult, CompanyProfile, Ctx, Finding } from "../types";
import { NEWS_DOMAINS, OUTLETS, searchDuckDuckGo, searchOutlets, type Found } from "./slovakMedia";

/**
 * Médiá: Google News RSS + Bing News RSS (slovenská lokalizácia), zlúčené, bez duplicít,
 * každý článok ohodnotený relevanciou (či je naozaj o tomto subjekte) a zoradený od najnovšieho.
 * Nerelevantné články (iné firmy s podobným menom) sa zahodia; zobrazujú sa len posledné 3 roky.
 */

/** Negatívne výrazy – hľadajú sa ako začiatky slov (bez diakritiky). */
const NEGATIVE: [string, RegExp][] = [
  ["podvod", /\bpodvod/],
  ["obvinenie", /\bobvin/],
  ["trestné stíhanie", /\b(trestn\w* stihan|stihan)/],
  ["NAKA / polícia", /\b(naka|polici|kriminalist|vysetrovatel)/],
  ["zadržanie", /\b(zatkn|zadrza|zadrzan)/],
  ["konkurz", /\bkonkurz/],
  ["exekúcia", /\bexeku/],
  ["insolvencia / úpadok", /\b(insolven|upad)/],
  ["dlhy", /\b(dlhy|dlhov|dlhmi|dlzni|dlzob|nezaplaten|neplati)/],
  ["pokuta / sankcia", /\b(pokut|sankci)/],
  ["kartel / korupcia", /\b(kartel|korupc|uplat)/],
  ["daňový únik / karusel", /\b(danov\w* unik|karusel|kraten\w* dan)/],
  ["žaloba / spor", /\b(zalob|zaloval|sudny spor|spor s)/],
  ["likvidácia / krach", /\b(likvidaci|krach|skrachoval|zanikl)/],
  ["sprenevera / pranie", /\b(spreneve|prani\w* spinav)/],
  ["kauza / škandál", /\b(kauz|skandal|afer)/],
  ["prepúšťanie", /\b(prepust|hromadn\w* prepust)/],
];

export interface Article {
  title: string;
  link: string;
  source?: string;
  domain?: string;
  date?: string;
  snippet?: string;
  negative: string[];
  relevance: number;
  provider: "google" | "bing" | "web" | "outlet" | "ddg";
}

/** Skráti obchodné meno na hľadaný výraz (bez právnej formy). */
export function searchName(name: string): string {
  return name
    .replace(/,?\s*(spol\.\s*s\s*r\.\s*o\.|s\.\s*r\.\s*o\.|a\.\s*s\.|k\.\s*s\.|v\.\s*o\.\s*s\.|s\.\s*e\.|družstvo|advokátska kancelária|v likvidácii|v konkurze).*$/i, "")
    .replace(/[,\s]+$/, "")
    .trim();
}

/** Porovnanie bez medzier a interpunkcie: „Urban&Partners“ = „URBAN & PARTNERS“. */
export const compact = (s: string) => fold(s).replace(/[^a-z0-9&]/g, "");

/**
 * Varianty mena, pod ktorými o firme píšu médiá: skrátené meno, zápis bez medzier okolo „&“,
 * a predchádzajúce obchodné mená (firmy sa premenúvajú – staršie články sú pod starým menom).
 */
export function nameVariants(p: CompanyProfile): string[] {
  const out: string[] = [];
  const add = (x?: string) => {
    const v = (x || "").trim();
    if (v.length > 2 && !out.some((o) => compact(o) === compact(v) && o === v)) out.push(v);
  };
  const short = p.name ? searchName(p.name) : "";
  add(short);
  if (/\s&\s/.test(short)) add(short.replace(/\s*&\s*/g, "&"));
  if (/&/.test(short)) add(short.replace(/\s*&\s*/g, " and "));
  for (const f of (p.formerNames || []).slice(-2).reverse()) if (compact(searchName(f)).length >= 10) add(searchName(f));
  return out.slice(0, 5);
}

const decode = (s: string) =>
  s
    .replace(/<!\[CDATA\[|\]\]>/g, "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/\s+/g, " ")
    .trim();

function parseRss(xml: string, provider: Article["provider"]): Omit<Article, "negative" | "relevance">[] {
  const items = xml.match(/<item>[\s\S]*?<\/item>/g) || [];
  return items.map((it) => {
    const g = (tag: string) => decode((it.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`)) || [])[1] || "");
    const srcUrl = (it.match(/<source[^>]*url="([^"]+)"/) || [])[1];
    let title = g("title");
    let source = g("source") || g("News:Source") || undefined;
    // Google pridáva „ - Zdroj“ na koniec titulku
    if (provider === "google" && source && title.endsWith(` - ${source}`)) title = title.slice(0, -(source.length + 3));
    const link = g("link");
    let domain: string | undefined;
    try {
      const real = provider === "bing" ? new URL(link).searchParams.get("url") || link : srcUrl || link;
      domain = new URL(real).hostname.replace(/^www\./, "");
    } catch {
      /* bez domény */
    }
    return { title, link, source, domain, date: g("pubDate") || undefined, snippet: g("description").slice(0, 400), provider };
  });
}

const GENERIC = new Set(
  "a and the of partners partner group company slovakia slovensko sk services service consulting trade trading holding invest investment management solutions system systems international europe central plus pro".split(" "),
);

/** Ohodnotí, nakoľko je článok o tomto subjekte (0 = nesúvisí). */
export function relevance(a: { title: string; snippet?: string; domain?: string; link?: string }, p: CompanyProfile): number {
  let path = "";
  try {
    if (a.link) path = decodeURIComponent(new URL(a.link).pathname);
  } catch {
    /* bez adresy */
  }
  const hay = fold(`${a.title} ${a.snippet || ""} ${path.replace(/[-_/]+/g, " ")}`);
  const hayC = compact(`${a.title} ${a.snippet || ""} ${path}`);
  const titleC = compact(`${a.title} ${path}`);
  const names = [p.name || "", ...(p.formerNames || [])].filter(Boolean);
  // predchádzajúce mená len ak sú dostatočne výrazné (napr. „URBAN“ samo by chytilo čokoľvek)
  const mainShort = compact(searchName(p.name || ""));
  const shorts = [...new Set([mainShort, ...(p.formerNames || []).map((n) => compact(searchName(n))).filter((x) => x.length >= 10)])].filter((x) => x.length > 2);
  let s = 0;
  if (names.some((n) => compact(n).length > 8 && hayC.includes(compact(n)))) s += 3; // úplné meno s právnou formou
  if (shorts.some((sh) => titleC.includes(sh))) s += 3;
  else if (shorts.some((sh) => hayC.includes(sh))) s += 2;
  else {
    const words = fold(searchName(p.name || "")).split(/[^a-z0-9]+/).filter((w) => w.length > 2 && !GENERIC.has(w));
    if (words.length && words.every((w) => hay.includes(w))) s += 1;
  }
  if (hay.includes(p.ico)) s += 3;
  // kontext: štatutár, mesto sídla, zdroj
  const surnames = (p.statutory || []).map((x) => fold(x.name).split(" ").filter((w) => w.length > 3).pop() || "").filter(Boolean);
  if (surnames.some((sn) => hay.includes(sn))) s += 2;
  const city = fold((p.address || "").split(",").pop() || "").replace(/\d+/g, "").split(" - ")[0].trim();
  if (city.length > 3 && hay.includes(city)) s += 1;
  if (a.domain && /\.(sk|cz)$/.test(a.domain)) s += 1;
  // krátke / všeobecné meno: bez kontextu nestačí
  const main = compact(searchName(p.name || ""));
  const mainWords = fold(searchName(p.name || "")).split(/[^a-z0-9]+/).filter((w) => w.length > 2 && !GENERIC.has(w));
  if (mainWords.length <= 1 && main.length < 8 && s < 4) s = Math.min(s, 1);
  return s;
}

/** Stránky registrov a katalógov firiem – nie sú to médiá (zobrazujú sa ako odkazy). */
const NOT_MEDIA = /(^|\.)(finstat|orsr|uvostat|finreg|foaf|indexpodnikatela|profesia|emis|zoznam|firmy|kompass|registeruz|rpvs|crz|statistics|justice|slov-lex|linkedin|facebook|instagram|youtube|twitter|x)\.(sk|com|gov\.sk|eu|cz)$/;

const MIN_RELEVANCE = 2;
const YEARS = 5;

export interface Rejected {
  title: string;
  link: string;
  source?: string;
  date?: string;
  reason: string;
}

/** Vráti relevantné články a zvlášť vyradené aj s dôvodom (aby sa filter dal skontrolovať). */
export function processArticles(raw: Omit<Article, "negative" | "relevance">[], p: CompanyProfile, now = Date.now(), rejected: Rejected[] = []): Article[] {
  const seen = new Set<string>();
  const out: Article[] = [];
  const reject = (a: Omit<Article, "negative" | "relevance">, reason: string) =>
    rejected.push({ title: a.title, link: a.link, source: a.source || a.domain, date: a.date, reason });
  for (const a of raw) {
    const key = fold(a.title).replace(/[^a-z0-9]+/g, " ").trim().slice(0, 90);
    const ukey = (a.link || "").replace(/^https?:\/\/(www\.)?/, "").replace(/[?#].*$/, "");
    if (!key || seen.has(key) || (ukey && seen.has(ukey))) continue;
    seen.add(key);
    if (ukey) seen.add(ukey);
    const t = a.date ? +new Date(a.date) : NaN;
    if (Number.isFinite(t) && now - t > YEARS * 365.25 * 864e5) {
      reject(a, `starší ako ${YEARS} rokov`);
      continue;
    }
    if (a.domain && NOT_MEDIA.test(a.domain)) {
      reject(a, "katalóg firiem / register (nie médium)");
      continue;
    }
    const rel = relevance(a, p);
    if (rel < MIN_RELEVANCE) {
      reject(a, "meno firmy sa v titulku ani popise nenachádza");
      continue;
    }
    const hay = ` ${fold(`${a.title} ${a.snippet || ""}`)} `;
    const negative = NEGATIVE.filter(([, re]) => re.test(hay)).map(([label]) => label);
    out.push({ ...a, negative, relevance: rel });
  }
  return out.sort((x, y) => (y.date ? +new Date(y.date) : 0) - (x.date ? +new Date(x.date) : 0));
}

export async function checkNews(ctx: Ctx): Promise<CheckResult> {
  return runCheck(
    {
      id: "news",
      category: "media",
      name: "Médiá a internet (PR, správy)",
      source: "Slovenské médiá priamo (SME, Denník N, HN, Pravda, TREND, Aktuality, TASR, Forbes, epravo…) + index vyhľadávačov",
      sourceUrl: "https://www.sme.sk",
    },
    async () => {
      const p = ctx.profile;
      const short = p.name ? searchName(p.name) : "";
      const q = short ? `"${short}"` : `"${ctx.ico}"`;
      const surname = (p.statutory || [])[0]?.name.split(" ").filter((w) => w.length > 3).pop();
      const links = {
        google: `https://www.google.com/search?q=${encodeURIComponent(`${q} OR "${ctx.ico}"`)}&tbm=nws&tbs=qdr:y`,
        googleNegative: `https://www.google.com/search?q=${encodeURIComponent(`${q} (podvod OR exekúcia OR konkurz OR polícia OR pokuta OR dlh)`)}`,
        finstat: `https://finstat.sk/${ctx.ico}`,
        indexPodnikatela: `https://www.indexpodnikatela.sk/${ctx.ico}`,
        foaf: `https://www.foaf.sk/firmy/${ctx.ico}`,
        crz: `https://www.crz.gov.sk/zmluvy/?art_ico=${ctx.ico}`,
      };
      const g = (query: string) => `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=sk&gl=SK&ceid=SK:sk`;
      const b = (query: string) => `https://www.bing.com/news/search?q=${encodeURIComponent(query)}&format=rss&setlang=sk&cc=SK&qft=${encodeURIComponent('sortbydate="1"')}`;
      const w = (query: string) => `https://www.bing.com/search?q=${encodeURIComponent(query)}&format=rss&setlang=sk&cc=SK&count=50`;
      const variants = nameVariants(p);
      const quoted = variants.map((v) => `"${v}"`);
      const any = quoted.length ? quoted.join(" OR ") : q;
      const queries: [string, Article["provider"]][] = [
        [g(`${any} when:1y`), "google"], // najnovšie – všetky varianty mena
        [g(any), "google"],
        [b(quoted[0] || q), "bing"],
        [w(`${any} -site:finstat.sk -site:orsr.sk -site:uvostat.sk`), "web"], // PR, odborné weby, tlačové správy
      ];
      for (const v of quoted.slice(1, 3)) queries.push([g(v), "google"], [b(v), "bing"]);
      if (surname && quoted[0]) queries.push([g(`${quoted[0]} "${surname}"`), "google"]);

      const [results, outlets, ddg] = await Promise.all([
        Promise.allSettled(queries.map(([u]) => getText(u, { timeoutMs: 12000 }))),
        variants.length ? searchOutlets(variants).catch(() => ({ found: [] as Found[], ok: [] as string[], failed: [] as string[] })) : Promise.resolve({ found: [] as Found[], ok: [] as string[], failed: [] as string[] }),
        variants.length ? searchDuckDuckGo(variants).catch(() => [] as Found[]) : Promise.resolve([] as Found[]),
      ]);
      const toRaw = (f: Found, provider: Article["provider"]) => ({ title: f.title, link: f.link, source: f.source, domain: f.domain, date: f.date, snippet: f.snippet, provider });
      const raw = [
        ...outlets.found.map((f) => toRaw(f, "outlet")),
        ...ddg.map((f) => toRaw(f, "ddg")),
        ...results.flatMap((r, i) => (r.status === "fulfilled" ? parseRss(r.value, queries[i][1]).slice(0, 50) : [])),
      ];
      if (!raw.length && results.every((r) => r.status === "rejected") && !outlets.ok.length) throw new Error("médiá ani vyhľadávače neodpovedajú");

      const rejected: Rejected[] = [];
      const articles = processArticles(raw, p, Date.now(), rejected);
      const twoYears = Date.now() - 2 * 365.25 * 864e5;
      const recentNeg = articles.filter((a) => a.negative.length && (!a.date || +new Date(a.date) > twoYears));
      const f: Finding[] = [];
      if (recentNeg.length >= 3)
        f.push({ severity: "warning", text: `${recentNeg.length} relevantné správy s negatívnym obsahom za 2 roky – preverte`, penalty: 10 });
      else if (recentNeg.length > 0)
        f.push({ severity: "warning", text: `${recentNeg.length === 1 ? "1 relevantná správa" : `${recentNeg.length} relevantné správy`} s negatívnym obsahom – preverte kontext`, penalty: 3 });
      const latest = articles[0]?.date ? new Date(articles[0].date).toLocaleDateString("sk-SK") : undefined;
      return {
        status: recentNeg.length ? "warning" : "ok",
        summary: articles.length
          ? `${articles.length} relevantných článkov za posledných ${YEARS} rokov (najnovší ${latest || "bez dátumu"}); s negatívnym obsahom za 2 roky: ${recentNeg.length}. Prehľadaných ${raw.length} výsledkov, nesúvisiace (iné firmy s podobným menom) vyradené.`
          : raw.length
            ? `Za posledných ${YEARS} rokov sa nenašli články, v ktorých by sa uvádzalo meno subjektu (prehľadaných ${raw.length} výsledkov). Vyradené výsledky sú zobrazené nižšie.`
            : "Vyhľadávače správ nevrátili žiadne výsledky – mohli zablokovať požiadavku zo servera. Použite odkazy nižšie.",
        findings: f,
        verifyUrl: links.google,
        data: { query: quoted.join(" | ") || q, variants, articles: articles.slice(0, 25), rejected: rejected.slice(0, 30), scanned: raw.length, sources: [
            ...outlets.ok.map((n) => ({ provider: "outlet", name: n, ok: true, items: outlets.found.filter((f) => f.source === n).length })),
            ...outlets.failed.map((n) => ({ provider: "outlet", name: n, ok: false, items: 0 })),
            { provider: "ddg", ok: ddg.length > 0, items: ddg.length },
            ...results.map((r, i) => ({ provider: queries[i][1], ok: r.status === "fulfilled", items: r.status === "fulfilled" ? parseRss(r.value, queries[i][1]).length : 0 })),
          ], outletsOk: outlets.ok, outletsFailed: outlets.failed, links },
      };
    },
  );
}
