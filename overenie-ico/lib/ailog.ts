import type { PageTrace, SessionLog } from "./browser/session";
import { kv } from "./auth/kv";

/**
 * Záznam AI overení a skriptovaných dopytov cez prehliadač – pre správcu platformy (Administrácia → Záznam AI overení).
 * Ku každému behu sa uloží, čo agent/skript urobil (akcie so stabilným popisom prvku – name, popis), stručné snímky stránok
 * (polia formulára, tabuľky, text), výsledok a dôvod zamietnutia. Súhrn za register je podklad na prevod „AI overenia“
 * na automatický dopyt bez AI (tak vznikol skript pre Obchodný vestník a Union).
 * Uchováva sa posledných 200 behov; obsahuje len údaje z verejných registrov a IČO preverovaných firiem.
 */
export interface RunLog {
  id: string;
  at: string;
  kind: "ai" | "flow";
  source: string;
  ico: string;
  company?: string;
  orgId?: string;
  by?: string;
  provider?: string;
  model?: string;
  mode?: string;
  /** clean / found / unknown (surový výsledok) */
  result?: string;
  /** stav kontroly po kontrole servera */
  status?: string;
  rejected?: string;
  summary?: string;
  note?: string;
  error?: string;
  ms: number;
  steps?: number;
  decidedBy?: string;
  jev?: string;
  evidence?: { url: string; quote?: string }[];
  actions?: SessionLog[];
  pages?: PageTrace[];
  events?: { kind: string; text: string; t: number }[];
  visited?: string[];
}

const KEY = "ailog";
const MAX = 200;

export async function saveRun(r: Omit<RunLog, "id" | "at"> & { at?: string }) {
  const rec: RunLog = { id: Math.random().toString(36).slice(2, 10), at: r.at || new Date().toISOString(), ...r };
  // ochrana veľkosti záznamu (Redis príkaz do 1 MB)
  let json = JSON.stringify(rec);
  if (json.length > 400_000 && rec.pages) {
    rec.pages = rec.pages.map((p) => ({ ...p, text: p.text.slice(0, 800), tables: p.tables.map((t) => t.slice(0, 5)) }));
    json = JSON.stringify(rec);
  }
  if (json.length > 400_000) rec.pages = rec.pages?.slice(-3);
  await kv().lpush(KEY, rec, MAX).catch(() => undefined);
}

export async function listRuns(opts: { source?: string; limit?: number } = {}): Promise<RunLog[]> {
  const all = await kv().lrange<RunLog>(KEY, 0, MAX - 1).catch(() => [] as RunLog[]);
  return all.filter((r) => r && (!opts.source || r.source === opts.source)).slice(0, opts.limit ?? MAX);
}

export async function clearRuns() {
  await kv().del(KEY);
}

const okResult = (r: RunLog) => (r.result === "clean" || r.result === "found") && !r.rejected && !r.error;

/**
 * Súhrn na zdieľanie: za každý register počty výsledkov, priemerný čas, posledný úspešný postup (akcie s popisom prvkov –
 * „recept“ na automatický dopyt) a jeho záverečná stránka, a posledný neúspešný beh so všetkými stránkami a dôvodom.
 */
export function summarize(runs: RunLog[]) {
  const by = new Map<string, RunLog[]>();
  for (const r of runs) by.set(r.source, [...(by.get(r.source) || []), r]);
  const sources = [...by.entries()].map(([source, list]) => {
    const ok = list.filter(okResult);
    const bad = list.filter((r) => !okResult(r));
    const lastOk = ok[0];
    const lastBad = bad[0];
    const recipe = (r?: RunLog) =>
      (r?.actions || [])
        .filter((a) => a.ok)
        .map((a) => ({ do: a.action.split(" ")[0], target: a.target, value: a.value, url: a.action.startsWith("open") ? a.action.slice(5) : undefined }));
    return {
      source,
      runs: list.length,
      kinds: { ai: list.filter((r) => r.kind === "ai").length, flow: list.filter((r) => r.kind === "flow").length },
      results: {
        clean: list.filter((r) => r.result === "clean" && !r.rejected).length,
        found: list.filter((r) => r.result === "found" && !r.rejected).length,
        unknown: list.filter((r) => !okResult(r)).length,
      },
      avgMs: Math.round(list.reduce((s, r) => s + (r.ms || 0), 0) / Math.max(1, list.length)),
      models: [...new Set(list.map((r) => [r.provider, r.model].filter(Boolean).join("/")).filter(Boolean))],
      decidedByJev: list.filter((r) => r.decidedBy === "jev").length,
      lastSuccess: lastOk && {
        at: lastOk.at,
        ico: lastOk.ico,
        result: lastOk.result,
        ms: lastOk.ms,
        steps: lastOk.steps,
        summary: lastOk.summary,
        evidence: lastOk.evidence,
        recipe: recipe(lastOk),
        resultPage: lastOk.pages?.[lastOk.pages.length - 1],
      },
      lastFailure: lastBad && {
        at: lastBad.at,
        ico: lastBad.ico,
        result: lastBad.result,
        rejected: lastBad.rejected,
        error: lastBad.error,
        summary: lastBad.summary,
        ms: lastBad.ms,
        actions: lastBad.actions,
        pages: lastBad.pages,
        events: lastBad.events?.slice(-25),
      },
    };
  });
  return { generatedAt: new Date().toISOString(), totalRuns: runs.length, sources: sources.sort((a, b) => b.results.unknown - a.results.unknown) };
}
