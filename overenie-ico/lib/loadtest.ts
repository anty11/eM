/**
 * Záťažová skúška preverení – vyhodnotenie (bez závislostí, používa ju aj prehliadač).
 * Každý beh = jedno preverenie cez /api/check (stream); zbiera sa celkový čas, čas po prvú udalosť a výsledok každého zdroja.
 */
export interface LoadRunSource {
  id: string;
  status: string;
  ms?: number;
  summary?: string;
}
export interface LoadRun {
  ico: string;
  wave: number;
  startedAt: number;
  firstMs?: number;
  totalMs?: number;
  done: boolean;
  error?: string;
  httpStatus?: number;
  instance?: string;
  region?: string;
  verdict?: string;
  sources: LoadRunSource[];
}

/** Text, ktorý naznačuje obmedzenie zo strany registra (limit, blokovanie, preťaženie). */
export const THROTTLE_RE = /\b(403|429|503)\b|too many|rate.?limit|limit (dopytov|požiadaviek)|blokovan|preťaž|throttl|časový limit|timeout|vypršal/i;

export function percentile(values: number[], p: number): number | undefined {
  if (!values.length) return undefined;
  const s = [...values].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.max(0, Math.ceil((p / 100) * s.length) - 1))];
}

export interface SourceStat {
  id: string;
  runs: number;
  ok: number;
  /** zdroj nedostupný / chyba */
  errors: number;
  manual: number;
  throttled: number;
  avgMs?: number;
  p95Ms?: number;
  samples: string[];
}

export function summarizeLoad(runs: LoadRun[]) {
  const done = runs.filter((r) => r.done);
  const totals = done.map((r) => r.totalMs!).filter((x) => typeof x === "number");
  const firsts = runs.map((r) => r.firstMs).filter((x): x is number => typeof x === "number");
  const by = new Map<string, SourceStat & { ms: number[] }>();
  for (const r of runs)
    for (const s of r.sources) {
      const st = by.get(s.id) || { id: s.id, runs: 0, ok: 0, errors: 0, manual: 0, throttled: 0, samples: [], ms: [] };
      st.runs++;
      if (s.status === "error") st.errors++;
      else if (s.status === "manual") st.manual++;
      else if (s.status !== "pending") st.ok++;
      if ((s.status === "error" || s.status === "manual") && s.summary && THROTTLE_RE.test(s.summary)) {
        st.throttled++;
        if (st.samples.length < 3 && !st.samples.includes(s.summary.slice(0, 160))) st.samples.push(s.summary.slice(0, 160));
      } else if (s.status === "error" && s.summary && st.samples.length < 3 && !st.samples.includes(s.summary.slice(0, 160))) st.samples.push(s.summary.slice(0, 160));
      if (typeof s.ms === "number") st.ms.push(s.ms);
      by.set(s.id, st);
    }
  const sources: SourceStat[] = [...by.values()]
    .map(({ ms, ...st }) => ({ ...st, avgMs: ms.length ? Math.round(ms.reduce((a, b) => a + b, 0) / ms.length) : undefined, p95Ms: percentile(ms, 95) }))
    .sort((a, b) => b.errors + b.throttled - (a.errors + a.throttled) || a.id.localeCompare(b.id));
  return {
    runs: runs.length,
    done: done.length,
    failed: runs.filter((r) => !r.done).length,
    instances: new Set(runs.map((r) => r.instance).filter(Boolean)).size,
    regions: [...new Set(runs.map((r) => r.region).filter(Boolean))],
    totalMs: { p50: percentile(totals, 50), p95: percentile(totals, 95), max: totals.length ? Math.max(...totals) : undefined },
    firstMs: { p50: percentile(firsts, 50), p95: percentile(firsts, 95) },
    throttledSources: sources.filter((s) => s.throttled > 0).map((s) => s.id),
    sources,
  };
}
