import { icoChecksumValid } from "./ico";
import { computeVerdict } from "./scoring";
import { keyFacts } from "./keyfacts";
import { checkIds, checkIncomeTax, checkTaxDebtors, checkVat } from "./sources/fs";
import { checkInsolvency } from "./sources/insolvency";
import { manualChecks } from "./sources/manual";
import { checkOv } from "./sources/ov";
import { checkOvViaBrowser, PUBLIC_QUERY_IDS, queryPublicRegister } from "./sources/public";
import { kv } from "./auth/kv";
import { checkNews } from "./sources/news";
import { checkRpo } from "./sources/rpo";
import { checkRpvs } from "./sources/rpvs";
import { checkRuz } from "./sources/ruz";
import { checkSocpoist } from "./sources/socpoist";
import type { CheckResult, CompanyProfile, Ctx, ScanReport } from "./types";
import { META } from "./sources/meta";

export const APP_VERSION = "2.9.9";

/** Celkový časový limit preverenia – čo nestihne, označí sa ako „zdroj neodpovedal“ (dá sa doplniť cez AI / znova). */
const DEADLINE_MS = 25000;
/** Registre bez API (vrátane dopytu cez prehliadač na serveri – spustenie Chromia a hľadanie trvá 5 – 15 s) majú vlastný, dlhší limit. */
const MANUAL_DEADLINE_MS = 55000;

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Vyrovnávacia pamäť výsledkov podľa zdroja a IČO – PREDVOLENE VYPNUTÁ: zmyslom preverenia je aktuálny stav registrov v čase dopytu,
 * takže každé preverenie sa pýta registrov nanovo. Zapína sa len vedome premennou CHECK_CACHE_MIN (minúty), napr. 10 – 15 min ako ochrana
 * pred opakovaným načítaním tej istej firmy v krátkom čase pri veľkej prevádzke (limity API registrov). Ukladajú sa len úspešné výsledky,
 * výsledok z pamäte je označený časom uloženia, „Preveriť znova“ (fresh) pamäť vždy obíde a spätné preverenie k dátumu ju nepoužíva.
 */
const cacheTtlSec = (id: string): number => {
  const min = Number(process.env.CHECK_CACHE_MIN || 0);
  if (!min || min <= 0) return 0;
  return Math.round(Math.min(min, id === "news" ? Math.min(min, 120) : min) * 60);
};
const CACHE_VERSION = "1";
const cacheKey = (id: string, ico: string) => `cache:check:${CACHE_VERSION}:${id}:${ico}`;
interface CachedCheck {
  check: CheckResult;
  profile: Partial<CompanyProfile>;
  at: string;
}

async function cachedRun(ctx: Ctx, id: string, fn: () => Promise<CheckResult>, fresh: boolean): Promise<CheckResult> {
  const key = cacheKey(id, ctx.ico);
  const ttl = cacheTtlSec(id);
  if (!ttl) return fn();
  if (!fresh && !ctx.asOf) {
    const hit = await kv().get<CachedCheck>(key).catch(() => null);
    if (hit?.check) {
      for (const [k, v] of Object.entries(hit.profile || {})) if ((ctx.profile as any)[k] === undefined && v !== undefined) (ctx.profile as any)[k] = v;
      if (id === "ruz") ctx.resolveDic?.();
      return { ...hit.check, cachedAt: hit.at };
    }
  }
  const before = JSON.stringify(ctx.profile);
  const check = await fn();
  if (!ctx.asOf && ["ok", "warning", "critical"].includes(check.status) && !ctx.profile.notFound) {
    const prev = JSON.parse(before) as Record<string, unknown>;
    const patch: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(ctx.profile)) if (JSON.stringify(v) !== JSON.stringify(prev[k])) patch[k] = v;
    await kv()
      .set(key, { check, profile: patch, at: new Date().toISOString() } satisfies CachedCheck, ttl)
      .catch(() => undefined);
  }
  return check;
}

