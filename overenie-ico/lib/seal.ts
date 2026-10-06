import { createHash, randomBytes } from "node:crypto";
import { gunzipSync, gzipSync } from "node:zlib";
import { audit } from "./audit";
import { kv } from "./auth/kv";
import { orgKey } from "./orgs";

/**
 * Odtlačok protokolu (SHA-256) a jeho zápis na serveri = overiteľná časová stopa prvej úrovne.
 * Pri uložení PDF klient pošle konečný obsah protokolu (vrátane manuálnych overení, údajov o obchode a poznámky);
 * server vypočíta odtlačok z kanonického JSON, zapíše ho s časom do databázy a vráti ho. Protokol odtlačok vytlačí
 * spolu s adresou verejnej overovacej stránky /overit/<číslo protokolu>, kde si ktokoľvek overí, že protokol
 * s týmto odtlačkom a časom v systéme vznikol. Pripravené na doplnenie kvalifikovanej časovej pečiatky (eIDAS) – pole `tsa`.
 */
export interface Seal {
  scanId: string;
  /** Poradie pečate v rámci protokolu (opakovaná tlač po zmene = nová pečať) */
  seq: number;
  ico: string;
  company?: string;
  scannedAt: string;
  /** Spätné preverenie – rozhodný dátum začiatku spolupráce */
  asOf?: string;
  sealedAt: string;
  hash: string;
  verdict: string;
  score: number;
  /** Len meno povereného zamestnanca (bez e-mailu) */
  by: string;
  /** Firma, ktorá preverenie vykonala (názov sa zobrazuje na overovacej stránke) */
  orgId?: string;
  orgName?: string;
  /** Náhodný overovací kód (rovnaký pre všetky pečate protokolu) – bez neho overovacia stránka nič neukáže, číslo protokolu je totiž uhádnuteľné */
  code: string;
  appVersion?: string;
  /** Kvalifikovaná časová pečiatka (RFC 3161 / eIDAS) – doplní sa po výbere poskytovateľa */
  tsa?: { provider: string; time: string; serial: string; token?: string };
}

const key = (scanId: string) => `seals:${scanId}`;
const codeKey = (scanId: string) => `sealcode:${scanId}`;
/** Ktorej firme číslo protokolu patrí – iná firma s rovnakým číslom (ten istý partner v tej istej sekunde) pečať nedostane. */
const ownerKey = (scanId: string) => `sealorg:${scanId}`;
const MAX = 50;
/** Zapečatený obsah protokolu (kanonický JSON, gzip + base64) – presne to, z čoho sa počítal odtlačok; ~5–15 kB na pečať. */
const docKey = (scanId: string, seq: number) => `sealdoc:${scanId}:${seq}`;
/** Archív pečatí firmy (najnovšie prvé) – číslo, kód, dátum, verdikt; bez obsahu protokolu. */
const archiveKey = (orgId: string) => orgKey(orgId, "seals");
const ARCHIVE_MAX = 10000;
/** Strop veľkosti uloženého obsahu (komprimovaný) – väčší protokol sa zapečatí, ale obsah sa neuloží. */
const DOC_MAX_BYTES = 400_000;

export interface ArchiveEntry {
  scanId: string;
  seq: number;
  code: string;
  sealedAt: string;
  scannedAt: string;
  ico: string;
  company?: string;
  verdict: string;
  score: number;
  by: string;
  hash: string;
  /** obsah protokolu je uložený a dá sa znova otvoriť */
  stored: boolean;
}

/** 10 znakov z abecedy bez zameniteľných znakov (0/O, 1/I/L) – do PDF a do adresy */
const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
export function newCode(): string {
  const b = randomBytes(10);
  return Array.from(b, (x) => ALPHABET[x % ALPHABET.length]).join("");
}
export const CODE_RE = /^[A-Z2-9]{10}$/;
export const normalizeCode = (c: string) => (c || "").toUpperCase().replace(/[^A-Z0-9]/g, "").replace(/0/g, "O").replace(/1/g, "I");

async function codeFor(scanId: string): Promise<string> {
  const existing = await kv().get<string>(codeKey(scanId));
  if (existing) return existing;
  const c = newCode();
  await kv().set(codeKey(scanId), c);
  return c;
}

