import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { COOKIE, cookieOptions, signSession, verifySession } from "./session";
import { AuthError, ensureMigrated, getUser, type User } from "./users";
import { getOrg, type Org } from "../orgs";

/** Prihlásený používateľ aj s jeho firmou (správca platformy firmu nemá – `org` je null). */
export type Actor = User & { org: Org | null };

/** Overí reláciu voči databáze: účet existuje, nie je zablokovaný, heslo sa odvtedy nezmenilo a firma nie je pozastavená. */
export async function currentUser(): Promise<Actor | null> {
  const jar = await cookies();
  const s = await verifySession(jar.get(COOKIE)?.value);
  if (!s) return null;
  await ensureMigrated();
  const u = await getUser(s.email);
  if (!u || u.disabled || !u.passwordHash || u.pwVer !== s.ver) return null;
  if (u.role !== "admin" && !u.orgId) return null; // používateľ bez firmy nemá kam patriť
  const org = u.orgId ? await getOrg(u.orgId) : null;
  if (u.orgId && (!org || org.disabled)) return null;
  return { ...u, org };
}

export async function requireUser(opts: { admin?: boolean } = {}): Promise<Actor> {
  const u = await currentUser();
  if (!u) throw new AuthError("Prihláste sa.", 401);
  if (opts.admin && u.role !== "admin") throw new AuthError("Len pre správcov platformy.", 403);
  return u;
}

/**
 * Firma, s ktorej dátami používateľ pracuje: používateľ firmy vždy len vlastná; správca platformy musí firmu určiť (`?org=`),
 * inak chyba – nikdy sa „nespadne“ do cudzej firmy.
 */
export function orgScope(me: Actor, requested?: string | null): string {
  if (me.role !== "admin") {
    if (!me.orgId) throw new AuthError("Účet nie je priradený k žiadnej firme.", 403);
    return me.orgId;
  }
  const r = (requested || "").trim();
  if (!r) throw new AuthError("Správca platformy musí zvoliť firmu.", 400);
  return r;
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
