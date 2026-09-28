import { runCheck } from "../check";
import { fold, getText } from "../http";
import type { CheckResult, Ctx, Finding } from "../types";

const NEGATIVE = [
  "podvod", "obvin", "stihan", "naka", "polici", "zatkn", "zadrzan", "vysetr", "konkurz", "exeku", "insolven",
  "upadok", "dlh", "dlzni", "pokut", "sankci", "kartel", "korupc", "uplat", "danov", "karusel", "unik", "sud ",
  "zalob", "likvidac", "krach", "nezaplat", "neplat", "sprenevery", "prania spinavych", "kauza", "skandal", "prepust",
];

export interface Article {
  title: string;
  link: string;
  source?: string;
  date?: string;
  negative: string[];
}

/** Skráti obchodné meno na hľadaný výraz (bez právnej formy). */
export function searchName(name: string): string {
  return name
    .replace(/,?\s*(spol\.\s*s\s*r\.\s*o\.|s\.\s*r\.\s*o\.|a\.\s*s\.|k\.\s*s\.|v\.\s*o\.\s*s\.|s\.\s*e\.|družstvo|advokátska kancelária|v likvidácii|v konkurze).*$/i, "")
    .replace(/[,\s]+$/, "")
    .trim();
}

const decode = (s: string) =>
  s.replace(/<!\[CDATA\[|\]\]>/g, "").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").trim();

function parseRss(xml: string): Omit<Article, "negative">[] {
  const items = xml.match(/<item>[\s\S]*?<\/item>/g) || [];
  return items.map((it) => {
    const g = (tag: string) => decode((it.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`)) || [])[1] || "");
    return { title: g("title"), link: g("link"), source: g("source"), date: g("pubDate") };
  });
}

export async function checkNews(ctx: Ctx): Promise<CheckResult> {
  return runCheck(
    {
      id: "news",
      category: "media",
      name: "Médiá a internet (PR, správy)",
      source: "Google News (sk) + odkazy na verejné databázy",
      sourceUrl: "https://news.google.com",
    },
    async () => {
      const q = ctx.profile.name ? `"${searchName(ctx.profile.name)}"` : `"${ctx.ico}"`;
      const links = {
        google: `https://www.google.com/search?q=${encodeURIComponent(`${q} OR "${ctx.ico}"`)}`,
        googleNegative: `https://www.google.com/search?q=${encodeURIComponent(`${q} (podvod OR exekúcia OR konkurz OR súd OR polícia OR dlh)`)}`,
        finstat: `https://finstat.sk/${ctx.ico}`,
        indexPodnikatela: `https://www.indexpodnikatela.sk/${ctx.ico}`,
        foaf: `https://www.foaf.sk/firmy/${ctx.ico}`,
        crz: `https://www.crz.gov.sk/zmluvy/?art_ico=${ctx.ico}`,
      };
      const rss = await getText(`https://news.google.com/rss/search?q=${encodeURIComponent(q)}&hl=sk&gl=SK&ceid=SK:sk`, { timeoutMs: 12000 });
      const twoYears = Date.now() - 2 * 365 * 864e5;
      const articles: Article[] = parseRss(rss)
        .slice(0, 40)
        .map((a) => {
          const t = fold(a.title) + " ";
          return { ...a, negative: NEGATIVE.filter((k) => t.includes(k)) };
        });
      const recentNeg = articles.filter((a) => a.negative.length && (!a.date || +new Date(a.date) > twoYears));
      const f: Finding[] = [];
      if (recentNeg.length >= 3)
        f.push({ severity: "warning", text: `${recentNeg.length} mediálnych správ s potenciálne negatívnym obsahom za 2 roky – preverte`, penalty: 10 });
      else if (recentNeg.length > 0)
        f.push({ severity: "warning", text: `${recentNeg.length} mediálna správa s potenciálne negatívnym obsahom – preverte kontext`, penalty: 3 });
      return {
        status: recentNeg.length ? "warning" : "ok",
        summary: articles.length
          ? `Nájdených ${articles.length} článkov pre ${q}; potenciálne negatívnych za 2 roky: ${recentNeg.length}. Pozor na zhodu mien s inými subjektmi.`
          : `K výrazu ${q} sa v správach nenašli články.`,
        findings: f,
        verifyUrl: links.googleNegative,
        data: { query: q, articles: articles.slice(0, 15), links },
      };
    },
  );
}
