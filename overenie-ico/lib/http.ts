const UA =
  "Mozilla/5.0 (compatible; OverenieICO/1.0; +preverenie obchodneho partnera)";

export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export async function fetchWithTimeout(
  url: string,
  init: RequestInit & { timeoutMs?: number } = {},
): Promise<Response> {
  const { timeoutMs = 15000, ...rest } = init;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(url, {
      ...rest,
      signal: ctrl.signal,
      headers: { "User-Agent": UA, "Accept-Language": "sk,en;q=0.8", ...(rest.headers || {}) },
      cache: "no-store",
    });
  } catch (e) {
    if ((e as Error).name === "AbortError") throw new Error(`Časový limit vypršal (${timeoutMs / 1000}s)`);
    throw e;
  } finally {
    clearTimeout(t);
  }
}

export async function getJson<T = any>(url: string, init: RequestInit & { timeoutMs?: number } = {}): Promise<T> {
  const res = await fetchWithTimeout(url, { ...init, headers: { Accept: "application/json", ...(init.headers || {}) } });
  if (!res.ok) throw new HttpError(res.status, `HTTP ${res.status} z ${new URL(url).host}`);
  return (await res.json()) as T;
}

export async function getText(url: string, init: RequestInit & { timeoutMs?: number } = {}): Promise<string> {
  const res = await fetchWithTimeout(url, init);
  if (!res.ok) throw new HttpError(res.status, `HTTP ${res.status} z ${new URL(url).host}`);
  return await res.text();
}

/** Jednoduchá pamäťová cache (v rámci jednej inštancie servera). */
const memo = new Map<string, { exp: number; value: unknown }>();
export async function cached<T>(key: string, ttlMs: number, fn: () => Promise<T>): Promise<T> {
  const hit = memo.get(key);
  if (hit && hit.exp > Date.now()) return hit.value as T;
  const value = await fn();
  memo.set(key, { exp: Date.now() + ttlMs, value });
  return value;
}

export function stripHtml(s: string): string {
  return s
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
}

/** Odstráni diakritiku a zníži písmená – na porovnávanie textov. */
export function fold(s: string): string {
  return (s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}
