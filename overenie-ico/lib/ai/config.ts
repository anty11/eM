import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { audit } from "../audit";
import { kv } from "../auth/kv";

/**
 * Nastavenie AI (LLM) pre záložné vyhľadávanie – dvaja poskytovatelia (Claude / OpenAI), medzi ktorými správca platformy prepína.
 *  - Kľúče: z premenných prostredia (ANTHROPIC_API_KEY, OPENAI_API_KEY) alebo – lokálne / pri AI_ALLOW_ADMIN_KEY=1 – zadané v Administrácii
 *    a uložené šifrovane (AES-256-GCM) pre každého poskytovateľa zvlášť; prepnutie poskytovateľa druhý kľúč nezmaže.
 *  - Aktívny poskytovateľ: voľba správcu (uložená v databáze) → AI_PROVIDER z prostredia → ten, ktorý má kľúč (prednosť Claude).
 *    Prepínať možno vždy, aj keď sú kľúče v prostredí.
 *  - Model na poskytovateľa: voľba správcu → AI_MODEL (len pre poskytovateľa z prostredia) → predvolený.
 */
export type Provider = "anthropic" | "openai";
export const PROVIDERS: Provider[] = ["anthropic", "openai"];
export const PROVIDER_LABEL: Record<Provider, string> = { anthropic: "Claude (Anthropic)", openai: "OpenAI" };

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

interface StoredKey {
  enc: string;
  hint: string;
}
interface Stored {
  /** Aktívny poskytovateľ zvolený správcom */
  provider?: Provider;
  /** Model na poskytovateľa (prázdne = predvolený) */
  models?: Partial<Record<Provider, string>>;
  /** Kľúče zadané v Administrácii, na poskytovateľa */
  keys?: Partial<Record<Provider, StoredKey>>;
  auto?: boolean;
  noApiSources?: boolean;
  updatedAt: string;
  updatedBy: string;
  // staršie polia (do v2.1) – prevezmú sa pri prvom čítaní
  model?: string;
  keyEnc?: string;
  keyHint?: string;
}

const KEY = "settings:ai";

export const adminKeyAllowed = () => process.env.NODE_ENV !== "production" || process.env.AI_ALLOW_ADMIN_KEY === "1";

const envKey = (p: Provider) => (p === "anthropic" ? process.env.ANTHROPIC_API_KEY : process.env.OPENAI_API_KEY) || "";
const envProvider = (): Provider | null => (process.env.AI_PROVIDER === "openai" ? "openai" : process.env.AI_PROVIDER === "anthropic" ? "anthropic" : null);

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

async function stored(): Promise<Stored> {
  const s = (await kv().get<Stored>(KEY)) || { updatedAt: "", updatedBy: "" };
  // prevod staršieho tvaru (jeden kľúč) na kľúče podľa poskytovateľa
  if (s.keyEnc && s.provider && !s.keys?.[s.provider]) s.keys = { ...(s.keys || {}), [s.provider]: { enc: s.keyEnc, hint: s.keyHint || "" } };
  if (s.model && s.provider && !s.models?.[s.provider]) s.models = { ...(s.models || {}), [s.provider]: s.model };
  return s;
}

/** Kľúč poskytovateľa a jeho pôvod – prostredie má prednosť; kľúč z administrácie len kde je to dovolené. */
function keyFor(p: Provider, s: Stored): { key: string; origin: "env" | "admin" } | null {
  const e = envKey(p);
  if (e) return { key: e, origin: "env" };
  const k = s.keys?.[p];
  if (k?.enc && adminKeyAllowed()) {
    try {
      return { key: decrypt(k.enc), origin: "admin" };
    } catch {
      return null; // zmenený SESSION_SECRET – kľúč treba zadať znova
    }
  }
  return null;
}

function modelFor(p: Provider, s: Stored): string {
  return s.models?.[p] || (envProvider() === p || (!envProvider() && envKey(p)) ? process.env.AI_MODEL : "") || DEFAULT_MODEL[p];
}

function activeProvider(s: Stored): Provider | null {
  const candidates = [s.provider, envProvider(), ...PROVIDERS].filter(Boolean) as Provider[];
  for (const p of candidates) if (keyFor(p, s)) return p;
  return null;
}

