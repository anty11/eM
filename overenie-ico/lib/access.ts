import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { audit } from "./audit";
import { kv } from "./auth/kv";

/**
 * Prístupy k registrom, ktoré sa dajú nastaviť v Administrácii (bez nasadenia):
 *  - Proxy pre registre, ktoré blokujú adresy dátových centier (justice.gov.sk – Register diskvalifikácií vracia 403 z Vercelu aj z Edge).
 *    Dopyty servera aj prehliadač (AI agent, skripty) idú na zvolené domény cez proxy, ostatné priamo. Ideálne proxy so slovenskou
 *    (rezidenčnou) IP adresou. Tvar: http://meno:heslo@host:port (alebo socks5://…; prehliadač podporuje oboje, dopyty servera http/https).
 *  - Prístup k exportu Obchodného vestníka (MS SR po registrácii): adresa exportu + meno/heslo.
 * Heslá sa ukladajú šifrovane (AES-256-GCM, kľúč zo SESSION_SECRET) a znova sa nezobrazia. Premenné prostredia majú prednosť.
 */
export interface AccessSettings {
  proxy?: { enc?: string; hint?: string; domains?: string[]; enabled?: boolean };
  ov?: { exportUrl?: string; user?: string; passEnc?: string };
  updatedAt?: string;
  updatedBy?: string;
}
export interface ProxyConfig {
  url: string; // úplná adresa vrátane prihlásenia
  server: string; // bez prihlásenia (pre prehliadač)
  username?: string;
  password?: string;
  domains: string[];
  origin: "env" | "admin";
}

const KEY = "settings:access";
export const DEFAULT_PROXY_DOMAINS = ["justice.gov.sk", "obcan.justice.sk"];
/** Domény, ktoré idú cez proxy vždy (Register diskvalifikácií: stránka na justice.gov.sk, dáta z obcan.justice.sk). */
const withDefaults = (d: string[]) => Array.from(new Set([...d, ...DEFAULT_PROXY_DOMAINS]));

function cipherKey() {
  const secret = process.env.SESSION_SECRET || "dev-only-secret-dev-only-secret-dev-only";
  return createHash("sha256").update(`access:${secret}`).digest();
}
const encrypt = (plain: string) => {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", cipherKey(), iv);
  const enc = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return [iv, c.getAuthTag(), enc].map((b) => b.toString("base64")).join(".");
};
const decrypt = (s: string) => {
  const [iv, tag, enc] = s.split(".").map((x) => Buffer.from(x, "base64"));
  const d = createDecipheriv("aes-256-gcm", cipherKey(), iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(enc), d.final()]).toString("utf8");
};

const stored = async (): Promise<AccessSettings> => (await kv().get<AccessSettings>(KEY).catch(() => null)) || {};

const normDomains = (list: unknown): string[] =>
  [...new Set((Array.isArray(list) ? list : String(list || "").split(/[\s,;]+/)).map((d) => String(d).trim().toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/.*$/, "")).filter((d) => /^[a-z0-9.-]+\.[a-z]{2,}$/.test(d)))].slice(0, 20);

function parseProxy(url: string): Omit<ProxyConfig, "domains" | "origin"> | null {
  try {
    const u = new URL(url);
    if (!/^(https?|socks5):$/.test(u.protocol) || !u.hostname || !u.port) return null;
    return { url, server: `${u.protocol}//${u.hostname}:${u.port}`, username: u.username ? decodeURIComponent(u.username) : undefined, password: u.password ? decodeURIComponent(u.password) : undefined };
  } catch {
    return null;
  }
}

// krátka pamäť v rámci inštancie – každý dopyt by inak čítal databázu
let cache: { at: number; value: ProxyConfig | null } | null = null;

export async function getProxyConfig(): Promise<ProxyConfig | null> {
  if (cache && Date.now() - cache.at < 30000) return cache.value;
  let value: ProxyConfig | null = null;
  const env = process.env.REGISTRY_PROXY_URL;
  if (env) {
    const p = parseProxy(env);
    if (p) value = { ...p, domains: normDomains(process.env.REGISTRY_PROXY_DOMAINS || DEFAULT_PROXY_DOMAINS), origin: "env" };
  } else {
    const s = await stored();
    if (s.proxy?.enc && s.proxy.enabled !== false) {
      try {
        const p = parseProxy(decrypt(s.proxy.enc));
        if (p) value = { ...p, domains: withDefaults(s.proxy.domains || []), origin: "admin" };
      } catch {
        value = null; // zmenený SESSION_SECRET – treba zadať znova
      }
    }
  }
  cache = { at: Date.now(), value };
  return value;
}

export const hostMatches = (host: string, domains: string[]) => {
  const h = host.toLowerCase().replace(/^www\./, "");
  return domains.some((d) => h === d || h.endsWith(`.${d}`));
};

/** Proxy pre danú adresu, ak jej doména patrí medzi nastavené. */
export async function proxyFor(url: string): Promise<ProxyConfig | null> {
  let host: string;
  try {
    host = new URL(url).hostname;
  } catch {
    return null;
  }
  const p = await getProxyConfig().catch(() => null);
  return p && hostMatches(host, p.domains) ? p : null;
}

