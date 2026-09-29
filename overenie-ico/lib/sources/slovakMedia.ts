import { fold, getText } from "../http";

/**
 * Priame vyhľadávanie v slovenských médiách (bez Google). Každý web má vlastné vyhľadávanie;
 * z výsledkovej stránky sa vyberú odkazy na články, v ktorých sa (v titulku alebo adrese) uvádza hľadané meno.
 * Weby, ktoré výsledky vykresľujú až v prehliadači (JavaScript), nevrátia nič – vtedy ich doplní vyhľadávač.
 */
export interface Outlet {
  name: string;
  domain: string;
  /** Adresa vyhľadávania; {q} sa nahradí hľadaným výrazom. */
  search: string;
}

export const OUTLETS: Outlet[] = [
  { name: "SME", domain: "sme.sk", search: "https://www.sme.sk/search?q={q}" },
  { name: "Denník N", domain: "dennikn.sk", search: "https://dennikn.sk/?s={q}" },
  { name: "Hospodárske noviny", domain: "hnonline.sk", search: "https://hnonline.sk/vyhladavanie?q={q}" },
  { name: "Pravda", domain: "pravda.sk", search: "https://www.pravda.sk/vyhladavanie/?q={q}" },
  { name: "TREND", domain: "trend.sk", search: "https://www.trend.sk/vyhladavanie?q={q}" },
  { name: "Aktuality", domain: "aktuality.sk", search: "https://www.aktuality.sk/vyhladavanie/?q={q}" },
  { name: "TASR / Teraz", domain: "teraz.sk", search: "https://www.teraz.sk/vyhladavanie/?q={q}" },
  { name: "Forbes", domain: "forbes.sk", search: "https://www.forbes.sk/?s={q}" },
  { name: "epravo", domain: "epravo.sk", search: "https://www.epravo.sk/vyhladavanie?q={q}" },
  { name: "Právne noviny", domain: "pravnenoviny.sk", search: "https://www.pravnenoviny.sk/?s={q}" },
  { name: "Webnoviny", domain: "webnoviny.sk", search: "https://www.webnoviny.sk/?s={q}" },
  { name: "Startitup", domain: "startitup.sk", search: "https://www.startitup.sk/?s={q}" },
  { name: "TA3", domain: "ta3.com", search: "https://www.ta3.com/vyhladavanie?q={q}" },
  { name: "Nový Čas", domain: "cas.sk", search: "https://www.cas.sk/vyhladavanie/?q={q}" },
  { name: "Postoj", domain: "postoj.sk", search: "https://www.postoj.sk/vyhladavanie?q={q}" },
  { name: "Finreport", domain: "finreport.sk", search: "https://www.finreport.sk/?s={q}" },
];

/** Domény spravodajských / odborných webov – používajú sa aj na filtrovanie výsledkov vyhľadávačov. */
export const NEWS_DOMAINS = [
  ...OUTLETS.map((o) => o.domain),
  "tvnoviny.sk", "noviny.sk", "refresher.sk", "plus7dni.sk", "topky.sk", "markiza.sk", "rtvs.sk", "stvr.sk", "trend.sk", "etrend.sk",
  "e-pravo.sk", "najpravo.sk", "lexforum.sk", "bulletinadvokacie.sk", "podnikajte.sk", "finweb.hnonline.sk", "index.sme.sk", "ekonomika.sme.sk",
  "e15.cz", "hn.cz", "idnes.cz", "novinky.cz", "seznamzpravy.cz", "denik.cz",
];

export interface Found {
  title: string;
  link: string;
  source: string;
  domain: string;
  date?: string;
  snippet?: string;
}

const compact = (s: string) => fold(s).replace(/[^a-z0-9&]/g, "");
const decodeEnt = (s: string) =>
  s.replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&nbsp;/g, " ").replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n));

