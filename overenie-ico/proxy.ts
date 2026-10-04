import { NextResponse, type NextRequest } from "next/server";
import { COOKIE, verifySession } from "./lib/auth/session";

/**
 * Verejný je len prezentačný web (/, /objednavka, právne informácie) a prihlásenie; klientska sekcia (/app, /account, /admin)
 * a všetky API sú za prihlásením. Proxy overí podpis relácie; úplné overenie účtu
 * (zablokovanie, zmena hesla, rola) robí každý API endpoint voči databáze.
 */
const PUBLIC = ["/", "/api/edgefetch", "/overit", "/obchodne-podmienky", "/ochrana-osobnych-udajov", "/spracovanie-udajov", "/cookies", "/pravne-upozornenie", "/objednavka", "/pravny-zaklad", "/co-overujeme", "/ako-to-funguje", "/pre-koho", "/login", "/api/auth/login", "/api/auth/setup", "/api/auth/logout", "/api/order", "/api/cron/socpoist"];

export async function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (PUBLIC.some((p) => pathname === p) || pathname.startsWith("/overit/")) return NextResponse.next();
  const s = await verifySession(req.cookies.get(COOKIE)?.value);
  if (!s) {
    if (pathname.startsWith("/api/")) return NextResponse.json({ error: "Prihláste sa." }, { status: 401 });
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    url.search = pathname === "/app" && !req.nextUrl.search ? "" : `?next=${encodeURIComponent(pathname + req.nextUrl.search)}`;
    return NextResponse.redirect(url);
  }
  if ((pathname.startsWith("/admin") || pathname.startsWith("/api/admin")) && s.role !== "admin") {
    if (pathname.startsWith("/api/")) return NextResponse.json({ error: "Len pre administrátorov." }, { status: 403 });
    return NextResponse.redirect(new URL("/app", req.url));
  }
  return NextResponse.next();
}

export const config = { matcher: ["/((?!_next/static|_next/image|favicon.ico|robots.txt).*)"] };
