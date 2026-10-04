import { createHash } from "node:crypto";
import { audit } from "./audit";
import { kv } from "./auth/kv";

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
  sealedAt: string;
  hash: string;
  verdict: string;
  score: number;
  /** Len meno povereného zamestnanca (bez e-mailu) */
  by: string;
  appVersion?: string;
  /** Kvalifikovaná časová pečiatka (RFC 3161 / eIDAS) – doplní sa po výbere poskytovateľa */
  tsa?: { provider: string; time: string; serial: string; token?: string };
}

const key = (scanId: string) => `seals:${scanId}`;
const MAX = 50;

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
export function protocolDigestInput(p: { scanId: string; ico: string; scannedAt: string; profile: unknown; checks: unknown; verdict: unknown; keyFacts?: unknown; deal?: unknown; contact?: unknown; note?: string; author?: string; appVersion?: string }) {
  return {
    scanId: p.scanId,
    ico: p.ico,
    scannedAt: p.scannedAt,
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

export async function sealProtocol(input: Parameters<typeof protocolDigestInput>[0] & { company?: string; verdictLevel: string; score: number; by: string }): Promise<Seal> {
  if (!SCAN_ID_RE.test(input.scanId)) throw new Error("Neplatné číslo protokolu.");
  const hash = sha256(canonical(protocolDigestInput(input)));
  const existing = await kv().lrange<Seal>(key(input.scanId), 0, MAX - 1);
  const same = existing.find((s) => s.hash === hash);
  if (same) return same; // rovnaký obsah už zapečatený – vraciame pôvodný čas
  const seal: Seal = {
    scanId: input.scanId,
    seq: existing.length + 1,
    ico: input.ico,
    company: input.company,
    scannedAt: input.scannedAt,
    sealedAt: new Date().toISOString(),
    hash,
    verdict: input.verdictLevel,
    score: input.score,
    by: input.by,
    appVersion: input.appVersion,
  };
  await kv().lpush(key(input.scanId), seal, MAX);
  await audit({ type: "protocol_sealed", by: input.by, ico: input.ico, company: input.company, scanId: input.scanId, detail: `${hash.slice(0, 16)}… #${seal.seq}` });
  return seal;
}

export async function listSeals(scanId: string): Promise<Seal[]> {
  if (!SCAN_ID_RE.test(scanId)) return [];
  const all = await kv().lrange<Seal>(key(scanId), 0, MAX - 1);
  return all.sort((a, b) => a.seq - b.seq);
}

/** Skrátený zápis odtlačku do protokolu: 4 skupiny po 4 znaky z prvých 16 + … + posledné 4 */
export function shortHash(h: string) {
  return `${h.slice(0, 4)} ${h.slice(4, 8)} ${h.slice(8, 12)} ${h.slice(12, 16)} … ${h.slice(-4)}`.toUpperCase();
}
