import { NextResponse } from "next/server";
import { fetchWithTimeout } from "@/lib/http";
import { handler, requireUser } from "@/lib/auth/guard";
import { kv } from "@/lib/auth/kv";
import { runOne, scan } from "@/lib/scan";
import { aiStatus, getAiConfig } from "@/lib/ai/config";
import { pingLlm } from "@/lib/ai/llm";
import { attemptsFor, probe, PUBLIC_QUERY_IDS } from "@/lib/sources/public";
import { ovMeta } from "@/lib/sources/ov";
import { BrowserSession, browserAvailable, renderSnapshot } from "@/lib/browser/session";
import type { Ctx } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

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

/** Kľúčové adresy jednotlivých zdrojov – surová odpoveď pre dané IČO (na doladenie parserov bez prístupu k registru). */
const RAW_URLS: Record<string, (ico: string) => string[]> = {
  rpo: (ico) => [`https://api.statistics.sk/rpo/v1/search?identifier=${ico}`],
  ruz: (ico) => [`https://www.registeruz.sk/cruz-public/api/uctovne-jednotky?zmenene-od=2000-01-01&ico=${ico}`],
  fs: () => ["https://iz.opendata.financnasprava.sk/api/lists", "https://iz.opendata.financnasprava.sk/api/lists/ds_dsdd", "https://iz.opendata.financnasprava.sk/api/lists/ds_dphs"],
  "fs-debtors": (ico) => [`https://iz.opendata.financnasprava.sk/api/lists/ds_dsdd`, `https://iz.opendata.financnasprava.sk/api/data/ds_dsdd/search?page=1&column=ico&search=${ico}`],
  "fs-vat": (ico) => [`https://iz.opendata.financnasprava.sk/api/lists/ds_dphs`, `https://iz.opendata.financnasprava.sk/api/data/ds_dphs/search?page=1&column=ico&search=${ico}`],
  "fs-ids": (ico) => [`https://iz.opendata.financnasprava.sk/api/lists/ds_ids`, `https://iz.opendata.financnasprava.sk/api/data/ds_ids/search?page=1&column=ico&search=${ico}`],
  "fs-dppo": (ico) => [`https://iz.opendata.financnasprava.sk/api/lists/ds_dppo`],
  socpoist: () => ["https://www.socpoist.sk/nastroje-sluzby/zoznam-dlznikov"],
  insolvency: (ico) => [`https://replik.justice.sk/ru-verejnost-web/pages/searchKonanie.xhtml?query=${ico}`],
  rpvs: (ico) => [`https://rpvs.gov.sk/opendatav2/PartneriVerejnehoSektora?$filter=Ico eq '${ico}'`],
  news: (ico) => [`https://news.google.com/rss/search?q=%22${ico}%22&hl=sk&gl=SK&ceid=SK:sk`],
  ov: () => ["https://obchodnyvestnik.justice.gov.sk/ObchodnyVestnik/Formular/FormulareZverejnene.aspx"],
  cre: () => ["https://www.cre.sk/"],
  dovera: () => ["https://www.dovera.sk/overenia/dlznici/zoznam-dlznikov"],
};

