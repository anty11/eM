import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { audit } from "../audit";
import { kv } from "../auth/kv";

/**
 * Nastavenie AI (LLM) pre záložné vyhľadávanie.
 * Produkcia: premenné prostredia (ANTHROPIC_API_KEY alebo OPENAI_API_KEY, AI_PROVIDER, AI_MODEL, AI_AUTO_FALLBACK).
 * Testovanie: administrátor zadá kľúč v Administrácii – uloží sa šifrovane (AES-256-GCM) do databázy.
 * Zadávanie kľúča v Administrácii je povolené lokálne a v produkcii len pri AI_ALLOW_ADMIN_KEY=1.
 */
export type Provider = "anthropic" | "openai";

export const DEFAULT_MODEL: Record<Provider, string> = {
  anthropic: "claude-sonnet-5",
  openai: "gpt-5.5",
};

export interface AiConfig {
  provider: Provider;
  model: string;
  key: string;
  /** Automaticky spustiť AI pri zlyhaní zdroja (predvolene nie – len tlačidlom). */
  auto: boolean;
  /** Ponúknuť AI aj pre registre bez API (inak len pri zlyhaní API). */
  noApiSources: boolean;
  origin: "env" | "admin";
}

interface Stored {
  provider: Provider;
  model?: string;
  keyEnc?: string;
  keyHint?: string;
  auto: boolean;
  noApiSources: boolean;
  updatedAt: string;
  updatedBy: string;
}

const KEY = "settings:ai";

export const adminKeyAllowed = () => process.env.NODE_ENV !== "production" || process.env.AI_ALLOW_ADMIN_KEY === "1";

function envConfig(): AiConfig | null {
  const provider: Provider | null =
    process.env.AI_PROVIDER === "openai" ? "openai" : process.env.AI_PROVIDER === "anthropic" ? "anthropic" : process.env.ANTHROPIC_API_KEY ? "anthropic" : process.env.OPENAI_API_KEY ? "openai" : null;
  if (!provider) return null;
  const key = provider === "anthropic" ? process.env.ANTHROPIC_API_KEY : process.env.OPENAI_API_KEY;
  if (!key) return null;
  return {
    provider,
    model: process.env.AI_MODEL || DEFAULT_MODEL[provider],
    key,
    // Predvolene VYPNUTÉ – AI sa spúšťa len tlačidlom „Overiť cez AI“ (šetrí kredit)
    auto: process.env.AI_AUTO_FALLBACK === "1",
    noApiSources: process.env.AI_NO_API_SOURCES === "1",
    origin: "env",
  };
}

function cipherKey() {
  const secret = process.env.SESSION_SECRET || "dev-only-secret-dev-only-secret-dev-only";
  return createHash("sha256").update(`ai-key:${secret}`).digest();
}
function encrypt(plain: string) {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", cipherKey(), iv);
  const enc = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return [iv, c.getAuthTag(), enc].map((b) => b.toString("base64")).join(".");
}
function decrypt(s: string) {
  const [iv, tag, enc] = s.split(".").map((x) => Buffer.from(x, "base64"));
  const d = createDecipheriv("aes-256-gcm", cipherKey(), iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(enc), d.final()]).toString("utf8");
}

export async function getAiConfig(): Promise<AiConfig | null> {
  const env = envConfig();
  if (env) return env;
  if (!adminKeyAllowed()) return null;
  const s = await kv().get<Stored>(KEY);
  if (!s?.keyEnc) return null;
  try {
    return { provider: s.provider, model: s.model || DEFAULT_MODEL[s.provider], key: decrypt(s.keyEnc), auto: s.auto, noApiSources: s.noApiSources, origin: "admin" };
  } catch {
    return null; // zmenený SESSION_SECRET – kľúč treba zadať znova
  }
}

/** Verejný stav pre Administráciu (bez kľúča). */
export async function aiStatus() {
  const env = envConfig();
  const s = await kv().get<Stored>(KEY);
  return {
    configured: Boolean(env || (adminKeyAllowed() && s?.keyEnc)),
    origin: env ? "env" : s?.keyEnc && adminKeyAllowed() ? "admin" : null,
    provider: env?.provider || s?.provider || "anthropic",
    model: env?.model || s?.model || "",
    keyHint: env ? `…${env.key.slice(-4)}` : s?.keyHint,
    auto: env ? env.auto : s?.auto ?? false,
    noApiSources: env ? env.noApiSources : s?.noApiSources ?? false,
    adminKeyAllowed: adminKeyAllowed(),
    envLocked: Boolean(env),
    updatedAt: s?.updatedAt,
    updatedBy: s?.updatedBy,
    defaults: DEFAULT_MODEL,
  };
}

export async function saveAiSettings(
  input: { provider?: string; model?: string; key?: string; clearKey?: boolean; auto?: boolean; noApiSources?: boolean },
  by: string,
) {
  if (envConfig()) throw Object.assign(new Error("AI je nastavená v premenných prostredia – zmeny robte tam."), { status: 409 });
  if (!adminKeyAllowed()) throw Object.assign(new Error("V produkcii sa kľúč zadáva len v premenných prostredia (ANTHROPIC_API_KEY / OPENAI_API_KEY)."), { status: 403 });
  const prev = (await kv().get<Stored>(KEY)) || undefined;
  const provider: Provider = input.provider === "openai" ? "openai" : "anthropic";
  const next: Stored = {
    provider,
    model: (input.model || "").trim().slice(0, 80) || undefined,
    keyEnc: prev?.keyEnc,
    keyHint: prev?.keyHint,
    auto: input.auto ?? prev?.auto ?? false,
    noApiSources: input.noApiSources ?? prev?.noApiSources ?? false,
    updatedAt: new Date().toISOString(),
    updatedBy: by,
  };
  if (prev && prev.provider !== provider && !input.key) {
    next.keyEnc = undefined; // kľúč patrí k inému poskytovateľovi
    next.keyHint = undefined;
  }
  const key = (input.key || "").trim();
  if (key) {
    if (key.length < 20 || /\s/.test(key)) throw Object.assign(new Error("Kľúč nevyzerá platne."), { status: 400 });
    next.keyEnc = encrypt(key);
    next.keyHint = `…${key.slice(-4)}`;
  }
  if (input.clearKey) {
    next.keyEnc = undefined;
    next.keyHint = undefined;
  }
  await kv().set(KEY, next);
  await audit({ type: "ai_settings", by, detail: `${provider}${next.model ? ` / ${next.model}` : ""}${key ? " · nový kľúč " + next.keyHint : ""}${input.clearKey ? " · kľúč zmazaný" : ""}` });
  return aiStatus();
}
