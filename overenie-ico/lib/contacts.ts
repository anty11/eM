import { audit } from "./audit";
import { kv } from "./auth/kv";
import { LEGACY_ORG, orgKey } from "./orgs";

/**
 * Kontaktná karta partnera (podľa IČO): s kým u partnera komunikujeme a kto z našich zamestnancov je za neho zodpovedný.
 * Ukladá sa oddelene pre každú firmu (orgId), zdieľajú ju kolegovia v rámci firmy a zobrazí sa pri každom ďalšom preverení toho istého IČO.
 */
export interface Contact {
  ico: string;
  /** Zaškrtnutie „komunikujeme s týmto partnerom“. */
  active: boolean;
  personName: string;
  personRole: string;
  phone: string;
  email: string;
  /** Kontaktná osoba je zapísaná v obchodnom registri ako štatutár (zaškrtne používateľ, systém navrhne). */
  isStatutory: boolean;
  /** Identita kontaktnej osoby bola overená (napr. osobne, podpisom, cez oficiálny e-mail). */
  identityVerified: boolean;
  /** Oprávnenie konať za spoločnosť je doložené (plná moc / poverenie), ak kontaktná osoba nie je štatutár – indikátor (v) SKDP 03/2024. */
  authorityVerified: boolean;
  /** Zodpovední zamestnanci (e-maily používateľov aplikácie). */
  owners: string[];
  note: string;
  updatedAt: string;
  updatedBy: string;
}

const key = (orgId: string, ico: string) => orgKey(orgId, `contact:${ico}`);
const legacyKey = (ico: string) => `contact:${ico}`;
const str = (v: unknown, max: number) => String(v ?? "").trim().slice(0, max);

export async function getContact(orgId: string, ico: string): Promise<Contact | null> {
  const c = await kv().get<Contact>(key(orgId, ico));
  if (c || orgId !== LEGACY_ORG) return c;
  return kv().get<Contact>(legacyKey(ico)); // karty spred viacfiremného režimu
}

export async function saveContact(orgId: string, ico: string, input: Partial<Contact>, by: string, allowedOwners: string[]): Promise<Contact> {
  const email = str(input.email, 120);
  if (email && !/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(email)) throw new Error("Neplatný e-mail kontaktnej osoby.");
  const phone = str(input.phone, 40);
  if (phone && !/^[+\d][\d\s/()-]{5,}$/.test(phone)) throw new Error("Neplatné telefónne číslo.");
  const owners = [...new Set((input.owners || []).map((o) => str(o, 120).toLowerCase()))].filter((o) => allowedOwners.includes(o));
  const c: Contact = {
    ico,
    active: Boolean(input.active),
    personName: str(input.personName, 120),
    personRole: str(input.personRole, 120),
    phone,
    email,
    isStatutory: Boolean(input.isStatutory),
    identityVerified: Boolean(input.identityVerified),
    authorityVerified: Boolean(input.authorityVerified),
    owners,
    note: str(input.note, 2000),
    updatedAt: new Date().toISOString(),
    updatedBy: by,
  };
  await kv().set(key(orgId, ico), c);
  await audit({
    type: "contact_saved",
    by,
    orgId,
    ico,
    detail: [c.active ? "komunikujeme" : "nekomunikujeme", c.personName, c.phone, c.email, owners.length ? `zodpovední: ${owners.join(", ")}` : ""]
      .filter(Boolean)
      .join(" · "),
  });
  return c;
}
