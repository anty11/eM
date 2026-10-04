import { listAudit } from "./audit";
import { kv } from "./auth/kv";
import { STALE_DAYS, daysSince } from "./ago";
import { LEGACY_ORG, orgKey } from "./orgs";

export { STALE_DAYS, daysSince, agoLabel } from "./ago";

/**
 * Databáza už preverených spoločností – jeden záznam na IČO s posledným preverením, oddelene pre každú firmu (orgId).
 * Zdieľajú ju kolegovia v rámci firmy: ak kolega preveril partnera pred týždňom, netreba to robiť znova.
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

const LEGACY_KEY = "companies";
const KEY = (orgId: string) => orgKey(orgId, "companies");
const SEEDED = (orgId: string) => orgKey(orgId, "companies:seeded");

export async function recordScan(orgId: string, e: {
  ico: string;
  name?: string;
  by: string;
  verdict: string;
  score: number;
  scanId: string;
  at?: string;
}) {
  try {
    await seedFromAudit(orgId);
    await write(orgId, e);
  } catch (err) {
    console.error("záznam spoločnosti zlyhal", err);
  }
}

async function write(orgId: string, e: {
  ico: string;
  name?: string;
  by: string;
  verdict: string;
  score: number;
  scanId: string;
  at?: string;
}) {
  const at = e.at || new Date().toISOString();
  const prevRaw = await kv().hget(KEY(orgId), e.ico);
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
  await kv().hset(KEY(orgId), { [e.ico]: JSON.stringify(rec) });
}

/**
 * Jednorazové doplnenie databázy firmy: z jej protokolu činností (preverenia pred zavedením databázy) a pre firmu LEGACY_ORG
 * aj z pôvodnej spoločnej databázy spred viacfiremného režimu. Volá sa pred každým zápisom aj čítaním (po prvý raz niečo urobí).
 */
const seeding = new Map<string, Promise<void>>();
async function seedFromAudit(orgId: string) {
  if (await kv().get(SEEDED(orgId))) return;
  let p = seeding.get(orgId);
  if (!p) {
    p = doSeed(orgId).finally(() => seeding.delete(orgId));
    seeding.set(orgId, p);
  }
  return p;
}
async function doSeed(orgId: string) {
  await kv().set(SEEDED(orgId), new Date().toISOString());
  if (orgId === LEGACY_ORG) {
    for (const v of Object.values(await kv().hgetall(LEGACY_KEY))) {
      const c = JSON.parse(v) as CompanyRecord;
      await kv().hset(KEY(orgId), { [c.ico]: JSON.stringify(c) });
    }
  }
  const scans = await listAudit({ orgId, type: "scan", limit: 5000 });
  for (const s of scans.reverse()) {
    if (!s.ico || s.verdict === "not_found") continue; // nenájdené IČO do databázy nepatrí
    await write(orgId, {
      ico: s.ico,
      name: s.company,
      by: s.by,
      verdict: s.verdict || "",
      score: s.score ?? 0,
      scanId: s.scanId || "",
      at: s.at,
    });
  }
  await kv().set(SEEDED(orgId), new Date().toISOString());
}

export async function listCompanies(
  orgId: string,
  opts: { by?: string } = {},
): Promise<(CompanyRecord & { days: number; stale: boolean })[]> {
  await seedFromAudit(orgId);
  const all = Object.values(await kv().hgetall(KEY(orgId))).map(
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

export async function removeCompany(orgId: string, ico: string) {
  await kv().hdel(KEY(orgId), ico);
}