export const GET = handler(async (req) => {
  await requireUser({ admin: true });
  const p = new URL(req.url).searchParams;
  // Diagnostika jedného registra bez API: ?source=diskv|uvo|vszp|union&ico=…&name=… – vráti všetky pokusy s výňatkami odpovedí,
  // aby sa dali doladiť adresy a rozpoznávanie výsledku bez hádania.
  const source = p.get("source");
  if (source) {
    const ico = p.get("ico") || "47244895";
    const names = (p.get("name") || "").split(";").map((n) => n.trim()).filter(Boolean);
    const t0 = Date.now();
    const result: Record<string, unknown> = { source, ico, at: new Date().toISOString() };
    // 0) prehliadač na serveri (agent AI): spustenie Chromia a snímky vstupných stránok registrov za formulárom
    if (source === "browser") {
      const avail = await browserAvailable();
      result.browser = avail;
      if (avail.ok) {
        const pages = [
          ["union", "https://portal.unionzp.sk/pub/dlznici", ["unionzp.sk"]],
          ["vszp", "https://www.vszp.sk/platitelia/platenie-poistneho/zoznam-dlznikov.html", ["vszp.sk"]],
          ["ov", "https://obchodnyvestnik.justice.gov.sk/ObchodnyVestnik/Formular/FormulareZverejnene.aspx", ["justice.gov.sk"]],
          ["diskv", `https://www.justice.gov.sk/registre/registerDiskvalifikacii/?ico=${ico}&pageNum=1&size=50`, ["justice.gov.sk"]],
        ] as const;
        const snaps: Record<string, unknown> = {};
        for (const [id, url, hosts] of pages) {
          const t1 = Date.now();
          let s: BrowserSession | null = null;
          try {
            s = await BrowserSession.open([...hosts]);
            const snap = await s.open(url);
            snaps[id] = { ms: Date.now() - t1, url: snap.url, title: snap.title, elements: snap.elements.length, tables: snap.tables.length, rendered: renderSnapshot(snap).slice(0, 6000) };
          } catch (e) {
            snaps[id] = { ms: Date.now() - t1, error: (e as Error).message.split("\n")[0] };
          } finally {
            await s?.close();
          }
        }
        result.pages = snaps;
      }
      return NextResponse.json({ ...result, ms: Date.now() - t0 });
    }
    // 1) registre bez API – všetky pokusy s formulármi, skriptmi a surovým HTML
    if ((PUBLIC_QUERY_IDS as readonly string[]).includes(source)) {
      const ctx: Ctx = { ico, profile: { ico, statutory: names.map((n) => ({ name: n, role: "štatutár" })) } as any };
      const { attempts, needles } = attemptsFor(source, ctx);
      const outcome = await probe(attempts, needles, 15000, { diag: true });
      Object.assign(result, { needles, result: outcome.result, rows: outcome.rows, attempts: outcome.attempts });
      return NextResponse.json(result);
    }
    // 2) ostatné zdroje – surová odpoveď kľúčovej adresy + skutočný výsledok kontroly
    const raw: Record<string, unknown> = {};
    const urls = RAW_URLS[source]?.(ico) || [];
    await Promise.all(
      urls.map(async (u) => {
        const t = Date.now();
        try {
          const r = await fetchWithTimeout(u, { timeoutMs: 15000, headers: source.startsWith("fs") && process.env.FS_API_KEY ? { key: process.env.FS_API_KEY, Accept: "application/json" } : { Accept: "application/json, text/html" } });
          const body = await r.text();
          raw[u] = { status: r.status, ms: Date.now() - t, contentType: r.headers.get("content-type"), body: body.slice(0, 2500) };
        } catch (e) {
          raw[u] = { error: (e as Error).message, ms: Date.now() - t };
        }
      }),
    );
    result.raw = raw;
    if (source === "ov") result.index = await ovMeta().catch((e) => ({ error: (e as Error).message }));
    if (source === "fs") result.fsKeyConfigured = Boolean(process.env.FS_API_KEY);
    if (["fs", "cre", "dovera"].includes(source)) {
      result.ms = Date.now() - t0;
      return NextResponse.json(result);
    }
    try {
      // profil z RPO (meno, DIČ) – závislé zdroje ho potrebujú
      const profile: Record<string, unknown> = { ico };
      if (source !== "rpo") {
        const r = await runOne(ico, "rpo", {});
        if (r) Object.assign(profile, r.profile);
        if (["fs-debtors", "fs-vat", "fs-ids", "fs-dppo"].includes(source)) {
          const z = await runOne(ico, "ruz", profile as any).catch(() => null);
          if (z?.profile?.dic) profile.dic = z.profile.dic;
        }
      }
      const r = await runOne(ico, source, profile as any);
      if (!r) return NextResponse.json({ ...result, error: `Neznámy zdroj: ${source}` }, { status: 400 });
      const c = r.check;
      const data = c.data ? JSON.parse(JSON.stringify(c.data)) : undefined;
      result.check = { id: c.id, status: c.status, summary: c.summary, findings: c.findings, verifyUrl: c.verifyUrl, durationMs: c.durationMs, data: data && JSON.stringify(data).length > 6000 ? { truncated: JSON.stringify(data).slice(0, 6000) } : data };
      result.profile = { name: r.profile.name, dic: r.profile.dic, icDph: r.profile.icDph, established: r.profile.established, legalForm: r.profile.legalForm, statutory: r.profile.statutory?.length };
    } catch (e) {
      result.check = { error: (e as Error).message };
    }
    result.ms = Date.now() - t0;
    return NextResponse.json(result);
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
