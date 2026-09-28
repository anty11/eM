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
import type { CheckResult, Ctx, ScanReport } from "./types";

export const APP_VERSION = "1.0.0";

export async function scan(ico: string): Promise<ScanReport> {
  const scannedAt = new Date().toISOString();
  const ctx: Ctx = { ico, profile: { ico } };

  // 1. fáza: identifikácia (meno, DIČ) – potrebné pre ďalšie kontroly
  const rpo = await checkRpo(ctx);
  const ruz = await checkRuz(ctx); // doplní DIČ pre daňové kontroly

  // 2. fáza: ostatné registre paralelne
  const [debtors, vat, ids, incomeTax, socpoist, insolvency, rpvs, news] = await Promise.all([
    checkTaxDebtors(ctx),
    checkVat(ctx),
    checkIds(ctx),
    checkIncomeTax(ctx),
    checkSocpoist(ctx),
    checkInsolvency(ctx),
    checkRpvs(ctx),
    checkNews(ctx),
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
