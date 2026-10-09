import { runCheck } from "../check";
import { fold, getText } from "../http";
import { sq } from "../searchlog";
import type { SearchLog } from "../types";
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
  /** „firma“ alebo meno osoby (štatutár / vlastník), ktorej sa článok týka. */
  about?: string;
  /** Z akého dopytu výsledok pochádza (firm = presný názov firmy v úvodzovkách). */
  via?: "firm" | "person" | "other";
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

/** Meno osoby bez titulov: „JUDr. Ondrej Urban, MBA“ → „Ondrej Urban“. */
export function plainPersonName(name: string): string {
  return name
    .replace(/\b(JUDr|Mgr|Ing|Bc|MUDr|PhDr|RNDr|Doc|Prof|PaedDr|ThDr|MVDr|Dr|Dipl|arch|CSc|DrSc|PhD|MBA|LL\.?M|LLM|MSc|BSc|MA|BA|M\.A|B\.A|et)\.?\b/gi, "")
    .replace(/[.,]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Osoby, ktoré sa hľadajú v médiách: štatutári a vlastníci (bez titulov, bez duplicít). */
export function people(p: CompanyProfile): string[] {
  const out: string[] = [];
  for (const x of [...(p.statutory || []), ...(p.owners || [])]) {
    const n = plainPersonName(x.name || "");
    if (n.split(" ").length >= 2 && !out.some((o) => fold(o) === fold(n))) out.push(n);
  }
  return out.slice(0, 4);
}

/** Skratky z iniciál (advokátske kancelárie: URBAN STEINECKER GAŠPEREC BOŠANSKÝ → USGB, URBAN GAŠPEREC BOŠANSKÝ → UGB). */
export function acronyms(p: CompanyProfile): string[] {
  const out = new Set<string>();
  for (const n of [p.name || "", ...(p.formerNames || [])]) {
    const words = searchName(n).split(/[^\p{L}]+/u).filter((w) => w.length >= 2);
    if (words.length >= 3) out.add(words.map((w) => w[0]).join("").toUpperCase());
  }
  return [...out].filter((a) => a.length >= 3);
}

/** Priezviská partnerov z názvov kancelárie (súčasných aj bývalých) – „Bošanský“, „Steinecker“, „Falath“. */
export function partnerSurnames(p: CompanyProfile): string[] {
  const out: string[] = [];
  for (const n of [p.name || "", ...(p.formerNames || [])]) {
    for (const w of searchName(n).split(/[^\p{L}]+/u)) {
      // aspoň 6 znakov – krátke priezviská (Urban, Novák) sú aj bežné slová / príliš časté
      if (w.length >= 6 && w === w.toUpperCase() && !GENERIC.has(fold(w)) && !out.some((o) => fold(o) === fold(w))) out.push(w[0] + w.slice(1).toLowerCase());
    }
  }
  return out.slice(0, 6);
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
    return { title, link, source, domain, date: g("pubDate") || undefined, snippet: g("description").slice(0, 400), provider, via: "other" as const };
  });
}

const GENERIC = new Set(
  "a and the of partners partner group company slovakia slovensko sk services service consulting trade trading holding invest investment management solutions system systems international europe central plus pro".split(" "),
);

