import type { CategoryId, CheckResult, CheckStatus, Finding } from "./types";
import { AsyncLocalStorage } from "node:async_hooks";
import { logError } from "./errlog";

/** IČO práve bežiaceho preverenia (len na záznam chýb) – nastavuje scan() a runOne(). */
export const icoStore = new AsyncLocalStorage<string>();

export interface CheckMeta {
  id: string;
  category: CategoryId;
  name: string;
  source: string;
  sourceUrl: string;
  automated?: boolean;
}

export type CheckBody = Omit<CheckResult, keyof CheckMeta | "checkedAt" | "durationMs" | "automated"> & {
  verifyUrl?: string;
};

/** Spustí kontrolu, zmeria čas a zachytí chyby tak, aby jedna chyba nezastavila celý sken. */
export async function runCheck(meta: CheckMeta, fn: () => Promise<CheckBody>): Promise<CheckResult> {
  const t0 = Date.now();
  const checkedAt = new Date().toISOString();
  try {
    const body = await fn();
    return { automated: true, ...meta, ...body, checkedAt, durationMs: Date.now() - t0 };
  } catch (e) {
    void logError({ kind: "error", source: meta.id, ico: icoStore.getStore() || "", message: (e as Error).message, ms: Date.now() - t0, where: "scan" });
    return {
      automated: true,
      ...meta,
      status: "error",
      summary: `Zdroj sa nepodarilo overiť: ${(e as Error).message}. Overte manuálne.`,
      findings: [{ severity: "warning", text: `${meta.name}: overenie zlyhalo – potrebné manuálne overenie`, penalty: 0 }],
      verifyUrl: meta.sourceUrl,
      // záznam vyhľadávania aj pri chybe (čo sa stihlo prehľadať a kde to zlyhalo)
      ...((e as any)?.search ? { search: (e as any).search } : {}),
      checkedAt,
      durationMs: Date.now() - t0,
    };
  }
}

export function statusFromFindings(findings: Finding[], fallback: CheckStatus = "ok"): CheckStatus {
  if (findings.some((f) => f.severity === "critical")) return "critical";
  if (findings.some((f) => f.severity === "warning")) return "warning";
  return fallback;
}