/** Z HTML výsledkovej stránky vyberie odkazy na články, ktoré (v texte alebo v adrese) obsahujú niektorý variant mena. */
export function extractArticles(html: string, outlet: Outlet, variants: string[]): Found[] {
  const keys = variants.map(compact).filter((v) => v.length >= 5);
  if (!keys.length) return [];
  const out: Found[] = [];
  const seen = new Set<string>();
  const re = /<a\b([^>]*?)href="([^"#]+)"([^>]*)>([\s\S]*?)<\/a>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    let href = decodeEnt(m[2]);
    if (href.startsWith("/")) href = `https://www.${outlet.domain}${href}`;
    if (!/^https?:\/\//.test(href)) continue;
    let host = "";
    try {
      host = new URL(href).hostname.replace(/^www\./, "");
    } catch {
      continue;
    }
    if (!host.endsWith(outlet.domain)) continue;
    const text = decodeEnt(m[4].replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
    if (text.length < 15 || text.length > 220) continue;
    const path = new URL(href).pathname;
    if (path === "/" || /\/(tag|autor|author|kategoria|category|rubrika|vyhladavanie|search|login|prihlasenie)\b/i.test(path)) continue;
    const hay = compact(text) + " " + compact(path);
    if (!keys.some((k) => hay.includes(k))) continue;
    const key = href.replace(/[?#].*$/, "");
    if (seen.has(key)) continue;
    seen.add(key);
    // dátum v okolí odkazu (<time datetime="…"> alebo dd.mm.yyyy)
    const around = html.slice(Math.max(0, m.index - 800), m.index + m[0].length + 800);
    const dt = around.match(/datetime="(\d{4}-\d{2}-\d{2})/) || around.match(/(\d{1,2})\.\s?(\d{1,2})\.\s?(\d{4})/);
    let date: string | undefined;
    if (dt) date = dt.length === 2 ? dt[1] : `${dt[3]}-${dt[2].padStart(2, "0")}-${dt[1].padStart(2, "0")}`;
    // dátum aj z adresy (/2025/03/12/…)
    if (!date) {
      const u = path.match(/\/(20\d{2})\/(\d{1,2})\/(\d{1,2})\//) || path.match(/\/(20\d{2})(\d{2})(\d{2})/);
      if (u) date = `${u[1]}-${u[2].padStart(2, "0")}-${u[3].padStart(2, "0")}`;
    }
    out.push({ title: text, link: key, source: outlet.name, domain: host, date });
    if (out.length >= 15) break;
  }
  return out;
}

/** Prehľadá všetky médiá súčasne (každé najviac 8 s). */
export async function searchOutlets(variants: string[], timeoutMs = 8000): Promise<{ found: Found[]; ok: string[]; failed: string[] }> {
  const q = encodeURIComponent(`"${variants[0]}"`);
  const ok: string[] = [];
  const failed: string[] = [];
  const results = await Promise.all(
    OUTLETS.map(async (o) => {
      try {
        const html = await getText(o.search.replace("{q}", q), { timeoutMs });
        ok.push(o.name);
        return extractArticles(html, o, variants);
      } catch {
        failed.push(o.name);
        return [] as Found[];
      }
    }),
  );
  return { found: results.flat(), ok, failed };
}

/** DuckDuckGo (HTML verzia, bez JavaScriptu) – doplnkový index obmedzený na spravodajské domény. */
export async function searchDuckDuckGo(variants: string[], timeoutMs = 8000): Promise<Found[]> {
  const q = `"${variants[0]}"${variants[1] ? ` OR "${variants[1]}"` : ""}`;
  const html = await getText(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(q)}&kl=sk-sk`, { timeoutMs });
  const out: Found[] = [];
  const re = /<a[^>]+class="result__a"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?(?:<a[^>]+class="result__snippet"[^>]*>([\s\S]*?)<\/a>)?/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    let href = decodeEnt(m[1]);
    const u = href.match(/[?&]uddg=([^&]+)/);
    if (u) href = decodeURIComponent(u[1]);
    let host = "";
    try {
      host = new URL(href).hostname.replace(/^www\./, "");
    } catch {
      continue;
    }
    if (!NEWS_DOMAINS.some((d) => host === d || host.endsWith(`.${d}`))) continue;
    const title = decodeEnt(m[2].replace(/<[^>]+>/g, "")).trim();
    const snippet = m[3] ? decodeEnt(m[3].replace(/<[^>]+>/g, "")).trim() : undefined;
    out.push({ title, link: href, source: OUTLETS.find((o) => host.endsWith(o.domain))?.name || host, domain: host, snippet });
    if (out.length >= 30) break;
  }
  return out;
}
