import { NextResponse } from "next/server";
import { getProxyConfig } from "@/lib/access";
import { handler, requireUser } from "@/lib/auth/guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Test proxy: výstupná IP adresa a krajina (ipinfo.io cez proxy) a dopyt do Registra diskvalifikácií cez proxy –
 * či justice.gov.sk odpovedá (200) namiesto 403.
 */
export const POST = handler(async () => {
  await requireUser({ admin: true });
  const px = await getProxyConfig();
  if (!px) return NextResponse.json({ ok: false, error: "Proxy nie je nastavená alebo je vypnutá." }, { status: 409 });
  if (!/^https?:/.test(px.url)) return NextResponse.json({ ok: false, error: "Test servera podporuje len http/https proxy (socks5 použije len prehliadač)." }, { status: 400 });
  const { fetch: uf, ProxyAgent } = await import("undici");
  const dispatcher = new ProxyAgent(px.url);
  const timed = async (url: string) => {
    const t0 = Date.now();
    try {
      const r = await uf(url, { dispatcher, signal: AbortSignal.timeout(15000), headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36", "Accept-Language": "sk" } });
      const body = await r.text();
      return { status: r.status, ms: Date.now() - t0, body: body.slice(0, 4000) };
    } catch (e) {
      return { status: 0, ms: Date.now() - t0, error: ((e as Error).cause as Error)?.message || (e as Error).message };
    }
  };
  const ip = await timed("https://ipinfo.io/json");
  let exit: { ip?: string; country?: string; org?: string } = {};
  try {
    exit = JSON.parse(ip.body || "{}");
  } catch {
    /* nie JSON */
  }
  const diskv = await timed("https://www.justice.gov.sk/registre/registerDiskvalifikacii/?pageNum=1&size=10");
  const blocked = diskv.status === 403 || /403 Forbidden/i.test(diskv.body || "");
  return NextResponse.json({
    ok: diskv.status === 200 && !blocked,
    proxy: px.server,
    domains: px.domains,
    exitIp: exit.ip,
    exitCountry: exit.country,
    exitOrg: exit.org,
    ipError: ip.error,
    diskv: { status: diskv.status, ms: diskv.ms, blocked, error: diskv.error, title: (diskv.body || "").match(/<title>([^<]*)/i)?.[1]?.trim() },
  });
});
