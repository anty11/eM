import { NextResponse, type NextRequest } from "next/server";
import { COOKIE, verifySession } from "./lib/auth/session";

/**
 * Celá aplikácia je za prihlásením. Proxy overí podpis relácie; úplné overenie účtu
 * (zablokovanie, zmena hesla, rola) robí každý API endpoint voči databáze.
 */
const PUBLIC = ["/login", "/api/auth/login", "/api/auth/setup", "/api/auth/logout"];

export async function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (PUBLIC.some((p) => pathname === p)) return NextResponse.next();
  const s = await verifySession(req.cookies.get(COOKIE)?.value);
  if (!s) {
    if (pathname.startsWith("/api/")) return NextResponse.json({ error: "Prihláste sa." }, { status: 401 });
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    url.search = pathname === "/" && !req.nextUrl.search ? "" : `?next=${encodeURIComponent(pathname + req.nextUrl.search)}`;
    return NextResponse.redirect(url);
  }
  if ((pathname.startsWith("/admin") || pathname.startsWith("/api/admin")) && s.role !== "admin") {
    if (pathname.startsWith("/api/")) return NextResponse.json({ error: "Len pre administrátorov." }, { status: 403 });
    return NextResponse.redirect(new URL("/", req.url));
  }
  return NextResponse.next();
}

export const config = { matcher: ["/((?!_next/static|_next/image|favicon.ico|robots.txt).*)"] };
