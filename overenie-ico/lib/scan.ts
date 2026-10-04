import { icoChecksumValid } from "./ico";
import { computeVerdict } from "./scoring";
import { keyFacts } from "./keyfacts";
import { checkIds, checkIncomeTax, checkTaxDebtors, checkVat } from "./sources/fs";
import { checkInsolvency } from "./sources/insolvency";
import { manualChecks } from "./sources/manual";
import { checkNews } from "./sources/news";
import { checkRpo } from "./sources/rpo";
import { checkRpvs } from "./sources/rpvs";
import { checkRuz } from "./sources/ruz";
import { checkSocpoist } from "./sources/socpoist";
import type { CheckResult, CompanyProfile, Ctx, ScanReport } from "./types";
import { META } from "./sources/meta";

export const APP_VERSION = "1.3.6";

/** Celkový časový limit preverenia – čo nestihne, označí sa ako „zdroj neodpovedal“ (dá sa doplniť cez AI / znova). */
const DEADLINE_MS = 25000;

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export type Progress = (c: CheckResult, profile: Ctx["profile"]) => void;

export async function scan(ico: string, onProgress?: Progress): Promise<ScanReport> {
  const t0 = Date.now();
  const scannedAt = new Date().toISOString();
  const ctx: Ctx = { ico, profile: { ico } };
  let resolveDic!: () => void;
  ctx.dicReady = new Promise<void>((r) => (resolveDic = r));
  ctx.resolveDic = resolveDic;

  // Všetko beží súčasne; závislé kontroly čakajú len na údaj, ktorý potrebujú
  const cap = (id: string, p: Promise<CheckResult>): Promise<CheckResult> =>
    capRaw(id, p).then((r) => {
      try {
        onProgress?.(r, ctx.profile);
      } catch {
        /* klient sa odpojil */
      }
      return r;
    });
  const capRaw = (id: string, p: Promise<CheckResult>): Promise<CheckResult> =>
    Promise.race([
      p,
      sleep(Math.max(1000, DEADLINE_MS - (Date.now() - t0))).then((): CheckResult => ({
        id,
        ...META[id],
        status: "error",
        summary: `Zdroj neodpovedal do ${Math.round(DEADLINE_MS / 1000)} s. Skúste „Preveriť znova“ alebo overte v zdroji.`,
        findings: [],
        checkedAt: new Date().toISOString(),
        durationMs: Date.now() - t0,
        automated: true,
        verifyUrl: META[id].sourceUrl,
      })),
    ]);

  for (const m of manualChecks(ctx)) onProgress?.(m, ctx.profile);
  const rpoP = checkRpo(ctx);
  ctx.rpoDone = rpoP.catch(() => undefined);
  const ruzP = checkRuz(ctx);
  // daňové kontroly: potrebujú meno (RPO) a DIČ (RÚZ) – na DIČ čakajú najviac 8 s
  const idReady = Promise.all([ctx.rpoDone, Promise.race([ctx.dicReady, sleep(8000)])]);
  const after = (fn: (c: Ctx) => Promise<CheckResult>) => idReady.then(() => fn(ctx));

  const [rpo, ruz, debtors, vat, ids, incomeTax, socpoist, insolvency, rpvs, news] = await Promise.all([
    cap("rpo", rpoP),
    cap("ruz", ruzP),
    cap("fs-debtors", after(checkTaxDebtors)),
    cap("fs-vat", after(checkVat)),
    cap("fs-ids", after(checkIds)),
    cap("fs-dppo", after(checkIncomeTax)),
    cap("socpoist", checkSocpoist(ctx)),
    cap("insolvency", checkInsolvency(ctx)),
    cap("rpvs", checkRpvs(ctx)),
    cap("news", ctx.rpoDone.then(() => checkNews(ctx))),
  ]);

  const checks: CheckResult[] = [rpo, debtors, vat, ids, incomeTax, socpoist, ruz, insolvency, rpvs, news, ...manualChecks(ctx)];
  if (!icoChecksumValid(ico))
    rpo.findings.push({ severity: "info", text: "IČO nespĺňa kontrolný súčet (môže ísť o historické IČO) – overte správnosť", penalty: 0 });

  const scanId = `SK-${ico}-${scannedAt.replace(/[-:TZ.]/g, "").slice(0, 14)}`;
  return {
    scanId,
    ico,
    scannedAt,
    profile: ctx.profile,
    checks,
    verdict: computeVerdict(checks),
    keyFacts: keyFacts(ctx.profile, checks),
    appVersion: APP_VERSION,
  };
}

const RUNNERS: Record<string, (c: Ctx) => Promise<CheckResult>> = {
  rpo: checkRpo,
  ruz: checkRuz,
  "fs-debtors": checkTaxDebtors,
  "fs-vat": checkVat,
  "fs-ids": checkIds,
  "fs-dppo": checkIncomeTax,
  socpoist: checkSocpoist,
  insolvency: checkInsolvency,
  rpvs: checkRpvs,
  news: checkNews,
};

/** Znovu spustí jeden zdroj (napr. po výpadku) s už známym profilom subjektu. */
export async function runOne(ico: string, id: string, profile: Partial<CompanyProfile>): Promise<{ check: CheckResult; profile: CompanyProfile } | null> {
  const fn = RUNNERS[id];
  if (!fn) return null;
  const ctx: Ctx = { ico, profile: { ...profile, ico } as CompanyProfile, rpoDone: Promise.resolve(), dicReady: Promise.resolve(), resolveDic: () => undefined };
  const check = await fn(ctx);
  return { check, profile: ctx.profile };
}
