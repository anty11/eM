import { NextResponse } from "next/server";
import { fetchWithTimeout } from "@/lib/http";
import { handler, requireUser } from "@/lib/auth/guard";
import { kv } from "@/lib/auth/kv";
import { scan } from "@/lib/scan";
import { aiStatus, getAiConfig } from "@/lib/ai/config";
import { pingLlm } from "@/lib/ai/llm";
import { attemptsFor, probe, PUBLIC_QUERY_IDS } from "@/lib/sources/public";
import { ovMeta } from "@/lib/sources/ov";
import type { Ctx } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Diagnostika po nasadení: overí dostupnosť každého zdroja zo servera. */
const TARGETS: Record<string, string> = {
  rpo: "https://api.statistics.sk/rpo/v1/search?identifier=35757442",
  ruz: "https://www.registeruz.sk/cruz-public/api/uctovne-jednotky?zmenene-od=2000-01-01&ico=35757442",
  fs: "https://iz.opendata.financnasprava.sk/api/lists",
  "fs-list-detail": "https://iz.opendata.financnasprava.sk/api/lists/ds_dsdd",
  diskv: "https://www.justice.gov.sk/registre/registerDiskvalifikacii/?pageNum=1&size=10",
  uvo: "https://www.uvo.gov.sk/zaujemca-uchadzac/registre-o-hospodarskych-subjektoch/register-osob-so-zakazom",
  vszp: "https://www.vszp.sk/platitelia/platenie-poistneho/zoznam-dlznikov.html",
  union: "https://portal.unionzp.sk/pub/dlznici",
  socpoist: "https://www.socpoist.sk/nastroje-sluzby/zoznam-dlznikov",
  replik: "https://replik.justice.sk/ru-verejnost-web/",
  rpvs: "https://rpvs.gov.sk/opendatav2/PartneriVerejnehoSektora?$top=1",
  news: "https://news.google.com/rss/search?q=Slovensko&hl=sk&gl=SK&ceid=SK:sk",
};

export const GET = handler(async (req) => {
  await requireUser({ admin: true });
  const p = new URL(req.url).searchParams;
  // Diagnostika jedného registra bez API: ?source=diskv|uvo|vszp|union&ico=…&name=… – vráti všetky pokusy s výňatkami odpovedí,
  // aby sa dali doladiť adresy a rozpoznávanie výsledku bez hádania.
  const source = p.get("source");
  if (source) {
    if (!(PUBLIC_QUERY_IDS as readonly string[]).includes(source)) return NextResponse.json({ error: `Neznámy zdroj; dostupné: ${PUBLIC_QUERY_IDS.join(", ")}` }, { status: 400 });
    const ico = p.get("ico") || "47244895";
    const ctx: Ctx = { ico, profile: { ico, statutory: (p.get("name") || "").split(";").filter(Boolean).map((n) => ({ name: n.trim(), role: "štatutár" })) } as any };
    const { attempts, needles } = attemptsFor(source, ctx);
    const outcome = await probe(attempts, needles, 15000);
    return NextResponse.json({ source, ico, needles, result: outcome.result, rows: outcome.rows, attempts: outcome.attempts });
  }
  const out: Record<string, unknown> = {
    ovIndex: await ovMeta().catch(() => null),
    ovConfigured: Boolean(process.env.OV_EXPORT_URL),
    fsKeyConfigured: Boolean(process.env.FS_API_KEY),
    sessionSecretConfigured: (process.env.SESSION_SECRET || "").length >= 32,
  };
  try {
    await kv().set("diag:ping", Date.now(), 60);
    out.database = "ok";
  } catch (e) {
    out.database = (e as Error).message;
  }
  await Promise.all(
    Object.entries(TARGETS).map(async ([k, url]) => {
      const t0 = Date.now();
      try {
        const r = await fetchWithTimeout(url, {
          timeoutMs: 12000,
          headers: k.startsWith("fs") && process.env.FS_API_KEY ? { key: process.env.FS_API_KEY } : {},
        });
        // pri detaile zoznamu FS vrátime aj telo – ukáže presný tvar odpovede (prehľadávateľné stĺpce)
        out[k] = k === "fs-list-detail" ? { status: r.status, ms: Date.now() - t0, body: (await r.text()).slice(0, 1500) } : { status: r.status, ms: Date.now() - t0 };
      } catch (e) {
        out[k] = { error: (e as Error).message, ms: Date.now() - t0 };
      }
    }),
  );
  // Skutočné preverenie testovacieho IČO – ukáže presný výsledok a chybu každého zdroja
  const ico = new URL(req.url).searchParams.get("ico") || "47244895";
  try {
    const r = await scan(ico);
    out.scan = r.checks.map((c) => ({ id: c.id, status: c.status, ms: c.durationMs, summary: c.summary.slice(0, 300) }));
    const news = r.checks.find((c) => c.id === "news")?.data as any;
    if (news) out.news = { query: news.query, variants: news.variants, sources: news.sources, articles: news.articles, rejected: news.rejected };
  } catch (e) {
    out.scan = `chyba: ${(e as Error).message}`;
  }
  try {
    const a = await aiStatus();
    out.ai = { configured: a.configured, provider: a.provider, model: a.model || a.defaults[a.provider], origin: a.origin };
    const cfg = await getAiConfig();
    if (cfg) {
      const t0 = Date.now();
      out.aiPing = await pingLlm(cfg).then((r) => ({ ok: true, reply: r, ms: Date.now() - t0 })).catch((e) => ({ ok: false, error: (e as Error).message }));
    }
  } catch (e) {
    out.ai = (e as Error).message;
  }
  return NextResponse.json(out);
});