/** Ohodnotí, nakoľko je článok o tomto subjekte (0 = nesúvisí). */
export function relevance(a: { title: string; snippet?: string; domain?: string; link?: string; via?: string; provider?: string; source?: string }, p: CompanyProfile): { score: number; about: string } {
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
  const mainShort = compact(searchName(p.name || ""));
  const shorts = [...new Set([mainShort, ...(p.formerNames || []).map((n) => compact(searchName(n))).filter((x) => x.length >= 10)])].filter((x) => x.length > 2);
  const city = fold((p.address || "").split(",").pop() || "").replace(/\d+/g, "").split(" - ")[0].trim();
  const skcz = Boolean((a.domain && /\.(sk|cz)$/.test(a.domain)) || (a.source && /\.sk$|\.cz$|^(SME|Pravda|Denník N|Hospodárske noviny|HN|TREND|Aktuality|TASR|Teraz|Forbes|Plus 7 Dní|Nový Čas|TA3|Postoj|epravo|Právne noviny|Webnoviny|Startitup|Refresher|Topky|Markíza|RTVS|STVR|Info\.sk)/i.test(a.source)));

  // --- firma ---
  let s = 0;
  // v adrese článku sa „&“ nepíše (urban-partners-…), preto sa tam porovnáva bez neho
  const pathC = compact(path).replace(/&/g, "");
  const inPath = shorts.some((sh) => sh.length >= 8 && pathC.includes(sh.replace(/&/g, "")));
  // skratka kancelárie (USGB, UGB) ako samostatné slovo v titulku/popise
  const rawText = `${a.title} ${a.snippet || ""}`;
  const acr = acronyms(p).find((ac) => new RegExp(`(^|[^A-Za-z])${ac}([^A-Za-z]|$)`, "i").test(rawText));
  // vyhľadávač našiel presný názov firmy v texte článku (dopyt v úvodzovkách) – v titulku/popise nemusí byť
  const engineMatch = a.via === "firm";
  if (names.some((n) => compact(n).length > 8 && hayC.includes(compact(n)))) s += 3;
  if (shorts.some((sh) => titleC.includes(sh)) || inPath || acr) s += 3;
  else if (shorts.some((sh) => hayC.includes(sh))) s += 2;
  else {
    const words = fold(searchName(p.name || "")).split(/[^a-z0-9]+/).filter((w) => w.length > 2 && !GENERIC.has(w));
    if (words.length && words.every((w) => hay.includes(w))) s += 1;
  }
  if (hay.includes(p.ico)) s += 3;
  const persons = people(p);
  const personHit = persons.find((n) => hayC.includes(compact(n)));
  if (personHit) s += 2;
  const lawCtx = /advokat|pravnik|pravnic|kancelari|konatel|spolocnik|majitel|s\.r\.o|sro\b|firm|\bsud|zmluv|klient|obhaj|zastup|naka|polici|korupc|obvin/;
  // priezvisko partnera z názvu kancelárie (Bošanský, Steinecker…) + právnický kontext
  const surnameHit = partnerSurnames(p).find((sn) => new RegExp(`(^|[^a-z])${fold(sn)}(?=[^a-z]|$)`).test(hay.replace(/[^a-z0-9 ]/g, " ")) || hay.includes(fold(sn)));
  if (engineMatch) s += 2;
  if (surnameHit && lawCtx.test(hay)) s += 2;
  if (city.length > 3 && hay.includes(city)) s += 1;
  if (skcz) s += 1;
  const mainWords = fold(searchName(p.name || "")).split(/[^a-z0-9]+/).filter((w) => w.length > 2 && !GENERIC.has(w));
  if (mainWords.length <= 1 && mainShort.length < 8 && s < 4) s = Math.min(s, 1);
  const firmMention = shorts.some((sh) => hayC.includes(sh)) || inPath || Boolean(acr) || hay.includes(p.ico);
  if (s >= MIN_RELEVANCE && firmMention) return { score: s, about: "firma" };
  // Google News s presným názvom firmy v úvodzovkách vracia len články, kde sa názov v texte nachádza:
  // slovenský zdroj stačí; pri voľnejších vyhľadávačoch (Bing, DDG) treba aj právnický kontext alebo meno partnera
  if (engineMatch && skcz && (a.provider === "google" || lawCtx.test(hay) || personHit || surnameHit)) return { score: Math.max(s, 3), about: "firma" };
  if (surnameHit && lawCtx.test(hay) && s >= 3) return { score: s, about: `${surnameHit} (partner podľa názvu kancelárie)` };

  // --- osoba (štatutár / vlastník): meno + kontext (advokát, firma, mesto, funkcia) ---
  if (personHit) {
    let ps = 2;
    const ctxWords = /advokat|pravnik|pravnic|kancelari|konatel|spolocnik|majitel|partner|s\.r\.o|sro\b|firm|sud|zmluv|klient|obhaj|zastup/;
    const hasCtx = ctxWords.test(hay) || shorts.some((sh) => hayC.includes(sh)) || inPath || (city.length > 3 && hay.includes(city));
    if (ctxWords.test(hay)) ps += 1;
    if (shorts.some((sh) => hayC.includes(sh)) || inPath) ps += 2;
    if (city.length > 3 && hay.includes(city)) ps += 1;
    if (skcz) ps += 1;
    if (compact(a.title).includes(compact(personHit))) ps += 1;
    // bez kontextu (advokát / firma / mesto) ide pravdepodobne o menovca
    if (!hasCtx) ps = Math.min(ps, 3);
    if (ps >= 4) return { score: ps, about: personHit };
  }
  // ani firma, ani osoba s kontextom → nerelevantné
  return { score: Math.min(s, 1), about: "firma" };
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
    const { score: rel, about } = relevance(a, p);
    if (rel < MIN_RELEVANCE) {
      reject(a, "meno firmy ani štatutára sa v titulku, popise ani adrese nenachádza");
      continue;
    }
    const hay = ` ${fold(`${a.title} ${a.snippet || ""}`)} `;
    const negative = NEGATIVE.filter(([, re]) => re.test(hay)).map(([label]) => label);
    out.push({ ...a, negative, relevance: rel, about });
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
      const queries: [string, Article["provider"], "firm" | "person" | "other"][] = [
        [g(`${any} when:1y`), "google", "firm"], // najnovšie – všetky varianty mena
        [g(any), "google", "firm"],
        [b(quoted[0] || q), "bing", "firm"],
        [w(`${any} -site:finstat.sk -site:orsr.sk -site:uvostat.sk`), "web", "other"], // PR, odborné weby, tlačové správy
      ];
      for (const v of quoted.slice(1, 4)) queries.push([g(v), "google", "firm"], [b(v), "bing", "firm"]);
      for (const ac of acronyms(p)) queries.push([g(`"${ac}" advokátska kancelária`), "google", "other"]);
      if (surname && quoted[0]) queries.push([g(`${quoted[0]} "${surname}"`), "google", "firm"]);
      // štatutári, vlastníci a partneri z názvu kancelárie: meno + kontext, aby sa nezachytili menovci
      const persons = people(p);
      for (const person of persons.slice(0, 3)) {
        queries.push([g(`"${person}" (advokát OR ${quoted[0] || "firma"})`), "google", "person"], [b(`"${person}"`), "bing", "person"], [w(`"${person}" advokát OR ${quoted[0] || ""}`), "web", "person"]);
      }
      for (const sn of partnerSurnames(p).slice(0, 4)) queries.push([g(`"${sn}" advokát`), "google", "person"]);

      const [results, outlets, ddg, ddgPeople] = await Promise.all([
        Promise.allSettled(queries.map(([u]) => getText(u, { timeoutMs: 12000 }))),
        variants.length ? searchOutlets(variants).catch(() => ({ found: [] as Found[], ok: [] as string[], failed: [] as string[] })) : Promise.resolve({ found: [] as Found[], ok: [] as string[], failed: [] as string[] }),
        variants.length ? searchDuckDuckGo(variants).catch(() => [] as Found[]) : Promise.resolve([] as Found[]),
        Promise.all(people(p).slice(0, 2).map((n) => searchDuckDuckGo([n, `${n} advokát`]).catch(() => [] as Found[]))).then((x) => x.flat()),
      ]);
      const toRaw = (f: Found, provider: Article["provider"], via: "firm" | "person" | "other" = "firm") => ({ title: f.title, link: f.link, source: f.source, domain: f.domain, date: f.date, snippet: f.snippet, provider, via });
      const raw = [
        ...outlets.found.map((f) => toRaw(f, "outlet")),
        ...ddg.map((f) => toRaw(f, "ddg")),
        ...ddgPeople.map((f) => toRaw(f, "ddg", "person")),
        ...results.flatMap((r, i) => (r.status === "fulfilled" ? parseRss(r.value, queries[i][1]).slice(0, 50).map((x) => ({ ...x, via: queries[i][2] })) : [])),
      ];
      if (!raw.length && results.every((r) => r.status === "rejected") && !outlets.ok.length) throw new Error("médiá ani vyhľadávače neodpovedajú");

      const rejected: Rejected[] = [];
      const articles = processArticles(raw, p, Date.now(), rejected);
      const twoYears = Date.now() - 2 * 365.25 * 864e5;
      const recentNeg = articles.filter((a) => a.negative.length && (!a.date || +new Date(a.date) > twoYears));
      const olderNeg = articles.filter((a) => a.negative.length && a.date && +new Date(a.date) <= twoYears);
      const f: Finding[] = [];
      const serious = (list: Article[]) => list.filter((a) => a.negative.some((n) => /NAKA|kartel|podvod|obvinenie|trestn|sprenever|zadržanie/i.test(n)));
      if (olderNeg.length)
        f.push({
          severity: "warning",
          text: `${olderNeg.length} ${olderNeg.length === 1 ? "staršia negatívna správa" : "staršie negatívne správy"} (2–5 rokov)${serious(olderNeg).length ? ` – závažné: ${[...new Set(serious(olderNeg).flatMap((a) => a.negative))].slice(0, 4).join(", ")}` : ""}; preverte vývoj prípadu`,
          penalty: serious(olderNeg).length ? 8 : 3,
        });
      if (recentNeg.length >= 3)
        f.push({ severity: "warning", text: `${recentNeg.length} relevantné správy s negatívnym obsahom za 2 roky – preverte`, penalty: 10 });
      else if (recentNeg.length > 0)
        f.push({ severity: "warning", text: `${recentNeg.length === 1 ? "1 relevantná správa" : `${recentNeg.length} relevantné správy`} s negatívnym obsahom – preverte kontext`, penalty: 3 });
      const asOf = ctx.asOf
        ? {
            date: ctx.asOf,
            before: articles.filter((a) => a.date && a.date.slice(0, 10) <= ctx.asOf!).map((a) => ({ title: a.title, date: a.date, negative: a.negative, source: a.source })),
            negativeBefore: articles.filter((a) => a.negative.length && a.date && a.date.slice(0, 10) <= ctx.asOf!).length,
            undated: articles.filter((a) => !a.date).length,
          }
        : undefined;
      const latest = articles[0]?.date ? new Date(articles[0].date).toLocaleDateString("sk-SK") : undefined;
      const aboutFirm = articles.filter((a) => a.about === "firma").length;
      const aboutPeople = articles.length - aboutFirm;
      const providerName: Record<string, string> = { google: "Google News", bing: "Bing News", web: "Bing web" };
      const search: SearchLog[] = [
        {
          dataset: "Slovenské médiá priamo a vyhľadávače správ (Google News, Bing, DuckDuckGo)",
          queries: [
            ...variants.map((v) => sq("mena firmy", v, null, articles.filter((a) => a.about === "firma").length, undefined, "variant obchodného mena")),
            ...people(p).map((n) => sq("osoby", n, null, articles.filter((a) => a.about !== "firma" && JSON.stringify(a).includes(n)).length, undefined, "štatutár / vlastník s kontextom")),
            ...outlets.ok.map((n) => sq("média", n, outlets.found.filter((f) => f.source === n).length, outlets.found.filter((f) => f.source === n && articles.some((a) => a.link === f.link)).length)),
            ...(outlets.failed.length ? [sq("médiá", outlets.failed.join(", "), null, 0, undefined, "neodpovedali")] : []),
            sq("DuckDuckGo", variants[0] || ctx.ico, ddg.length + ddgPeople.length, [...ddg, ...ddgPeople].filter((f) => articles.some((a) => a.link === f.link)).length),
            ...results.map((r, i) =>
              sq(providerName[queries[i][1]] || queries[i][1], decodeURIComponent((queries[i][0].match(/[?&]q=([^&]+)/) || [])[1] || "").replace(/\+/g, " ").slice(0, 120), r.status === "fulfilled" ? parseRss(r.value, queries[i][1]).length : null, 0, undefined, r.status === "fulfilled" ? undefined : "neodpovedal"),
            ),
          ],
          total: raw.length,
          rule: `článok o firme (meno, skratka) alebo o štatutárovi/vlastníkovi s kontextom firmy, posledných ${YEARS} rokov; vyradené: iné firmy s podobným menom, menovci, katalógy`,
          sample: rejected.slice(0, 5).map((r: any) => `${r.title || r.link} – ${r.reason || "vyradené"}`),
        },
      ];
      return {
        search,
        status: recentNeg.length || olderNeg.length ? "warning" : "ok",
        summary: articles.length
          ? `${articles.length} relevantných článkov za posledných ${YEARS} rokov (${aboutFirm} o firme, ${aboutPeople} o štatutároch/vlastníkoch; najnovší ${latest || "bez dátumu"}); s negatívnym obsahom za 2 roky: ${recentNeg.length}. Prehľadaných ${raw.length} výsledkov, hľadané: ${[...variants, ...people(p)].join(", ")}.`
          : raw.length
            ? `Za posledných ${YEARS} rokov sa nenašli články o firme ani o štatutároch (hľadané: ${[...variants, ...people(p)].join(", ")}; prehľadaných ${raw.length} výsledkov). Vyradené výsledky sú zobrazené nižšie.`
            : "Vyhľadávače správ nevrátili žiadne výsledky – mohli zablokovať požiadavku zo servera. Použite odkazy nižšie.",
        findings: f,
        verifyUrl: links.google,
        data: { asOf, query: quoted.join(" | ") || q, variants, articles: articles.slice(0, 25), rejected: rejected.slice(0, 30), scanned: raw.length, sources: [
            ...outlets.ok.map((n) => ({ provider: "outlet", name: n, ok: true, items: outlets.found.filter((f) => f.source === n).length })),
            ...outlets.failed.map((n) => ({ provider: "outlet", name: n, ok: false, items: 0 })),
            { provider: "ddg", ok: ddg.length > 0, items: ddg.length },
            ...results.map((r, i) => ({ provider: queries[i][1], ok: r.status === "fulfilled", items: r.status === "fulfilled" ? parseRss(r.value, queries[i][1]).length : 0 })),
          ], outletsOk: outlets.ok, outletsFailed: outlets.failed, links },
      };
    },
  );
}
