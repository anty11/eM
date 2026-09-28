/**
 * Podpísaný session cookie (HMAC-SHA256, Web Crypto) – funguje v proxy aj v route handleroch.
 * Obsah: e-mail, rola, verzia hesla (po zmene/resete hesla sa staré relácie zneplatnia), expirácia.
 */
export const COOKIE = "oi_session";
export const SESSION_HOURS = 12;

export interface Session {
  email: string;
  role: "admin" | "user";
  ver: number;
  exp: number;
}

const enc = new TextEncoder();

function secret(): string {
  const s = process.env.SESSION_SECRET;
  if (s && s.length >= 32) return s;
  if (process.env.NODE_ENV === "production") throw new Error("SESSION_SECRET musí mať aspoň 32 znakov.");
  return "dev-only-secret-dev-only-secret-dev-only";
}

const b64u = (buf: ArrayBuffer | Uint8Array) =>
  Buffer.from(buf instanceof Uint8Array ? buf : new Uint8Array(buf)).toString("base64url");

async function hmac(data: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", enc.encode(secret()), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return b64u(await crypto.subtle.sign("HMAC", key, enc.encode(data)));
}

export async function signSession(s: Omit<Session, "exp">): Promise<string> {
  const payload = b64u(enc.encode(JSON.stringify({ ...s, exp: Date.now() + SESSION_HOURS * 3600e3 })));
  return `${payload}.${await hmac(payload)}`;
}

function safeEqual(a: string, b: string) {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

export async function verifySession(token?: string | null): Promise<Session | null> {
  if (!token) return null;
  const [payload, sig] = token.split(".");
  if (!payload || !sig) return null;
  try {
    if (!safeEqual(sig, await hmac(payload))) return null;
    const s = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as Session;
    if (!s.exp || s.exp < Date.now()) return null;
    return s;
  } catch {
    return null;
  }
}

export function cookieOptions(maxAgeSec = SESSION_HOURS * 3600) {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    maxAge: maxAgeSec,
  };
}
