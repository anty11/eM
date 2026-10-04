import { NextResponse } from "next/server";

export const runtime = "edge";

/**
 * Načítanie stránky cez Edge runtime (iná sieť / adresy než serverové funkcie) – pre registre, ktoré blokujú adresy dátových centier
 * (justice.gov.sk vracia 403). Len pre interné volania s tokenom odvodeným zo SESSION_SECRET a len pre povolené domény.
 */
const ALLOWED = ["justice.gov.sk", "www.justice.gov.sk", "obchodnyvestnik.justice.gov.sk", "www.uvo.gov.sk", "portal.unionzp.sk", "www.vszp.sk"];

async function internalToken(): Promise<string> {
  const data = new TextEncoder().encode(`edgefetch:${process.env.SESSION_SECRET || "dev-only-secret-dev-only-secret-dev-only"}`);
  const h = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(h)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function GET(req: Request) {
  const u = new URL(req.url);
  const target = u.searchParams.get("url") || "";
  if (req.headers.get("x-internal") !== (await internalToken())) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  let t: URL;
  try {
    t = new URL(target);
  } catch {
    return NextResponse.json({ error: "bad url" }, { status: 400 });
  }
  if (!ALLOWED.includes(t.hostname)) return NextResponse.json({ error: "host not allowed" }, { status: 400 });
  const t0 = Date.now();
  try {
    const r = await fetch(t.toString(), {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36",
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "sk-SK,sk;q=0.9,en;q=0.7",
      },
      redirect: "follow",
      signal: AbortSignal.timeout(15000),
    });
    const body = await r.text();
    return NextResponse.json({ status: r.status, ms: Date.now() - t0, contentType: r.headers.get("content-type"), body: body.slice(0, 200000) });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message, ms: Date.now() - t0 }, { status: 502 });
  }
}
