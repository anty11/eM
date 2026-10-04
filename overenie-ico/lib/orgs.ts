import { randomBytes } from "node:crypto";
import { kv } from "./auth/kv";

/**
 * Firmy (klienti) – každá má vlastný, oddelený priestor dát: používateľov, preverenia, databázu preverených spoločností,
 * karty kontaktov a protokol činností. Používateľ patrí práve do jednej firmy a vidí len jej dáta.
 *
 * Správcovia platformy (prevádzkovateľ) do žiadnej firmy nepatria; vznikajú výlučne cez premennú ADMIN_EMAILS + ADMIN_SETUP_CODE,
 * nikdy cez objednávku ani cez rozhranie aplikácie. Len oni zakladajú firmy, nastavujú balík a počet miest a spravujú používateľov
 * (firmy si používateľov samy nespravujú).
 */
export type OrgMode = "firma" | "advokat"; // Štandard | Rozšírené (identifikátory ostávajú kvôli uloženým údajom)

export interface Org {
  id: string;
  name: string;
  ico?: string;
  /** Balík: firma = Štandard, advokat = Rozšírené */
  mode: OrgMode;
  /** Počet používateľských miest podľa zakúpeného balíka */
  seats: number;
  disabled?: boolean;
  note?: string;
  /** Číslo objednávky, z ktorej firma vznikla */
  orderId?: string;
  createdAt: string;
  createdBy: string;
  updatedAt?: string;
}

/** Firma, do ktorej sa pri prechode na viacfiremný režim presunú doterajšie (testovacie) dáta. */
export const LEGACY_ORG = "test";

const ORGS = "orgs";
const okey = (id: string) => `org:${id}`;
const MIGRATED = "orgs:migrated";

export class OrgError extends Error {
  constructor(message: string, public status = 400) {
    super(message);
  }
}

const ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789";
export function newOrgId(): string {
  return Array.from(randomBytes(8), (x) => ALPHABET[x % ALPHABET.length]).join("");
}
export const ORG_ID_RE = /^[a-z0-9]{3,16}$/;

/** Kľúč dát firmy – jediné miesto, kde sa skladá predpona; všetky moduly ho používajú. */
export function orgKey(orgId: string, suffix: string): string {
  if (!ORG_ID_RE.test(orgId)) throw new OrgError("Neplatný identifikátor firmy.", 400);
  return `org:${orgId}:${suffix}`;
}

export async function getOrg(id: string): Promise<Org | null> {
  if (!id || !ORG_ID_RE.test(id)) return null;
  return kv().get<Org>(okey(id));
}

export async function listOrgs(): Promise<Org[]> {
  const ids = await kv().smembers(ORGS);
  const orgs = (await Promise.all(ids.map((id) => getOrg(id)))).filter(Boolean) as Org[];
  return orgs.sort((a, b) => a.name.localeCompare(b.name, "sk"));
}

async function save(o: Org) {
  await kv().set(okey(o.id), o);
  await kv().sadd(ORGS, o.id);
}

const str = (v: unknown, max: number) => String(v ?? "").trim().slice(0, max);

export async function createOrg(input: { name: string; ico?: string; mode?: OrgMode; seats?: number; note?: string; orderId?: string; id?: string }, by: string): Promise<Org> {
  const name = str(input.name, 120);
  if (name.length < 2) throw new OrgError("Zadajte názov firmy.");
  const ico = str(input.ico, 8).replace(/\D/g, "");
  if (ico && !/^\d{6,8}$/.test(ico)) throw new OrgError("IČO musí mať 6 – 8 číslic.");
  const seats = Math.max(1, Math.min(500, Math.floor(Number(input.seats ?? 3)) || 3));
  let id = str(input.id, 16).toLowerCase();
  if (id) {
    if (!ORG_ID_RE.test(id)) throw new OrgError("Identifikátor môže obsahovať len malé písmená a číslice (3 – 16 znakov).");
    if (await getOrg(id)) throw new OrgError("Firma s týmto identifikátorom už existuje.", 409);
  } else {
    do id = newOrgId(); while (await getOrg(id));
  }
  const o: Org = {
    id,
    name,
    ico: ico || undefined,
    mode: input.mode === "advokat" ? "advokat" : "firma",
    seats,
    note: str(input.note, 500) || undefined,
    orderId: str(input.orderId, 40) || undefined,
    createdAt: new Date().toISOString(),
    createdBy: by,
  };
  await save(o);
  return o;
}

export async function updateOrg(id: string, change: Partial<Pick<Org, "name" | "ico" | "mode" | "seats" | "disabled" | "note">>): Promise<Org> {
  const o = await getOrg(id);
  if (!o) throw new OrgError("Firma neexistuje.", 404);
  if (change.name !== undefined) {
    const name = str(change.name, 120);
    if (name.length < 2) throw new OrgError("Zadajte názov firmy.");
    o.name = name;
  }
  if (change.ico !== undefined) {
    const ico = str(change.ico, 8).replace(/\D/g, "");
    if (ico && !/^\d{6,8}$/.test(ico)) throw new OrgError("IČO musí mať 6 – 8 číslic.");
    o.ico = ico || undefined;
  }
  if (change.mode) o.mode = change.mode === "advokat" ? "advokat" : "firma";
  if (change.seats !== undefined) o.seats = Math.max(1, Math.min(500, Math.floor(Number(change.seats)) || o.seats));
  if (change.disabled !== undefined) o.disabled = Boolean(change.disabled);
  if (change.note !== undefined) o.note = str(change.note, 500) || undefined;
  o.updatedAt = new Date().toISOString();
  await save(o);
  return o;
}

/**
 * Jednorazový prechod na viacfiremný režim: založí firmu LEGACY_ORG a doterajšie dáta (používatelia bez firmy, databáza preverení,
 * karty kontaktov, protokol činností) sa k nej priradia – používatelia zápisom, ostatné moduly čítajú pre túto firmu aj pôvodné kľúče.
 */
export async function ensureLegacyOrg(hasLegacyUsers: () => Promise<boolean>, assignUsers: (orgId: string) => Promise<void>): Promise<void> {
  if (await kv().get(MIGRATED)) return;
  // Firma pre doterajšie dáta vznikne len vtedy, keď nejaké sú (používatelia bez firmy alebo pôvodná databáza preverení / protokol)
  const legacyData = (await hasLegacyUsers()) || Object.keys(await kv().hgetall("companies")).length > 0 || (await kv().lrange("audit", 0, 0)).length > 0;
  if (!legacyData) {
    await kv().set(MIGRATED, new Date().toISOString());
    return;
  }
  if (!(await getOrg(LEGACY_ORG))) {
    await createOrg({ id: LEGACY_ORG, name: "Obozretne – test", mode: "advokat", seats: 10, note: "Firma vytvorená automaticky pri prechode na viacfiremný režim; obsahuje doterajšie testovacie dáta." }, "system");
  }
  await assignUsers(LEGACY_ORG);
  await kv().set(MIGRATED, new Date().toISOString());
}

/** Verzia rozhrania pre používateľa: podľa balíka firmy; správca platformy má Rozšírené (na testovanie všetkého). */
export function effectiveMode(org: Org | null | undefined, isPlatformAdmin: boolean): OrgMode {
  if (isPlatformAdmin) return "advokat";
  return org?.mode === "advokat" ? "advokat" : "firma";
}
