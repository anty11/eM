import { icoChecksumValid } from "./ico";
import { icoStore } from "./check";
import { computeVerdict } from "./scoring";
import { keyFacts } from "./keyfacts";
import { checkExcise, checkIds, checkIncomeTax, checkTaxDebtors, checkVat } from "./sources/fs";
import { checkInsolvency } from "./sources/insolvency";
import { manualChecks } from "./sources/manual";
import { checkOv } from "./sources/ov";
import { checkExek } from "./sources/exek";
import { checkDoveraViaFirmapi } from "./sources/firmapi";
import { getFirmapiKey } from "./access";
import { logError } from "./errlog";
import { checkOvViaBrowser, ovSearchLog, PUBLIC_QUERY_IDS, queryPublicRegister } from "./sources/public";
import { kv } from "./auth/kv";
import { checkNews } from "./sources/news";
import { checkRpo } from "./sources/rpo";
import { checkRpvs } from "./sources/rpvs";
import { checkRuz } from "./sources/ruz";
import { checkSocpoist } from "./sources/socpoist";
import type { CheckResult, CompanyProfile, Ctx, ScanReport, SearchLog } from "./types";
import { META } from "./sources/meta";

export const APP_VERSION = "2.11.27";

/** Celkový časový limit preverenia – čo nestihne, označí sa ako „zdroj neodpovedal“ (dá sa doplniť cez AI / znova). */
const DEADLINE_MS = 25000;
/** Dlhší limit pre zdroje, ktoré idú cez prehliadač na serveri (spotrebné dane na webe FS) – v rámci limitu registrov bez API (55 s). */
const DEADLINE_BY_ID: Record<string, number> = { "fs-excise": 50000 };
/** Len informačné zdroje: po limite „informácia – nepodarilo sa overiť“, nie chyba (neobjavia sa v zozname na manuálne overenie). */
const INFO_ONLY_IDS = ["fs-excise"];
/** Registre bez API (vrátane dopytu cez prehliadač na serveri – spustenie Chromia a hľadanie trvá 5 – 15 s) majú vlastný, dlhší limit. */
/** Limit pre registre bez API (MANUAL_DEADLINE_MS len pre testy). */
const manualDeadlineMs = () => Number(process.env.MANUAL_DEADLINE_MS) || 55000;

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
  // „info“ sa ukladá len pri jednoznačnom výsledku registra (data.definitive) – nie pri nezistiteľnom stave (napr. zablokované médiá)
  if (!ctx.asOf && (["ok", "warning", "critical"].includes(check.status) || (check.status === "info" && (check.data as any)?.definitive)) && !ctx.profile.notFound) {
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
  return icoStore.run(ico, () => scanInner(ico, onProgress, opts));
}