export async function getAiConfig(): Promise<AiConfig | null> {
  const s = await stored();
  const p = activeProvider(s);
  if (!p) return null;
  const k = keyFor(p, s)!;
  return {
    provider: p,
    model: modelFor(p, s),
    key: k.key,
    // Predvolene VYPNUTÉ – AI sa spúšťa len tlačidlom „Overiť cez AI“ (šetrí kredit)
    auto: s.auto ?? process.env.AI_AUTO_FALLBACK === "1",
    noApiSources: s.noApiSources ?? process.env.AI_NO_API_SOURCES === "1",
    origin: k.origin,
  };
}

/** Verejný stav pre Administráciu (bez kľúčov). */
export async function aiStatus() {
  const s = await stored();
  const cfg = await getAiConfig();
  const providers = Object.fromEntries(
    PROVIDERS.map((p) => {
      const k = keyFor(p, s);
      return [p, { label: PROVIDER_LABEL[p], hasKey: Boolean(k), origin: k?.origin || null, keyHint: envKey(p) ? `…${envKey(p).slice(-4)}` : s.keys?.[p]?.hint, model: modelFor(p, s), defaultModel: DEFAULT_MODEL[p], envLocked: Boolean(envKey(p)) }];
    }),
  ) as Record<Provider, { label: string; hasKey: boolean; origin: "env" | "admin" | null; keyHint?: string; model: string; defaultModel: string; envLocked: boolean }>;
  return {
    configured: Boolean(cfg),
    origin: cfg?.origin || null,
    provider: cfg?.provider || s.provider || envProvider() || "anthropic",
    model: cfg?.model || "",
    keyHint: cfg ? providers[cfg.provider].keyHint : undefined,
    auto: cfg?.auto ?? s.auto ?? false,
    noApiSources: cfg?.noApiSources ?? s.noApiSources ?? false,
    adminKeyAllowed: adminKeyAllowed(),
    /** Kľúč aktívneho poskytovateľa je z prostredia – nedá sa meniť tu (prepnúť poskytovateľa sa dá vždy) */
    envLocked: Boolean(cfg && cfg.origin === "env"),
    providers,
    updatedAt: s.updatedAt || undefined,
    updatedBy: s.updatedBy || undefined,
    defaults: DEFAULT_MODEL,
  };
}

/**
 * Uloženie: prepnutie poskytovateľa a voľby (auto, registre bez API) sú možné vždy; model na poskytovateľa vždy;
 * kľúč len tam, kde nie je z prostredia a kde je zadávanie v administrácii dovolené.
 */
export async function saveAiSettings(
  input: { provider?: string; model?: string; key?: string; clearKey?: boolean; auto?: boolean; noApiSources?: boolean },
  by: string,
) {
  const prev = await stored();
  const provider: Provider = input.provider === "openai" ? "openai" : input.provider === "anthropic" ? "anthropic" : prev.provider || "anthropic";
  const next: Stored = {
    provider,
    models: { ...(prev.models || {}) },
    keys: { ...(prev.keys || {}) },
    auto: input.auto ?? prev.auto,
    noApiSources: input.noApiSources ?? prev.noApiSources,
    updatedAt: new Date().toISOString(),
    updatedBy: by,
  };
  if (input.model !== undefined) {
    const m = (input.model || "").trim().slice(0, 80);
    if (m) next.models![provider] = m;
    else delete next.models![provider];
  }
  const key = (input.key || "").trim();
  const notes: string[] = [];
  if (key || input.clearKey) {
    if (envKey(provider)) throw Object.assign(new Error(`Kľúč pre ${PROVIDER_LABEL[provider]} je nastavený v premenných prostredia – zmeny robte tam.`), { status: 409 });
    if (!adminKeyAllowed()) throw Object.assign(new Error("V produkcii sa kľúč zadáva len v premenných prostredia (ANTHROPIC_API_KEY / OPENAI_API_KEY)."), { status: 403 });
  }
  if (key) {
    if (key.length < 20 || /\s/.test(key)) throw Object.assign(new Error("Kľúč nevyzerá platne."), { status: 400 });
    next.keys![provider] = { enc: encrypt(key), hint: `…${key.slice(-4)}` };
    notes.push(`nový kľúč ${next.keys![provider]!.hint}`);
  }
  if (input.clearKey) {
    delete next.keys![provider];
    notes.push("kľúč zmazaný");
  }
  await kv().set(KEY, next);
  await audit({ type: "ai_settings", by, detail: [`aktívny: ${PROVIDER_LABEL[provider]}`, next.models?.[provider] ? `model ${next.models[provider]}` : "", ...notes].filter(Boolean).join(" · ") });
  return aiStatus();
}