/** Prístup k exportu Obchodného vestníka: prostredie → administrácia. */
export async function getOvAccess(): Promise<{ exportUrl: string; user?: string; password?: string; origin: "env" | "admin" } | null> {
  if (process.env.OV_EXPORT_URL) return { exportUrl: process.env.OV_EXPORT_URL, user: process.env.OV_USER, password: process.env.OV_PASSWORD, origin: "env" };
  const s = await stored();
  if (!s.ov?.exportUrl) return null;
  let password: string | undefined;
  try {
    password = s.ov.passEnc ? decrypt(s.ov.passEnc) : undefined;
  } catch {
    password = undefined;
  }
  return { exportUrl: s.ov.exportUrl, user: s.ov.user, password, origin: "admin" };
}

export async function accessStatus() {
  const s = await stored();
  const p = await getProxyConfig().catch(() => null);
  const envProxy = Boolean(process.env.REGISTRY_PROXY_URL);
  return {
    proxy: {
      active: Boolean(p),
      origin: envProxy ? "env" : s.proxy?.enc ? "admin" : null,
      server: p?.server || (s.proxy?.hint ? s.proxy.hint : undefined),
      domains: p?.domains || s.proxy?.domains || DEFAULT_PROXY_DOMAINS,
      enabled: s.proxy?.enabled !== false,
      envLocked: envProxy,
    },
    ov: {
      configured: Boolean(process.env.OV_EXPORT_URL || s.ov?.exportUrl),
      origin: process.env.OV_EXPORT_URL ? "env" : s.ov?.exportUrl ? "admin" : null,
      exportUrl: process.env.OV_EXPORT_URL || s.ov?.exportUrl || "",
      user: process.env.OV_EXPORT_URL ? process.env.OV_USER || "" : s.ov?.user || "",
      hasPassword: Boolean(process.env.OV_EXPORT_URL ? process.env.OV_PASSWORD : s.ov?.passEnc),
      envLocked: Boolean(process.env.OV_EXPORT_URL),
    },
    updatedAt: s.updatedAt,
    updatedBy: s.updatedBy,
  };
}

export class AccessError extends Error {
  constructor(message: string, public status = 400) {
    super(message);
  }
}

export async function saveAccess(
  input: {
    proxy?: { url?: string; domains?: string[] | string; enabled?: boolean; clear?: boolean };
    ov?: { exportUrl?: string; user?: string; password?: string; clear?: boolean };
  },
  by: string,
) {
  const prev = await stored();
  const next: AccessSettings = { ...prev, updatedAt: new Date().toISOString(), updatedBy: by };
  const notes: string[] = [];
  if (input.proxy) {
    if (process.env.REGISTRY_PROXY_URL && (input.proxy.url || input.proxy.clear)) throw new AccessError("Proxy je nastavená v premenných prostredia (REGISTRY_PROXY_URL) – zmeny robte tam.", 409);
    const px = { ...(prev.proxy || {}) };
    if (input.proxy.clear) {
      delete px.enc;
      delete px.hint;
      notes.push("proxy zmazaná");
    }
    const url = (input.proxy.url || "").trim();
    if (url) {
      const p = parseProxy(url);
      if (!p) throw new AccessError("Adresa proxy musí mať tvar http://meno:heslo@host:port (alebo https:// / socks5://).");
      px.enc = encrypt(url);
      px.hint = p.server;
      notes.push(`proxy ${p.server}`);
    }
    if (input.proxy.domains !== undefined) {
      const d = normDomains(input.proxy.domains);
      px.domains = d.length ? d : DEFAULT_PROXY_DOMAINS;
      notes.push(`domény ${px.domains.join(", ")}`);
    }
    if (input.proxy.enabled !== undefined) px.enabled = Boolean(input.proxy.enabled);
    next.proxy = px;
  }
  if (input.ov) {
    if (process.env.OV_EXPORT_URL && (input.ov.exportUrl || input.ov.password || input.ov.clear)) throw new AccessError("Prístup k Obchodnému vestníku je v premenných prostredia (OV_EXPORT_URL) – zmeny robte tam.", 409);
    const ov = { ...(prev.ov || {}) };
    if (input.ov.clear) {
      next.ov = {};
      notes.push("prístup OV zmazaný");
    } else {
      if (input.ov.exportUrl !== undefined) {
        const u = input.ov.exportUrl.trim();
        if (u && !/^https:\/\/[^\s]+$/.test(u)) throw new AccessError("Adresa exportu musí začínať https://.");
        if (u && !/\{(date|yyyymmdd)\}/.test(u)) throw new AccessError("Adresa exportu musí obsahovať {date} alebo {yyyymmdd} (dátum vydania).");
        ov.exportUrl = u || undefined;
      }
      if (input.ov.user !== undefined) ov.user = input.ov.user.trim() || undefined;
      if (input.ov.password) ov.passEnc = encrypt(input.ov.password);
      next.ov = ov;
      notes.push("prístup OV upravený");
    }
  }
  await kv().set(KEY, next);
  cache = null;
  await audit({ type: "ai_settings", by, detail: `Prístupy k registrom: ${notes.join(" · ") || "uložené"}` });
  return accessStatus();
}