async function scanInner(ico: string, onProgress?: Progress, opts: { asOf?: string; fresh?: boolean; scannedAt?: string } = {}): Promise<ScanReport> {
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
  const capRaw = (id: string, p: Promise<CheckResult>): Promise<CheckResult> => {
    let settled = false;
    p.then(() => (settled = true), () => (settled = true));
    const limit = DEADLINE_BY_ID[id] || DEADLINE_MS;
    return Promise.race([
      p,
      sleep(Math.max(1000, limit - (Date.now() - t0))).then((): CheckResult => {
        if (!settled) void logError({ kind: "deadline", source: id, ico, message: `zdroj neodpovedal do ${Math.round(limit / 1000)} s (limit preverenia)`, ms: limit, where: "scan" });
        return {
        id,
        ...META[id],
        status: INFO_ONLY_IDS.includes(id) ? "info" : "error",
        summary: INFO_ONLY_IDS.includes(id) ? `Informácia – zdroj neodpovedal do ${Math.round(limit / 1000)} s, údaj sa nepodarilo overiť (bez vplyvu na hodnotenie). Overte v zdroji.` : `Zdroj neodpovedal do ${Math.round(limit / 1000)} s. Skúste „Preveriť znova“ alebo overte v zdroji.`,
        findings: [],
        checkedAt: new Date().toISOString(),
        durationMs: Date.now() - t0,
        automated: true,
        verifyUrl: META[id].sourceUrl,
      };
      }),
    ]);
  };

  // Všetky zdroje štartujú hneď. Podľa IČO sa pýtajú RÚZ, Sociálna poisťovňa, REPLIK, RPVS a registre bez API; na meno z RPO čakajú
  // len kontroly, ktoré ho potrebujú (FS, médiá, ÚVO, diskvalifikácie) – a najviac 14 s: ak RPO (API ŠÚ SR) odpovedá pomaly,
  // použije sa názov z RÚZ. Pomalý register tak nezdrží ostatné (predtým všetko čakalo na RPO až 25 s pri „0 z 10“).
  const rpoP = run("rpo", checkRpo);
  ctx.rpoDone = rpoP.catch(() => undefined);
  const rpoCapped = capRaw("rpo", rpoP);
  // Registre bez API, ktoré server vie overiť sám (dopyt / index / prehliadač), sa počas pokusu ukazujú ako „Overuje sa…“, nie ako
  // „Overiť manuálne“ – inak sa položka najprv hlási ako manuálna a o chvíľu „sama“ prejde na výsledok (mätie používateľa).
  // Dôvera sa skúša automaticky len s kľúčom FirmAPI – bez neho je rovno manuálna (žiadne „Overuje sa…“, ktoré by sa hneď zmenilo)
  const doveraAuto = Boolean(await getFirmapiKey().catch(() => null));
  for (const m of manualChecks(ctx))
    onProgress?.(AUTO_MANUAL_IDS.includes(m.id) && (m.id !== "dovera" || doveraAuto) ? { ...m, status: "pending", summary: "Overuje sa automaticky…", automated: true } : m, ctx.profile);
  const ruzP = run("ruz", checkRuz);
  ctx.ruzDone = ruzP.catch(() => null);
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
  // výsledky registrov bez API, ako prichádzajú – pri vypršaní limitu sa použijú hotové a len zvyšok ostane manuálny
  const manualDone = new Map<string, CheckResult>();
  const manualP = resolveManual({ ...ctx, rpoDone: nameReady } as Ctx, (c) => onProgress?.(c, ctx.profile), fresh, manualDone);
  const allP = Promise.all([
    cap("rpo", rpoCapped),
    cap("ruz", ruzP),
    cap("fs-debtors", after("fs-debtors", checkTaxDebtors)),
    cap("fs-vat", after("fs-vat", checkVat)),
    cap("fs-ids", after("fs-ids", checkIds)),
    cap("fs-dppo", after("fs-dppo", checkIncomeTax)),
    cap("fs-excise", after("fs-excise", checkExcise)),
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
  const [rpo, ruz, debtors, vat, ids, incomeTax, excise, socpoist, insolvency, rpvs, news] = await allP;
  nameFallback();

  const manual = await Promise.race([
    manualP,
    sleep(Math.max(1000, manualDeadlineMs() - (Date.now() - t0))).then(() =>
      manualChecks(ctx).map(
        (m) => manualDone.get(m.id) || { ...m, durationMs: Date.now() - t0, data: { ...(m.data || {}), autoNote: `register neodpovedal do ${Math.round(manualDeadlineMs() / 1000)} s (časový limit preverenia)` } },
      ),
    ),
  ]);
  const checks: CheckResult[] = [rpo, debtors, vat, ids, incomeTax, excise, socpoist, ruz, insolvency, rpvs, news, ...manual];
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

/** Registre bez API, ktoré sa skúšajú automaticky (ostatné – CRE, Dôvera – sú vždy manuálne). */
export const AUTO_MANUAL_IDS: readonly string[] = [...PUBLIC_QUERY_IDS, "ov", "exek", "dovera"];

/** Manuálne registre: pokus o automatické overenie; neúspech = pôvodná manuálna kontrola. Výsledky sa hlásia priebežne. */
export async function resolveManual(ctx: Ctx, onProgress?: (c: CheckResult) => void, fresh = false, sink?: Map<string, CheckResult>): Promise<CheckResult[]> {
  const base = manualChecks(ctx);
  return Promise.all(
    base.map(async (m) => {
      const r = await resolveOne(m);
      sink?.set(r.id, r);
      return r;
    }),
  );

  async function resolveOne(m: CheckResult): Promise<CheckResult> {
      const t0 = Date.now();
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
              if (!auto) m.search = ovSearchLog(ctx.ico, { url: m.verifyUrl || "", error: "index exportu MS SR nie je k dispozícii a prehliadač na serveri je vypnutý – vyhľadávanie neprebehlo" });
            } catch (e) {
              m.search = (e as Error & { search?: SearchLog[] }).search || ovSearchLog(ctx.ico, { url: m.verifyUrl || "", error: (e as Error).message.slice(0, 200) });
              m.data = { ...(m.data || {}), autoNote: `prehliadač: ${(e as Error).message.slice(0, 200)}` };
            }
          }
        }
        else if (m.id === "dovera") {
          // Dôvera automatizáciu na svojej stránke zakazuje → licencovaný agregátor FirmAPI (keď je kľúč); inak ostáva manuálne
          const r = await checkDoveraViaFirmapi(ctx);
          if (r && r.status !== "manual") auto = r;
          else if (r) {
            m.search = r.search;
            m.summary = r.summary;
            m.data = { ...(m.data || {}), ...(r.data || {}) };
          }
        } else if (m.id === "exek") {
          const r = await checkExek(ctx);
          if (r.status !== "manual") auto = r;
          else {
            m.search = r.search;
            m.summary = r.summary;
            m.data = { ...(m.data || {}), ...(r.data || {}) };
          }
        } else if ((PUBLIC_QUERY_IDS as readonly string[]).includes(m.id)) {
          const r = await queryPublicRegister(m.id, ctx);
          auto = r.check;
          // neúspech: stručne prečo (posledný pokus) – zobrazí sa pri manuálnej kontrole a v diagnostike
          if (!auto) {
            if (r.outcome.search) m.search = r.outcome.search;
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
        // ostáva manuálne; dôvod si zapamätáme pre diagnostiku a do záznamu chýb
        m.data = { ...(m.data || {}), autoError: (e as Error).message.slice(0, 300) };
        void logError({ kind: "error", source: m.id, ico: ctx.ico, message: (e as Error).message, ms: Date.now() - t0, where: "manual" });
      }
      // čas automatického pokusu aj pri neúspechu (záťažová skúška, diagnostika – ktorý register zdržuje)
      return { ...m, durationMs: Date.now() - t0 };
  }
}

const RUNNERS: Record<string, (c: Ctx) => Promise<CheckResult>> = {
  rpo: checkRpo,
  ruz: checkRuz,
  "fs-debtors": checkTaxDebtors,
  "fs-vat": checkVat,
  "fs-ids": checkIds,
  "fs-dppo": checkIncomeTax,
  "fs-excise": checkExcise,
  socpoist: checkSocpoist,
  insolvency: checkInsolvency,
  rpvs: checkRpvs,
  news: checkNews,
  ov: async (c) => (await checkOv(c)) || manualChecks(c).find((m) => m.id === "ov")!,
  exek: checkExek,
  dovera: async (c) => (await checkDoveraViaFirmapi(c)) || manualChecks(c).find((m) => m.id === "dovera")!,
  diskv: async (c) => (await queryPublicRegister("diskv", c)).check || manualChecks(c).find((m) => m.id === "diskv")!,
  uvo: async (c) => (await queryPublicRegister("uvo", c)).check || manualChecks(c).find((m) => m.id === "uvo")!,
  vszp: async (c) => (await queryPublicRegister("vszp", c)).check || manualChecks(c).find((m) => m.id === "vszp")!,
  union: async (c) => (await queryPublicRegister("union", c)).check || manualChecks(c).find((m) => m.id === "union")!,
};

/** Znovu spustí jeden zdroj (napr. po výpadku) s už známym profilom subjektu. */
export async function runOne(ico: string, id: string, profile: Partial<CompanyProfile>, opts: { retry?: boolean } = {}): Promise<{ check: CheckResult; profile: CompanyProfile } | null> {
  const fn = RUNNERS[id];
  if (!fn) return null;
  await invalidateCache(ico, id);
  const ctx: Ctx = { ico, profile: { ...profile, ico } as CompanyProfile, rpoDone: Promise.resolve(), dicReady: Promise.resolve(), resolveDic: () => undefined };
  const t0 = Date.now();
  const check = await icoStore.run(ico, () => fn(ctx));
  // opakovanie zo stránky („Skúsiť znova“): výsledok do záznamu chýb – ukáže, ktoré chyby sú prechodné
  if (opts.retry) void logError({ kind: check.status === "error" ? "retry-fail" : "retry-ok", source: id, ico, message: check.status === "error" ? check.summary.slice(0, 300) : `opakovanie uspelo: ${check.status}`, ms: Date.now() - t0, where: "retry" });
  return { check, profile: ctx.profile };
}
