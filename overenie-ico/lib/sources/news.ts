import { runCheck } from "../check";
import { fold, getText } from "../http";
import type { CheckResult, CompanyProfile, Ctx, Finding } from "../types";

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
  provider: "google" | "bing";
}

/** Skráti obchodné meno na hľadaný výraz (bez právnej formy). */
export function searchName(name: string): string {
  return name
    .replace(/,?\s*(spol\.\s*s\s*r\.\s*o\.|s\.\s*r\.\s*o\.|a\.\s*s\.|k\.\s*s\.|v\.\s*o\.\s*s\.|s\.\s*e\.|družstvo|advokátska kancelária|v likvidácii|v konkurze).*$/i, "")
    .replace(/[,\s]+$/, "")
    .trim();
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
export function relevance(a: { title: string; snippet?: string; domain?: string }, p: CompanyProfile): number {
  const name = p.name || "";
  const short = fold(searchName(name));
  const full = fold(name);
  const hay = fold(`${a.title} ${a.snippet || ""}`);
  const title = fold(a.title);
  const words = short.split(/[^a-z0-9]+/).filter((w) => w.length > 2 && !GENERIC.has(w));
  let s = 0;
  if (full.length > 5 && hay.includes(full)) s += 3;
  if (short.length > 2 && title.includes(short)) s += 3;
  else if (short.length > 2 && hay.includes(short)) s += 2;
  else if (words.length && words.every((w) => hay.includes(w))) s += 1;
  if (hay.includes(p.ico)) s += 3;
  // kontext: štatutár, mesto sídla, predmet činnosti
  const surnames = (p.statutory || []).map((x) => fold(x.name).split(" ").filter((w) => w.length > 3).pop() || "").filter(Boolean);
  if (surnames.some((sn) => hay.includes(sn))) s += 2;
  const city = fold((p.address || "").split(",").pop() || "").replace(/\d+/g, "").split(" - ")[0].trim();
  if (city.length > 3 && hay.includes(city)) s += 1;
  if (a.domain && /\.(sk|cz)$/.test(a.domain)) s += 1;
  // krátke / všeobecné mená: bez kontextu nestačí
  if (words.length <= 1 && short.length < 8 && s < 4) s = Math.min(s, 1);
  return s;
}

const MIN_RELEVANCE = 3;
const YEARS = 3;

export function processArticles(raw: Omit<Article, "negative" | "relevance">[], p: CompanyProfile, now = Date.now()): Article[] {
  const seen = new Set<string>();
  const out: Article[] = [];
  for (const a of raw) {
    const key = fold(a.title).replace(/[^a-z0-9]+/g, " ").trim().slice(0, 90);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    const t = a.date ? +new Date(a.date) : NaN;
    if (Number.isFinite(t) && now - t > YEARS * 365.25 * 864e5) continue;
    const rel = relevance(a, p);
    if (rel < MIN_RELEVANCE) continue;
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
      source: "Google News + Bing News (SK), filtrované podľa relevancie",
      sourceUrl: "https://news.google.com",
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
      const queries: [string, Article["provider"]][] = [
        [g(`${q} when:1y`), "google"], // najnovšie
        [g(q), "google"], // všetky
        [b(q), "bing"],
      ];
      if (p.name && p.name !== short) queries.push([g(`"${p.name}"`), "google"]);
      if (surname && short) queries.push([g(`${q} "${surname}"`), "google"]);

      const results = await Promise.allSettled(queries.map(([u]) => getText(u, { timeoutMs: 12000 })));
      const raw = results.flatMap((r, i) => (r.status === "fulfilled" ? parseRss(r.value, queries[i][1]).slice(0, 50) : []));
      if (results.every((r) => r.status === "rejected")) throw new Error("vyhľadávače správ neodpovedajú");

      const articles = processArticles(raw, p);
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
          ? `${articles.length} relevantných článkov za posledné ${YEARS} roky (najnovší ${latest || "bez dátumu"}); s negatívnym obsahom za 2 roky: ${recentNeg.length}. Prehľadaných ${raw.length} výsledkov, nesúvisiace (iné firmy s podobným menom) vyradené.`
          : `Za posledné ${YEARS} roky sa nenašli relevantné články o subjekte (prehľadaných ${raw.length} výsledkov).`,
        findings: f,
        verifyUrl: links.google,
        data: { query: q, articles: articles.slice(0, 20), scanned: raw.length, links },
      };
    },
  );
}
