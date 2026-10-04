import { listAudit } from "./audit";
import { kv } from "./auth/kv";
import { STALE_DAYS, daysSince } from "./ago";

export { STALE_DAYS, daysSince, agoLabel } from "./ago";

/**
 * Databáza už preverených spoločností – jeden záznam na IČO s posledným preverením.
 * Zdieľa ju celá kancelária: ak kolega preveril firmu pred týždňom, netreba to robiť znova.
 * Po 180 dňoch sa záznam označí ako zastaraný (odporúčané opakované preverenie).
 */
export interface CompanyRecord {
  ico: string;
  name: string;
  /** Posledné preverenie */
  lastAt: string;
  lastBy: string;
  verdict: string;
  score: number;
  scanId: string;
  /** Prvé preverenie a počet preverení */
  firstAt: string;
  count: number;
}

const KEY = "companies";
const SEEDED = "companies:seeded";

export async function recordScan(e: {
  ico: string;
  name?: string;
  by: string;
  verdict: string;
  score: number;
  scanId: string;
  at?: string;
}) {
  try {
    await seedFromAudit();
    await write(e);
  } catch (err) {
    console.error("záznam spoločnosti zlyhal", err);
  }
}

async function write(e: {
  ico: string;
  name?: string;
  by: string;
  verdict: string;
  score: number;
  scanId: string;
  at?: string;
}) {
  const at = e.at || new Date().toISOString();
  const prevRaw = await kv().hget(KEY, e.ico);
  const prev = prevRaw ? (JSON.parse(prevRaw) as CompanyRecord) : null;
  const rec: CompanyRecord = {
    ico: e.ico,
    name: e.name || prev?.name || "",
    lastAt: prev && prev.lastAt > at ? prev.lastAt : at,
    lastBy: prev && prev.lastAt > at ? prev.lastBy : e.by,
    verdict: prev && prev.lastAt > at ? prev.verdict : e.verdict,
    score: prev && prev.lastAt > at ? prev.score : e.score,
    scanId: prev && prev.lastAt > at ? prev.scanId : e.scanId,
    firstAt: prev && prev.firstAt < at ? prev.firstAt : at,
    count: (prev?.count || 0) + 1,
  };
  await kv().hset(KEY, { [e.ico]: JSON.stringify(rec) });
}

/** Jednorazovo doplní databázu zo starších záznamov auditu (preverenia pred zavedením databázy). Volá sa pred každým zápisom aj čítaním. */
let seeding: Promise<void> | null = null;
async function seedFromAudit() {
  if (await kv().get(SEEDED)) return;
  if (!seeding) seeding = doSeed().finally(() => (seeding = null));
  return seeding;
}
async function doSeed() {
  await kv().set(SEEDED, new Date().toISOString());
  const scans = await listAudit({ type: "scan", limit: 5000 });
  for (const s of scans.reverse()) {
    if (!s.ico || s.verdict === "not_found") continue; // nenájdené IČO do databázy nepatrí
    await write({
      ico: s.ico,
      name: s.company,
      by: s.by,
      verdict: s.verdict || "",
      score: s.score ?? 0,
      scanId: s.scanId || "",
      at: s.at,
    });
  }
  await kv().set(SEEDED, new Date().toISOString());
}

export async function listCompanies(
  opts: { by?: string } = {},
): Promise<(CompanyRecord & { days: number; stale: boolean })[]> {
  await seedFromAudit();
  const all = Object.values(await kv().hgetall(KEY)).map(
    (v) => JSON.parse(v) as CompanyRecord,
  );
  const now = Date.now();
  return all
    .filter((c) => !opts.by || c.lastBy === opts.by)
    .map((c) => {
      const days = daysSince(c.lastAt, now);
      return { ...c, days, stale: days > STALE_DAYS };
    })
    .sort((a, b) => (a.lastAt < b.lastAt ? 1 : -1));
}

export async function removeCompany(ico: string) {
  await kv().hdel(KEY, ico);
}
