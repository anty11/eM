import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import type { Snapshot } from "../browser/session";
import { audit } from "../audit";
import { kv } from "../auth/kv";
import { adminKeyAllowed } from "./config";

/**
 * Jev (TypeSafe, System One) – rýchle vyhodnotenie stránky s výsledkom vyhľadávania (70 – 500 ms namiesto 5 – 15 s LLM).
 * Jev nevie ovládať prehliadač; robí len klasifikáciu s pravdepodobnosťami. Používa sa preto na jediný krok: keď server sám vyplní
 * a odošle formulár registra, Jev rozhodne „bez záznamu / záznam nájdený / neviem“. Prijme sa len „bez záznamu“ s vysokou istotou
 * (a server ho ešte nezávisle overí podľa textu stránky); nález alebo nízka istota → pokračuje LLM agent (nálezy potrebujú detaily).
 * API: POST https://api.typesafe.ai/v1/systemone, Bearer kľúč; model jev-latest (docs.typesafe.ai/api, overené 10/2026).
 * Kľúč: TYPESAFE_API_KEY z prostredia, lokálne / pri AI_ALLOW_ADMIN_KEY=1 aj z administrácie (šifrovane).
 */
const api = () => process.env.TYPESAFE_BASE_URL || "https://api.typesafe.ai";
const KEY = "settings:jev";

export interface JevSettings {
  enabled?: boolean;
  minConfidence?: number;
  keyEnc?: string;
  keyHint?: string;
  updatedAt?: string;
  updatedBy?: string;
}
export interface JevConfig {
  key: string;
  origin: "env" | "admin";
  minConfidence: number;
  model: string;
}
export interface JevVerdict {
  choice: "clean" | "found" | "unknown";
  confidence: number;
  probabilities: Record<string, number>;
  model: string;
  ms: number;
}