/** Kanonický JSON: zoradené kľúče, bez undefined – rovnaký obsah dá vždy rovnaký reťazec. */
export function canonical(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v ?? null);
  if (Array.isArray(v)) return `[${v.map(canonical).join(",")}]`;
  const o = v as Record<string, unknown>;
  const keys = Object.keys(o)
    .filter((k) => o[k] !== undefined)
    .sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonical(o[k])}`).join(",")}}`;
}

export function sha256(s: string): string {
  return createHash("sha256").update(s, "utf8").digest("hex");
}

/** Z obsahu protokolu vyberie len to, čo sa tlačí a hodnotí – bez prechodných polí (pending, ai metadáta nemenia obsah). */
export function protocolDigestInput(p: { scanId: string; ico: string; scannedAt: string; asOf?: string; profile: unknown; checks: unknown; verdict: unknown; keyFacts?: unknown; deal?: unknown; contact?: unknown; note?: string; author?: string; appVersion?: string }) {
  return {
    scanId: p.scanId,
    ico: p.ico,
    scannedAt: p.scannedAt,
    asOf: p.asOf ?? null,
    profile: p.profile,
    checks: p.checks,
    verdict: p.verdict,
    keyFacts: p.keyFacts ?? null,
    deal: p.deal ?? null,
    contact: p.contact ?? null,
    note: p.note ?? "",
    author: p.author ?? "",
    appVersion: p.appVersion ?? "",
  };
}

export const SCAN_ID_RE = /^SK-\d{6,8}-\d{14}$/;

export async function sealProtocol(input: Parameters<typeof protocolDigestInput>[0] & { company?: string; verdictLevel: string; score: number; by: string; orgId: string; orgName?: string }): Promise<Seal> {
  if (!SCAN_ID_RE.test(input.scanId)) throw new Error("Neplatné číslo protokolu.");
  const owner = await kv().get<string>(ownerKey(input.scanId));
  if (owner && owner !== input.orgId) throw new Error("Číslo protokolu už patrí inému prevereniu – spustite preverenie znova.");
  if (!owner) await kv().set(ownerKey(input.scanId), input.orgId);
  const canonicalJson = canonical(protocolDigestInput(input));
  const hash = sha256(canonicalJson);
  const existing = await kv().lrange<Seal>(key(input.scanId), 0, MAX - 1);
  const code = await codeFor(input.scanId);
  const same = existing.find((s) => s.hash === hash);
  if (same) return { ...same, code }; // rovnaký obsah už zapečatený – vraciame pôvodný čas
  const seal: Seal = {
    scanId: input.scanId,
    seq: existing.length + 1,
    ico: input.ico,
    company: input.company,
    scannedAt: input.scannedAt,
    asOf: input.asOf,
    sealedAt: new Date().toISOString(),
    hash,
    verdict: input.verdictLevel,
    score: input.score,
    by: input.by,
    orgId: input.orgId,
    orgName: input.orgName,
    code,
    appVersion: input.appVersion,
  };
  await kv().lpush(key(input.scanId), seal, MAX);
  // obsah protokolu (kanonický JSON) – komprimovaný; z neho sa protokol dá znova otvoriť a odtlačok prepočítať
  let stored = false;
  try {
    const packed = gzipSync(Buffer.from(canonicalJson, "utf8"), { level: 9 }).toString("base64");
    if (packed.length <= DOC_MAX_BYTES) {
      await kv().set(docKey(input.scanId, seal.seq), packed);
      stored = true;
    }
  } catch (e) {
    console.error("uloženie obsahu protokolu zlyhalo", e);
  }
  await kv()
    .lpush(archiveKey(input.orgId), toEntry(seal, stored), ARCHIVE_MAX)
    .catch((e) => console.error("archív pečatí zlyhal", e));
  await audit({ type: "protocol_sealed", by: input.by, orgId: input.orgId, ico: input.ico, company: input.company, scanId: input.scanId, detail: `${hash.slice(0, 16)}… #${seal.seq}` });
  return seal;
}