/** Zmaže uložené výsledky pre IČO (po „Skúsiť znova“ pri jednom zdroji sa obnoví len ten). */
export async function invalidateCache(ico: string, id?: string) {
  const ids = id ? [id] : Object.keys(META);
  await Promise.all(ids.map((i) => kv().del(cacheKey(i, ico)).catch(() => undefined)));
}

export type Progress = (c: CheckResult, profile: Ctx["profile"]) => void;

/** Číslo preverenia (na protokole a pri overení pečate) – z IČO a času začiatku preverenia. */
export const scanIdFor = (ico: string, scannedAt: string) => `SK-${ico}-${scannedAt.replace(/[-:TZ.]/g, "").slice(0, 14)}`;

export async function scan(ico: string, onProgress?: Progress, opts: { asOf?: string; fresh?: boolean; scannedAt?: string } = {}): Promise<ScanReport> {
  const t0 = Date.now();
  const scannedAt = opts.scannedAt || new Date().toISOString();
  const ctx: Ctx = { ico, profile: { ico }, asOf: opts.asOf };
  const fresh = Boolean(opts.fresh);
  const run = (id: string, fn: (c: Ctx) => Promise<CheckResult>) => cachedRun(ctx, id, () => fn(ctx), fresh);
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

  // Všetky zdroje štartujú hneď. Podľa IČO sa pýtajú RÚZ, Sociálna poisťovňa, REPLIK, RPVS a registre bez API; na meno z RPO čakajú
  // len kontroly, ktoré ho potrebujú (FS, médiá, ÚVO, diskvalifikácie) – a najviac 14 s: ak RPO (API ŠÚ SR) odpovedá pomaly,
  // použije sa názov z RÚZ. Pomalý register tak nezdrží ostatné (predtým všetko čakalo na RPO až 25 s pri „0 z 10“).
  const rpoP = run("rpo", checkRpo);
  ctx.rpoDone = rpoP.catch(() => undefined);
  const rpoCapped = capRaw("rpo", rpoP);
  for (const m of manualChecks(ctx)) onProgress?.(m, ctx.profile);
  const ruzP = run("ruz", checkRuz);
  const nameFallback = () => {
    if (!ctx.profile.name && ctx.profile.ruzName) {
      ctx.profile.name = ctx.profile.ruzName;
      if (!ctx.profile.address && ctx.profile.ruzAddress) ctx.profile.address = ctx.profile.ruzAddress;
    }
  };
  const nameReady = Promise.race([ctx.rpoDone, sleep(14000)]).then(nameFallback);
  // daňové kontroly: potrebujú meno a DIČ (RÚZ) – na DIČ čakajú najviac 8 s
  const idReady = Promise.all([nameReady, Promise.race([ctx.dicReady, sleep(8000)])]);
  const after = (id: string, fn: (c: Ctx) => Promise<CheckResult>) => idReady.then(() => run(id, fn));

  // Registre bez API: server položí dopyt priamo (diskvalifikácie, ÚVO, VšZP, Union) alebo číta index Obchodného vestníka;
  // ak odpoveď nie je jednoznačná, ostáva manuálna kontrola
  const manualP = resolveManual({ ...ctx, rpoDone: nameReady } as Ctx, (c) => onProgress?.(c, ctx.profile), fresh);
  const allP = Promise.all([
    cap("rpo", rpoCapped),
    cap("ruz", ruzP),
    cap("fs-debtors", after("fs-debtors", checkTaxDebtors)),
    cap("fs-vat", after("fs-vat", checkVat)),
    cap("fs-ids", after("fs-ids", checkIds)),
    cap("fs-dppo", after("fs-dppo", checkIncomeTax)),
    cap("socpoist", run("socpoist", checkSocpoist)),
    cap("insolvency", run("insolvency", checkInsolvency)),
    cap("rpvs", run("rpvs", checkRpvs)),
    cap("news", nameReady.then(() => run("news", checkNews))),
  ]);

  // IČO neexistuje → koniec (ostatné výsledky sa zahodia)
  const rpoFirst = await rpoCapped;
  if (ctx.profile.notFound || (rpoFirst.data as any)?.notFound) {
    const scanId = scanIdFor(ico, scannedAt);
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
  const [rpo, ruz, debtors, vat, ids, incomeTax, socpoist, insolvency, rpvs, news] = await allP;
  nameFallback();

  const manual = await Promise.race([manualP, sleep(Math.max(1000, MANUAL_DEADLINE_MS - (Date.now() - t0))).then(() => manualChecks(ctx))]);
  const checks: CheckResult[] = [rpo, debtors, vat, ids, incomeTax, socpoist, ruz, insolvency, rpvs, news, ...manual];
  if (!icoChecksumValid(ico))
    rpo.findings.push({ severity: "info", text: "IČO nespĺňa kontrolný súčet (môže ísť o historické IČO) – overte správnosť", penalty: 0 });

  const scanId = scanIdFor(ico, scannedAt);
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
export async function resolveManual(ctx: Ctx, onProgress?: (c: CheckResult) => void, fresh = false): Promise<CheckResult[]> {
  const base = manualChecks(ctx);
  return Promise.all(
    base.map(async (m) => {
      try {
        const ttl = cacheTtlSec(m.id);
        if (ttl && !fresh && !ctx.asOf) {
          const hit = await kv().get<CachedCheck>(cacheKey(m.id, ctx.ico)).catch(() => null);
          if (hit?.check) {
            const c = { ...hit.check, cachedAt: hit.at };
            onProgress?.(c);
            return c;
          }
        }
        let auto: CheckResult | null = null;
        if (m.id === "diskv" || m.id === "uvo") await ctx.rpoDone; // mená štatutárov (diskvalifikácie), obchodné meno (ÚVO)
        if (m.id === "ov") {
          auto = await checkOv(ctx);
          if (!auto) {
            try {
              auto = await checkOvViaBrowser(ctx);
            } catch (e) {
              m.data = { ...(m.data || {}), autoNote: `prehliadač: ${(e as Error).message.slice(0, 200)}` };
            }
          }
        }
        else if ((PUBLIC_QUERY_IDS as readonly string[]).includes(m.id)) {
          const r = await queryPublicRegister(m.id, ctx);
          auto = r.check;
          // neúspech: stručne prečo (posledný pokus) – zobrazí sa pri manuálnej kontrole a v diagnostike
          if (!auto) {
            const last = r.outcome.attempts[r.outcome.attempts.length - 1];
            m.data = { ...(m.data || {}), autoNote: last ? `${last.info || last.url}: ${last.error || (last.status ? `HTTP ${last.status}` : "")}${last.verdict === "unknown" ? " – výsledok sa nedal vyhodnotiť" : ""}`.slice(0, 300) : undefined };
          }
        }
        if (auto) {
          if (ttl && !ctx.asOf && ["ok", "warning", "critical"].includes(auto.status))
            await kv().set(cacheKey(m.id, ctx.ico), { check: auto, profile: {}, at: new Date().toISOString() } satisfies CachedCheck, ttl).catch(() => undefined);
          onProgress?.(auto);
          return auto;
        }
      } catch (e) {
        // ostáva manuálne; dôvod si zapamätáme pre diagnostiku
        m.data = { ...(m.data || {}), autoError: (e as Error).message.slice(0, 300) };
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
  await invalidateCache(ico, id);
  const ctx: Ctx = { ico, profile: { ...profile, ico } as CompanyProfile, rpoDone: Promise.resolve(), dicReady: Promise.resolve(), resolveDic: () => undefined };
  const check = await fn(ctx);
  return { check, profile: ctx.profile };
}
