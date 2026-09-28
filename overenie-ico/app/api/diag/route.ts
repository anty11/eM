import { NextResponse } from "next/server";
import { fetchWithTimeout } from "@/lib/http";
import { handler, requireUser } from "@/lib/auth/guard";
import { kv } from "@/lib/auth/kv";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Diagnostika po nasadení: overí dostupnosť každého zdroja zo servera. */
const TARGETS: Record<string, string> = {
  rpo: "https://api.statistics.sk/rpo/v1/search?identifier=35757442",
  ruz: "https://www.registeruz.sk/cruz-public/api/uctovne-jednotky?zmenene-od=2000-01-01&ico=35757442",
  fs: "https://iz.opendata.financnasprava.sk/api/lists",
  socpoist: "https://www.socpoist.sk/nastroje-sluzby/zoznam-dlznikov",
  replik: "https://replik.justice.sk/ru-verejnost-web/",
  rpvs: "https://rpvs.gov.sk/opendatav2/PartneriVerejnehoSektora?$top=1",
  news: "https://news.google.com/rss/search?q=Slovensko&hl=sk&gl=SK&ceid=SK:sk",
};

export const GET = handler(async () => {
  await requireUser({ admin: true });
  const out: Record<string, unknown> = {
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
          headers: k === "fs" && process.env.FS_API_KEY ? { key: process.env.FS_API_KEY } : {},
        });
        out[k] = { status: r.status, ms: Date.now() - t0 };
      } catch (e) {
        out[k] = { error: (e as Error).message, ms: Date.now() - t0 };
      }
    }),
  );
  return NextResponse.json(out);
});
