import { icoChecksumValid } from "./ico";
import { computeVerdict } from "./scoring";
import { keyFacts } from "./keyfacts";
import { checkIds, checkIncomeTax, checkTaxDebtors, checkVat } from "./sources/fs";
import { checkInsolvency } from "./sources/insolvency";
import { manualChecks } from "./sources/manual";
import { checkOv } from "./sources/ov";
import { PUBLIC_QUERY_IDS, queryPublicRegister } from "./sources/public";
import { checkNews } from "./sources/news";
import { checkRpo } from "./sources/rpo";
import { checkRpvs } from "./sources/rpvs";
import { checkRuz } from "./sources/ruz";
import { checkSocpoist } from "./sources/socpoist";
import type { CheckResult, CompanyProfile, Ctx, ScanReport } from "./types";
import { META } from "./sources/meta";

export const APP_VERSION = "2.1.10";

/** Celkový časový limit preverenia – čo nestihne, označí sa ako „zdroj neodpovedal“ (dá sa doplniť cez AI / znova). */
const DEADLINE_MS = 25000;

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export type Progress = (c: CheckResult, profile: Ctx["profile"]) => void;

export async function scan(ico: string, onProgress?: Progress, opts: { asOf?: string } = {}): Promise<ScanReport> {
  const t0 = Date.now();
  const scannedAt = new Date().toISOString();
  const ctx: Ctx = { ico, profile: { ico }, asOf: opts.asOf };
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

  // Najprv identifikácia v Registri právnických osôb – ak IČO neexistuje, ostatné kontroly nemajú zmysel
  const rpoP = checkRpo(ctx);
  ctx.rpoDone = rpoP.catch(() => undefined);
  const rpoFirst = await capRaw("rpo", rpoP);
  if (ctx.profile.notFound || (rpoFirst.data as any)?.notFound) {
    onProgress?.(rpoFirst, ctx.profile);
    const scanId = `SK-${ico}-${scannedAt.replace(/[-:TZ.]/g, "").slice(0, 14)}`;
    return {
      scanId,
      ico,
      scannedAt,
      profile: ctx.profile,
      checks: [rpoFirst],
      verdict: {
        level: "not_recommended",
        label: "IČO NENÁJDENÉ – preverenie nie je možné",
        score: 0,
        reasons: ["IČO nie je evidované v Registri právnických osôb. Skontrolujte správnosť IČO; ostatné registre sa nepreverovali."],
        preliminary: false,
        pendingManual: 0,
      },
      keyFacts: [],
      appVersion: APP_VERSION,
      notFound: true,
    };
  }
  for (const m of manualChecks(ctx)) onProgress?.(m, ctx.profile);
  const ruzP = checkRuz(ctx);
  // daňové kontroly: potrebujú meno (RPO) a DIČ (RÚZ) – na DIČ čakajú najviac 8 s
  const idReady = Promise.all([ctx.rpoDone, Promise.race([ctx.dicReady, sleep(8000)])]);
  const after = (fn: (c: Ctx) => Promise<CheckResult>) => idReady.then(() => fn(ctx));

  // Registre bez API: server položí dopyt priamo (diskvalifikácie, ÚVO, VšZP, Union) alebo číta index Obchodného vestníka;
  // ak odpoveď nie je jednoznačná, ostáva manuálna kontrola
  const manualP = resolveManual(ctx, (c) => onProgress?.(c, ctx.profile));
  const [rpo, ruz, debtors, vat, ids, incomeTax, socpoist, insolvency, rpvs, news] = await Promise.all([
    cap("rpo", Promise.resolve(rpoFirst)),
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

  const manual = await Promise.race([manualP, sleep(Math.max(1000, DEADLINE_MS - (Date.now() - t0))).then(() => manualChecks(ctx))]);
  const checks: CheckResult[] = [rpo, debtors, vat, ids, incomeTax, socpoist, ruz, insolvency, rpvs, news, ...manual];
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
    asOf: ctx.asOf,
  };
}

/** Manuálne registre: pokus o automatické overenie; neúspech = pôvodná manuálna kontrola. Výsledky sa hlásia priebežne. */
export async function resolveManual(ctx: Ctx, onProgress?: (c: CheckResult) => void): Promise<CheckResult[]> {
  const base = manualChecks(ctx);
  await ctx.rpoDone; // mená štatutárov pre register diskvalifikácií
  return Promise.all(
    base.map(async (m) => {
      try {
        let auto: CheckResult | null = null;
        if (m.id === "ov") auto = await checkOv(ctx);
        else if ((PUBLIC_QUERY_IDS as readonly string[]).includes(m.id)) auto = (await queryPublicRegister(m.id, ctx)).check;
        if (auto) {
          onProgress?.(auto);
          return auto;
        }
      } catch {
        /* ostáva manuálne */
      }
      return m;
    }),
  );
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
  ov: async (c) => (await checkOv(c)) || manualChecks(c).find((m) => m.id === "ov")!,
  diskv: async (c) => (await queryPublicRegister("diskv", c)).check || manualChecks(c).find((m) => m.id === "diskv")!,
  uvo: async (c) => (await queryPublicRegister("uvo", c)).check || manualChecks(c).find((m) => m.id === "uvo")!,
  vszp: async (c) => (await queryPublicRegister("vszp", c)).check || manualChecks(c).find((m) => m.id === "vszp")!,
  union: async (c) => (await queryPublicRegister("union", c)).check || manualChecks(c).find((m) => m.id === "union")!,
};

/** Znovu spustí jeden zdroj (napr. po výpadku) s už známym profilom subjektu. */
export async function runOne(ico: string, id: string, profile: Partial<CompanyProfile>): Promise<{ check: CheckResult; profile: CompanyProfile } | null> {
  const fn = RUNNERS[id];
  if (!fn) return null;
  const ctx: Ctx = { ico, profile: { ...profile, ico } as CompanyProfile, rpoDone: Promise.resolve(), dicReady: Promise.resolve(), resolveDic: () => undefined };
  const check = await fn(ctx);
  return { check, profile: ctx.profile };
}
