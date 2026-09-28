import type { AiConfig } from "./config";

/**
 * Volanie LLM s webovým vyhľadávaním. Bez SDK – priame REST volania.
 *  - Claude (Anthropic Messages API): nástroje web_search + web_fetch (serverové, vykoná ich Anthropic).
 *    web_fetch smie otvoriť len URL, ktoré sú v správe používateľa → presné odkazy na registre dávame do promptu.
 *  - OpenAI (Responses API): nástroj web_search.
 */
export interface LlmRequest {
  system: string;
  user: string;
  /** Domény, z ktorých smie model čítať (prázdne = bez obmedzenia). */
  allowedDomains?: string[];
  maxSearches?: number;
  timeoutMs?: number;
}

export interface LlmResponse {
  text: string;
  /** URL, ktoré model reálne navštívil / citoval (z odpovede API, nie z textu modelu). */
  visited: string[];
  usage?: { input?: number; output?: number; searches?: number };
}

const ANTHROPIC_URL = process.env.ANTHROPIC_BASE_URL || "https://api.anthropic.com";
const OPENAI_URL = process.env.OPENAI_BASE_URL || "https://api.openai.com";

async function post(url: string, headers: Record<string, string>, body: unknown, timeoutMs: number) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body), signal: ctrl.signal, cache: "no-store" });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) {
      const msg = j?.error?.message || j?.message || `HTTP ${r.status}`;
      throw new Error(r.status === 401 ? "neplatný API kľúč" : r.status === 429 ? "prekročený limit API (skúste neskôr)" : msg);
    }
    return j;
  } catch (e) {
    if ((e as Error).name === "AbortError") throw new Error(`AI neodpovedala do ${Math.round(timeoutMs / 1000)} s`);
    throw e;
  } finally {
    clearTimeout(t);
  }
}

function collectUrls(node: unknown, out: Set<string>) {
  if (!node || typeof node !== "object") return;
  if (Array.isArray(node)) return node.forEach((n) => collectUrls(n, out));
  const o = node as Record<string, unknown>;
  for (const k of ["url", "source"]) if (typeof o[k] === "string" && /^https?:\/\//.test(o[k] as string)) out.add(o[k] as string);
  for (const v of Object.values(o)) if (v && typeof v === "object") collectUrls(v, out);
}

async function anthropic(cfg: AiConfig, req: LlmRequest): Promise<LlmResponse> {
  const domains = req.allowedDomains?.length ? { allowed_domains: req.allowedDomains } : {};
  const body: any = {
    model: cfg.model,
    max_tokens: 4096,
    system: req.system,
    messages: [{ role: "user", content: req.user }],
    tools: [
      { type: "web_search_20260318", name: "web_search", max_uses: req.maxSearches ?? 5, user_location: { type: "approximate", country: "SK", timezone: "Europe/Bratislava" }, ...domains },
      { type: "web_fetch_20260318", name: "web_fetch", max_uses: req.maxSearches ?? 5, max_content_tokens: 30000, ...domains },
    ],
  };
  const headers = { "x-api-key": cfg.key, "anthropic-version": "2023-06-01" };
  const visited = new Set<string>();
  const deadline = Date.now() + (req.timeoutMs ?? 90000);
  let usage = { input: 0, output: 0, searches: 0 };
  // pause_turn: dlhšie vyhľadávanie – pošleme odpoveď späť a pokračujeme (max. 4×)
  for (let i = 0; i < 5; i++) {
    const j = await post(`${ANTHROPIC_URL}/v1/messages`, headers, body, Math.max(5000, deadline - Date.now()));
    collectUrls(j.content, visited);
    usage.input += j.usage?.input_tokens || 0;
    usage.output += j.usage?.output_tokens || 0;
    usage.searches += j.usage?.server_tool_use?.web_search_requests || 0;
    if (j.stop_reason === "pause_turn") {
      body.messages = [...body.messages, { role: "assistant", content: j.content }];
      continue;
    }
    const text = (j.content || []).filter((b: any) => b.type === "text").map((b: any) => b.text).join("\n");
    return { text, visited: [...visited], usage };
  }
  throw new Error("AI nedokončila vyhľadávanie");
}

async function openai(cfg: AiConfig, req: LlmRequest): Promise<LlmResponse> {
  const tool: any = { type: "web_search", user_location: { type: "approximate", country: "SK" } };
  if (req.allowedDomains?.length) tool.filters = { allowed_domains: req.allowedDomains };
  const j = await post(
    `${OPENAI_URL}/v1/responses`,
    { authorization: `Bearer ${cfg.key}` },
    { model: cfg.model, instructions: req.system, input: req.user, tools: [tool] },
    req.timeoutMs ?? 90000,
  );
  const visited = new Set<string>();
  collectUrls(j.output, visited);
  const text =
    j.output_text ||
    (j.output || [])
      .filter((o: any) => o.type === "message")
      .flatMap((o: any) => o.content || [])
      .filter((c: any) => c.type === "output_text")
      .map((c: any) => c.text)
      .join("\n");
  return { text, visited: [...visited], usage: { input: j.usage?.input_tokens, output: j.usage?.output_tokens } };
}

export async function callLlm(cfg: AiConfig, req: LlmRequest): Promise<LlmResponse> {
  return cfg.provider === "openai" ? openai(cfg, req) : anthropic(cfg, req);
}

/** Jednoduchý test kľúča (bez vyhľadávania). */
export async function pingLlm(cfg: AiConfig): Promise<string> {
  if (cfg.provider === "openai") {
    const j = await post(`${OPENAI_URL}/v1/responses`, { authorization: `Bearer ${cfg.key}` }, { model: cfg.model, input: "Odpovedz jedným slovom: OK" }, 30000);
    return j.output_text || JSON.stringify(j.output?.[0]?.content?.[0]?.text || "").slice(0, 40);
  }
  const j = await post(
    `${ANTHROPIC_URL}/v1/messages`,
    { "x-api-key": cfg.key, "anthropic-version": "2023-06-01" },
    { model: cfg.model, max_tokens: 10, messages: [{ role: "user", content: "Odpovedz jedným slovom: OK" }] },
    30000,
  );
  return (j.content || []).map((b: any) => b.text || "").join("").trim();
}
