import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { COOKIE, cookieOptions, signSession, verifySession } from "./session";
import { AuthError, getUser, type User } from "./users";

/** Overí reláciu voči databáze: účet existuje, nie je zablokovaný a heslo sa odvtedy nezmenilo. */
export async function currentUser(): Promise<User | null> {
  const jar = await cookies();
  const s = await verifySession(jar.get(COOKIE)?.value);
  if (!s) return null;
  const u = await getUser(s.email);
  if (!u || u.disabled || !u.passwordHash || u.pwVer !== s.ver) return null;
  return u;
}

export async function requireUser(opts: { admin?: boolean } = {}): Promise<User> {
  const u = await currentUser();
  if (!u) throw new AuthError("Prihláste sa.", 401);
  if (opts.admin && u.role !== "admin") throw new AuthError("Len pre administrátorov.", 403);
  return u;
}

export async function startSession(res: NextResponse, u: User) {
  res.cookies.set(COOKIE, await signSession({ email: u.email, role: u.role, ver: u.pwVer }), cookieOptions());
  return res;
}

export function endSession(res: NextResponse) {
  res.cookies.set(COOKIE, "", cookieOptions(0));
  return res;
}

export function clientIp(req: Request): string {
  return (req.headers.get("x-forwarded-for") || "").split(",")[0].trim() || req.headers.get("x-real-ip") || "unknown";
}

/** Ochrana proti CSRF pre POST: požiadavka musí prísť z rovnakého pôvodu. */
export function sameOrigin(req: Request) {
  const origin = req.headers.get("origin");
  if (!origin) return;
  const host = req.headers.get("x-forwarded-host") || req.headers.get("host");
  if (new URL(origin).host !== host) throw new AuthError("Neplatný pôvod požiadavky.", 403);
}

/** Obal pre route handlery – jednotné JSON chyby. */
export function handler<A extends unknown[]>(fn: (req: Request, ...a: A) => Promise<Response>) {
  return async (req: Request, ...a: A) => {
    try {
      if (req.method !== "GET") sameOrigin(req);
      return await fn(req, ...a);
    } catch (e) {
      if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status });
      if (typeof (e as any)?.status === "number") return NextResponse.json({ error: (e as Error).message }, { status: (e as any).status });
      console.error(e);
      return NextResponse.json({ error: (e as Error).message || "Chyba servera" }, { status: 500 });
    }
  };
}