function cipherKey() {
  const secret = process.env.SESSION_SECRET || "dev-only-secret-dev-only-secret-dev-only";
  return createHash("sha256").update(`jev-key:${secret}`).digest();
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

const stored = async () => (await kv().get<JevSettings>(KEY).catch(() => null)) || {};
const DEFAULT_MIN = 0.85;

/** Nastavenie Jev, ak je kľúč a nie je vypnutý (predvolene zapnutý, keď je kľúč). */
export async function getJevConfig(): Promise<JevConfig | null> {
  const s = await stored();
  if (s.enabled === false) return null;
  let key = process.env.TYPESAFE_API_KEY || "";
  let origin: "env" | "admin" = "env";
  if (!key && s.keyEnc && adminKeyAllowed()) {
    try {
      key = decrypt(s.keyEnc);
      origin = "admin";
    } catch {
      return null;
    }
  }
  if (!key) return null;
  return { key, origin, minConfidence: s.minConfidence ?? DEFAULT_MIN, model: process.env.TYPESAFE_MODEL || "jev-latest" };
}

export async function jevStatus() {
  const s = await stored();
  const envKey = process.env.TYPESAFE_API_KEY || "";
  const hasKey = Boolean(envKey || (s.keyEnc && adminKeyAllowed()));
  return {
    hasKey,
    origin: envKey ? "env" : s.keyEnc ? "admin" : null,
    keyHint: envKey ? `…${envKey.slice(-4)}` : s.keyHint,
    enabled: s.enabled !== false,
    active: hasKey && s.enabled !== false,
    minConfidence: s.minConfidence ?? DEFAULT_MIN,
    envLocked: Boolean(envKey),
    adminKeyAllowed: adminKeyAllowed(),
  };
}

export async function saveJevSettings(input: { enabled?: boolean; minConfidence?: number; key?: string; clearKey?: boolean }, by: string) {
  const prev = await stored();
  const next: JevSettings = { ...prev, updatedAt: new Date().toISOString(), updatedBy: by };
  if (input.enabled !== undefined) next.enabled = Boolean(input.enabled);
  if (input.minConfidence !== undefined) next.minConfidence = Math.min(0.99, Math.max(0.5, Number(input.minConfidence) || DEFAULT_MIN));
  const key = (input.key || "").trim();
  if (key || input.clearKey) {
    if (process.env.TYPESAFE_API_KEY) throw Object.assign(new Error("Kľúč Jev je v premenných prostredia (TYPESAFE_API_KEY) – zmeny robte tam."), { status: 409 });
    if (!adminKeyAllowed()) throw Object.assign(new Error("V produkcii sa kľúč zadáva len v premenných prostredia (TYPESAFE_API_KEY)."), { status: 403 });
  }
  if (key) {
    if (key.length < 16 || /\s/.test(key)) throw Object.assign(new Error("Kľúč nevyzerá platne."), { status: 400 });
    next.keyEnc = encrypt(key);
    next.keyHint = `…${key.slice(-4)}`;
  }
  if (input.clearKey) {
    delete next.keyEnc;
    delete next.keyHint;
  }
  await kv().set(KEY, next);
  await audit({ type: "ai_settings", by, detail: `Jev: ${next.enabled === false ? "vypnutý" : "zapnutý"} · istota ≥ ${next.minConfidence ?? DEFAULT_MIN}${key ? ` · nový kľúč ${next.keyHint}` : ""}${input.clearKey ? " · kľúč zmazaný" : ""}` });
  return jevStatus();
}

async function call(cfg: JevConfig, body: unknown, timeoutMs = 6000): Promise<any> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(`${api()}/v1/systemone`, {
      method: "POST",
      headers: { authorization: `Bearer ${cfg.key}`, "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: ctrl.signal,
      cache: "no-store",
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(r.status === 401 ? "neplatný kľúč Jev" : j?.error?.message || j?.message || `HTTP ${r.status} z api.typesafe.ai`);
    return j;
  } catch (e) {
    if ((e as Error).name === "AbortError") throw new Error(`Jev neodpovedal do ${timeoutMs / 1000} s`);
    throw e;
  } finally {
    clearTimeout(t);
  }
}

/** Test kľúča (jednoduchá otázka áno/nie). */
export async function pingJev(cfg: JevConfig): Promise<{ model: string; ms: number }> {
  const t0 = Date.now();
  const j = await call(cfg, { state: "The search returned: No records found.", model: cfg.model, questions: { empty: { type: "noul", instructions: "Did the search return no records?", criteria: { true: "No records found", false: "Some records were found" } } } });
  return { model: String(j.model || cfg.model), ms: Date.now() - t0 };
}

/**
 * Vyhodnotenie stránky s výsledkom vyhľadávania v registri. Pokyny sú po anglicky (hlavný jazyk modelu), stránka po slovensky;
 * stav sa posiela ako štruktúrovaný objekt (register, hľadané IČO, titulok, tabuľky, text).
 */
export async function jevJudgeResult(
  cfg: JevConfig,
  input: { register: string; ico: string; companyName?: string; snapshot: Snapshot; negativeMeans: string; routineMeans?: string },
): Promise<JevVerdict> {
  const t0 = Date.now();
  const s = input.snapshot;
  const state = {
    register: input.register,
    searched_company_id: input.ico,
    searched_company_name: input.companyName || null,
    page_url: s.url,
    page_title: s.title,
    result_tables: s.tables.slice(0, 3).map((t) => t.slice(0, 30)),
    page_text: s.text.slice(0, 6000),
  };
  const j = await call(cfg, {
    state,
    model: cfg.model,
    questions: {
      result: {
        type: "choice",
        instructions: {
          question: `This is the result page after searching a Slovak public register (${input.register}) for the company with ID (IČO) ${input.ico}. Is the company listed with a negative record?`,
          focus: `A negative record means: ${input.negativeMeans}. The page is in Slovak. Judge only from what the page shows for the searched company.`,
        },
        criteria: {
          clean: {
            what: `The search was performed and the page shows no negative record for the searched company: an explicit empty-result message (e.g. "Nenašli sa žiadne záznamy", "Zadaný výraz nebol nájdený", "0 záznamov"), an empty result table${input.routineMeans ? `, or only routine entries (${input.routineMeans})` : ""}.`,
            not_for: "A page where the search form is shown without results, an error page, or a list that was not filtered for the searched company.",
          },
          found: {
            what: `The result shows the searched company (matching ID or name) with a negative record: ${input.negativeMeans}.`,
            not_for: "Rows about other companies, or only routine entries.",
          },
          unknown: {
            what: "It is not possible to tell: the search was not performed, the page shows an error or captcha, results are unfiltered or paginated without the company, or the page is ambiguous.",
          },
        },
      },
    },
  });
  const a = j?.answers?.result || {};
  const choice = ["clean", "found", "unknown"].includes(a.choice) ? a.choice : "unknown";
  return { choice, confidence: Number(a.confidence ?? 0), probabilities: a.probabilities || {}, model: String(j.model || cfg.model), ms: Date.now() - t0 };
}