/** Pečate protokolu – len so správnym overovacím kódom; inak prázdny zoznam (nerozlišuje „neexistuje“ a „zlý kód“). */
export async function listSeals(scanId: string, code: string): Promise<Seal[]> {
  if (!SCAN_ID_RE.test(scanId) || !CODE_RE.test(code)) return [];
  const real = await kv().get<string>(codeKey(scanId));
  if (!real || real !== code) return [];
  const all = await kv().lrange<Seal>(key(scanId), 0, MAX - 1);
  return all.sort((a, b) => a.seq - b.seq).map((s) => ({ ...s, code }));
}

/** Obmedzenie pokusov o uhádnutie kódu: 20 za hodinu z jednej adresy. */
export async function verifyRateLimited(ip: string): Promise<boolean> {
  const n = await kv().incr(`rl:verify:${ip}`, 3600);
  return n > 20;
}

export { shortHash } from "./seal-shared";

const toEntry = (s: Seal, stored: boolean): ArchiveEntry => ({
  scanId: s.scanId,
  seq: s.seq,
  code: s.code,
  sealedAt: s.sealedAt,
  scannedAt: s.scannedAt,
  ico: s.ico,
  company: s.company,
  verdict: s.verdict,
  score: s.score,
  by: s.by,
  hash: s.hash,
  stored,
});

/**
 * Archív zapečatených protokolov firmy (najnovšie prvé). Pečate spred zavedenia archívu sa doplnia raz z auditu
 * (udalosti „Pečať protokolu“) – ich obsah uložený nie je (stored = false).
 */
export async function listArchive(orgId: string, limit = 500): Promise<ArchiveEntry[]> {
  const take = Math.min(Math.max(limit, 1), ARCHIVE_MAX);
  let rows = await kv().lrange<ArchiveEntry>(archiveKey(orgId), 0, take - 1);
  const seededKey = orgKey(orgId, "seals:seeded");
  if (!(await kv().get<string>(seededKey))) {
    const { listAudit } = await import("./audit");
    const events = await listAudit({ orgId, type: "protocol_sealed", limit: 5000 });
    const have = new Set(rows.map((r) => `${r.scanId}#${r.seq}`));
    const old: ArchiveEntry[] = [];
    for (const scanId of Array.from(new Set(events.map((e) => e.scanId).filter(Boolean) as string[]))) {
      const owner = await kv().get<string>(ownerKey(scanId));
      if (owner && owner !== orgId) continue;
      const code = (await kv().get<string>(codeKey(scanId))) || "";
      for (const s of await kv().lrange<Seal>(key(scanId), 0, MAX - 1)) {
        if (have.has(`${scanId}#${s.seq}`)) continue;
        const storedDoc = await kv().get<string>(docKey(scanId, s.seq));
        old.push(toEntry({ ...s, code }, Boolean(storedDoc)));
      }
    }
    // staršie pečate na koniec zoznamu (archív je od najnovších)
    for (const e of old.sort((a, b) => (a.sealedAt < b.sealedAt ? 1 : -1))) await kv().lpush(archiveKey(orgId), e, ARCHIVE_MAX).catch(() => {});
    await kv().set(seededKey, "1");
    rows = await kv().lrange<ArchiveEntry>(archiveKey(orgId), 0, take - 1);
  }
  return rows.sort((a, b) => (a.sealedAt < b.sealedAt ? 1 : -1));
}

/**
 * Uložený obsah zapečateného protokolu – len pre firmu, ktorej protokol patrí. Odtlačok sa prepočíta z uloženého obsahu
 * (`intact` = obsah sa od zapečatenia nezmenil).
 */
export async function getSealedDoc(orgId: string, scanId: string, seq: number): Promise<{ seal: Seal; doc: Record<string, any>; intact: boolean } | null> {
  if (!SCAN_ID_RE.test(scanId) || !Number.isInteger(seq) || seq < 1) return null;
  const owner = await kv().get<string>(ownerKey(scanId));
  if (owner !== orgId) return null;
  const seal = (await kv().lrange<Seal>(key(scanId), 0, MAX - 1)).find((s) => s.seq === seq);
  const packed = await kv().get<string>(docKey(scanId, seq));
  if (!seal || !packed) return null;
  const json = gunzipSync(Buffer.from(packed, "base64")).toString("utf8");
  const code = (await kv().get<string>(codeKey(scanId))) || "";
  return { seal: { ...seal, code }, doc: JSON.parse(json), intact: sha256(json) === seal.hash };
}
