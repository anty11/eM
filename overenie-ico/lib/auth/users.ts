import { createHash, randomBytes, scrypt as _scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { audit } from "../audit";
import { kv } from "./kv";
import { effectiveMode, ensureLegacyOrg, getOrg, type Org } from "../orgs";

const scrypt = promisify(_scrypt) as (pw: string, salt: Buffer, len: number, opts: object) => Promise<Buffer>;

/** admin = správca platformy (prevádzkovateľ, bez firmy; vzniká len cez ADMIN_EMAILS), user = používateľ firmy */
export type Role = "admin" | "user";
/** Verzia rozhrania: „firma“ = Štandard (verejné registre) alebo „advokat“ = Rozšírené. Určuje ju balík firmy, nie používateľ. */
export type Mode = "firma" | "advokat";
export const defaultMode = (): Mode => (process.env.APP_MODE === "advokat" ? "advokat" : "firma");

export interface User {
  email: string;
  role: Role;
  /** Firma, do ktorej používateľ patrí; správca platformy firmu nemá */
  orgId?: string;
  /** Historické pole – verzia sa odvodzuje z balíka firmy (toPublic) */
  mode?: Mode;
  name?: string;
  passwordHash?: string;
  /** Zvýši sa pri zmene/resete hesla – staré relácie prestanú platiť. */
  pwVer: number;
  disabled?: boolean;
  createdAt: string;
  createdBy: string;
  lastLoginAt?: string;
  invite?: { hash: string; exp: number };
}

export type PublicUser = Omit<User, "passwordHash" | "invite"> & { status: "active" | "invited" | "disabled"; inviteExpires?: string; orgName?: string; orgDisabled?: boolean };

export const MIN_PASSWORD = 10;
const INVITE_DAYS = 7;
const USERS = "users";
const DUMMY = "scrypt$16384$8$1$AAAAAAAAAAAAAAAAAAAAAA==$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";
const ukey = (e: string) => `user:${e}`;

export class AuthError extends Error {
  constructor(message: string, public status = 400) {
    super(message);
  }
}

export const normalizeEmail = (e: string) => (e || "").trim().toLowerCase();
export const validEmail = (e: string) => /^[^\s@,;<>]+@[^\s@,;<>]+\.[a-z]{2,}$/i.test(e);

/** Vytiahne e-maily zo zoznamu (oddelené čiarkou, bodkočiarkou, medzerou alebo novým riadkom; aj „Meno <e-mail>“). */
export function parseEmailList(text: string): string[] {
  const found = (text || "").match(/[^\s@,;<>"'()]+@[^\s@,;<>"'()]+\.[a-z]{2,}/gi) || [];
  return [...new Set(found.map(normalizeEmail))];
}

const adminEmails = () => parseEmailList(process.env.ADMIN_EMAILS || "");

async function hashPassword(pw: string): Promise<string> {
  const salt = randomBytes(16);
  const h = await scrypt(pw, salt, 32, { N: 16384, r: 8, p: 1 });
  return `scrypt$16384$8$1$${salt.toString("base64")}$${h.toString("base64")}`;
}

async function checkPassword(pw: string, stored?: string): Promise<boolean> {
  if (!stored) return false;
  const [alg, N, r, p, salt, hash] = stored.split("$");
  if (alg !== "scrypt") return false;
  const h = await scrypt(pw, Buffer.from(salt, "base64"), 32, { N: +N, r: +r, p: +p });
  const ref = Buffer.from(hash, "base64");
  return h.length === ref.length && timingSafeEqual(h, ref);
}

const sha = (s: string) => createHash("sha256").update(s).digest("hex");
const normCode = (c: string) => (c || "").toUpperCase().replace(/[^A-Z0-9]/g, "");

/** Jednorazový kód (bez zameniteľných znakov), napr. „K7QM-4XTD-9RWP“. */
function newCode(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const b = randomBytes(12);
  const s = Array.from(b, (x) => alphabet[x % alphabet.length]).join("");
  return `${s.slice(0, 4)}-${s.slice(4, 8)}-${s.slice(8, 12)}`;
}

function validatePassword(pw: string, email: string) {
  if (!pw || pw.length < MIN_PASSWORD) throw new AuthError(`Heslo musí mať aspoň ${MIN_PASSWORD} znakov.`);
  const local = email.split("@")[0];
  if (local.length >= 4 && pw.toLowerCase().includes(local)) throw new AuthError("Heslo nesmie obsahovať e-mailovú adresu.");
  if (/^(.)\1+$/.test(pw) || /^(0123456789|1234567890|heslo|password)/i.test(pw)) throw new AuthError("Heslo je príliš jednoduché.");
}

export async function getUser(email: string): Promise<User | null> {
  return kv().get<User>(ukey(normalizeEmail(email)));
}

async function save(u: User) {
  await kv().set(ukey(u.email), u);
  await kv().sadd(USERS, u.email);
}

export function toPublic(u: User, org?: Org | null): PublicUser {
  const { passwordHash, invite, ...rest } = u;
  return {
    ...rest,
    mode: effectiveMode(org, u.role === "admin"),
    orgName: org?.name,
    orgDisabled: org?.disabled || undefined,
    status: u.disabled ? "disabled" : passwordHash ? "active" : "invited",
    inviteExpires: invite && !passwordHash ? new Date(invite.exp).toISOString() : undefined,
  };
}

/** Adresár kolegov jednej firmy (pre výber zodpovedného zamestnanca) – bez citlivých údajov. */
export async function directory(orgId: string): Promise<{ email: string; name?: string }[]> {
  return (await listUsers(orgId)).filter((u) => u.status !== "disabled").map((u) => ({ email: u.email, name: u.name }));
}

async function allUsers(): Promise<User[]> {
  const emails = await kv().smembers(USERS);
  return (await Promise.all(emails.map((e) => getUser(e)))).filter(Boolean) as User[];
}

/** Používatelia: s `orgId` len danej firmy, bez neho všetci (len pre správcu platformy). */
export async function listUsers(orgId?: string): Promise<PublicUser[]> {
  const users = (await allUsers()).filter((u) => (orgId ? u.orgId === orgId : true));
  const orgIds = [...new Set(users.map((u) => u.orgId).filter(Boolean))] as string[];
  const orgs = new Map((await Promise.all(orgIds.map((id) => getOrg(id)))).filter(Boolean).map((o) => [o!.id, o!]));
  return users
    .map((u) => toPublic(u, u.orgId ? orgs.get(u.orgId) : null))
    .sort((a, b) => (a.role === b.role ? a.email.localeCompare(b.email) : a.role === "admin" ? -1 : 1));
}

/** Obsadené miesta firmy – počítajú sa všetci okrem zablokovaných. */
export async function seatsUsed(orgId: string): Promise<number> {
  return (await allUsers()).filter((u) => u.orgId === orgId && !u.disabled).length;
}

/** Prechod na viacfiremný režim: používatelia bez firmy (okrem správcov platformy) sa priradia k firme LEGACY_ORG. */
export async function ensureMigrated() {
  const legacyUsers = async () => (await allUsers()).filter((u) => u.role !== "admin" && !u.orgId);
  await ensureLegacyOrg(async () => (await legacyUsers()).length > 0, async (orgId) => {
    for (const u of await allUsers()) {
      if (u.role !== "admin" && !u.orgId) {
        u.orgId = orgId;
        await save(u);
      }
    }
  });
}

export interface AddResult {
  email: string;
  result: "created" | "exists" | "invalid";
  code?: string;
}

/**
 * Hromadné pridanie používateľov do firmy. Vráti jednorazové kódy na nastavenie hesla (zobrazia sa len raz).
 * Správcov platformy takto pridať nemožno – vznikajú len cez ADMIN_EMAILS; počet miest firmy je obmedzený balíkom.
 */
export async function addUsers(text: string, orgId: string, by: string): Promise<AddResult[]> {
  const org = await getOrg(orgId);
  if (!org) throw new AuthError("Firma neexistuje.", 404);
  if (org.disabled) throw new AuthError("Firma je pozastavená – najprv ju obnovte.", 409);
  const out: AddResult[] = [];
  const emails: string[] = [];
  for (const tok of (text || "").split(/[\s,;]+/)) {
    if (!tok.includes("@")) continue;
    const e = normalizeEmail(tok.replace(/[<>"'()\[\]]/g, ""));
    if (!validEmail(e)) out.push({ email: tok, result: "invalid" });
    else if (!emails.includes(e)) emails.push(e);
  }
  const fresh = [];
  for (const email of emails) {
    if (await getUser(email)) out.push({ email, result: "exists" });
    else fresh.push(email);
  }
  const used = await seatsUsed(orgId);
  if (used + fresh.length > org.seats) {
    throw new AuthError(`Firma ${org.name} má ${org.seats} ${org.seats === 1 ? "miesto" : org.seats < 5 ? "miesta" : "miest"}, obsadených ${used}. Pridať možno ešte ${Math.max(0, org.seats - used)} – rozšírte balík alebo zablokujte nepoužívané účty.`, 409);
  }
  for (const email of fresh) {
    const code = newCode();
    await save({
      email,
      role: "user",
      orgId,
      pwVer: 1,
      createdAt: new Date().toISOString(),
      createdBy: by,
      invite: { hash: sha(normCode(code)), exp: Date.now() + INVITE_DAYS * 864e5 },
    });
    await audit({ type: "user_added", by, target: email, orgId, detail: org.name });
    out.push({ email, result: "created", code });
  }
  return out;
}

/** Nový jednorazový kód; pôvodné heslo prestane platiť a relácie sa odhlásia. */
export async function resetUser(email: string, by: string): Promise<string> {
  const u = await getUser(email);
  if (!u) throw new AuthError("Používateľ neexistuje.", 404);
  const code = newCode();
  u.passwordHash = undefined;
  u.pwVer += 1;
  u.invite = { hash: sha(normCode(code)), exp: Date.now() + INVITE_DAYS * 864e5 };
  await save(u);
  await audit({ type: "user_reset", by, target: u.email, orgId: u.orgId });
  return code;
}

async function adminCount(except?: string) {
  return (await listUsers()).filter((u) => u.role === "admin" && u.status !== "disabled" && u.email !== except).length;
}

/** Úprava používateľa firmy: zablokovanie / odblokovanie, meno. Rola sa nemení – správca platformy vzniká len cez ADMIN_EMAILS. */
export async function updateUser(email: string, change: { disabled?: boolean; name?: string }, by: string) {
  const u = await getUser(email);
  if (!u) throw new AuthError("Používateľ neexistuje.", 404);
  if (u.role === "admin" && change.disabled && normalizeEmail(by) === u.email) throw new AuthError("Nemôžete zablokovať sami seba.");
  if (u.role === "admin" && change.disabled && (await adminCount(u.email)) === 0) throw new AuthError("Musí zostať aspoň jeden aktívny správca platformy.");
  if (change.disabled !== undefined && change.disabled !== !!u.disabled) {
    if (!change.disabled && u.orgId) {
      const org = await getOrg(u.orgId);
      if (org && (await seatsUsed(u.orgId)) >= org.seats) throw new AuthError(`Firma ${org.name} má obsadené všetky miesta (${org.seats}).`, 409);
    }
    u.disabled = change.disabled;
    u.pwVer += 1;
    await audit({ type: change.disabled ? "user_disabled" : "user_enabled", by, target: u.email, orgId: u.orgId });
  }
  if (change.name !== undefined) u.name = change.name.trim().slice(0, 80) || undefined;
  await save(u);
  return toPublic(u, u.orgId ? await getOrg(u.orgId) : null);
}

export async function deleteUser(email: string, by: string) {
  const u = await getUser(email);
  if (!u) throw new AuthError("Používateľ neexistuje.", 404);
  if (normalizeEmail(by) === u.email) throw new AuthError("Nemôžete zmazať sami seba.");
  if (u.role === "admin" && (await adminCount(u.email)) === 0) throw new AuthError("Musí zostať aspoň jeden aktívny správca platformy.");
  await kv().del(ukey(u.email));
  await kv().srem(USERS, u.email);
  await audit({ type: "user_deleted", by, target: u.email, orgId: u.orgId });
}

/** Obmedzenie pokusov: 8 neúspešných pokusov na e-mail / 15 min, 30 na IP / 15 min. */
async function rateLimit(email: string, ip: string) {
  const [a, b] = await Promise.all([kv().incr(`rl:e:${email}`, 900), kv().incr(`rl:ip:${ip}`, 900)]);
  if (a > 8 || b > 30) throw new AuthError("Príliš veľa pokusov. Skúste to znova o 15 minút.", 429);
}
const clearRate = (email: string) => kv().del(`rl:e:${email}`);

export async function login(emailIn: string, password: string, ip: string): Promise<User> {
  const email = normalizeEmail(emailIn);
  await rateLimit(email, ip);
  await ensureMigrated();
  const u = await getUser(email);
  // pri neexistujúcom účte tiež počítame hash, aby sa účty nedali zisťovať podľa času odozvy
  const ok = (await checkPassword(password || "", u?.passwordHash || DUMMY)) && u && !u.disabled && !!u.passwordHash;
  if (!ok || !u) {
    await audit({ type: "login_failed", by: email, detail: ip, orgId: u?.orgId });
    if (u && !u.passwordHash && !u.disabled) throw new AuthError("Heslo ešte nie je nastavené. Použite jednorazový kód od administrátora.", 409);
    throw new AuthError("Nesprávny e-mail alebo heslo.", 401);
  }
  if (u.orgId) {
    const org = await getOrg(u.orgId);
    if (!org || org.disabled) {
      await audit({ type: "login_failed", by: email, detail: `firma pozastavená, ${ip}`, orgId: u.orgId });
      throw new AuthError("Prístup vašej spoločnosti je pozastavený. Obráťte sa na prevádzkovateľa.", 403);
    }
  }
  await clearRate(email);
  u.lastLoginAt = new Date().toISOString();
  await save(u);
  await audit({ type: "login", by: email, detail: ip, orgId: u.orgId });
  return u;
}

/** Prvé nastavenie hesla (alebo po resete) pomocou jednorazového kódu. */
export async function setPasswordWithCode(emailIn: string, code: string, password: string, ip: string): Promise<User> {
  const email = normalizeEmail(emailIn);
  await rateLimit(email, ip);
  await ensureMigrated();
  let u = await getUser(email);
  validatePassword(password, email);

  // Prvý administrátor: e-mail v ADMIN_EMAILS + kód ADMIN_SETUP_CODE (len kým účet neexistuje)
  const setupCode = process.env.ADMIN_SETUP_CODE;
  if (!u && setupCode && setupCode.length >= 8 && adminEmails().includes(email) && normCode(code) === normCode(setupCode)) {
    u = { email, role: "admin", pwVer: 1, createdAt: new Date().toISOString(), createdBy: "ADMIN_EMAILS" };
    await audit({ type: "user_added", by: "system", target: email, detail: "admin (bootstrap)" });
  } else {
    const valid = u && !u.disabled && u.invite && u.invite.exp > Date.now() && u.invite.hash === sha(normCode(code));
    if (!u || !valid) {
      await audit({ type: "login_failed", by: email, detail: `neplatný kód, ${ip}`, orgId: u?.orgId });
      // Kým v aplikácii nie je žiadny používateľ, vysvetlíme presnú príčinu (pomoc pri prvom nastavení).
      if (!u && (await kv().smembers(USERS)).length === 0) {
        const admins = adminEmails();
        const reason = !setupCode
          ? "premenná ADMIN_SETUP_CODE nie je v tomto nasadení nastavená (nastavte ju pre prostredie Production a urobte Redeploy)"
          : setupCode.length < 8
            ? "ADMIN_SETUP_CODE je kratší ako 8 znakov"
            : !admins.length
              ? "premenná ADMIN_EMAILS nie je v tomto nasadení nastavená alebo neobsahuje platný e-mail"
              : !admins.includes(email)
                ? `e-mail ${email} nie je v ADMIN_EMAILS (nastavených adries: ${admins.length})`
                : "kód sa nezhoduje s ADMIN_SETUP_CODE";
        throw new AuthError(`Prvé nastavenie administrátora zlyhalo: ${reason}.`, 401);
      }
      throw new AuthError("Neplatný alebo expirovaný kód. Požiadajte administrátora o nový.", 401);
    }
  }
  u.passwordHash = await hashPassword(password);
  u.invite = undefined;
  u.pwVer += 1;
  u.lastLoginAt = new Date().toISOString();
  await save(u);
  await clearRate(email);
  await audit({ type: "password_set", by: email, orgId: u.orgId });
  return u;
}

export async function changePassword(emailIn: string, oldPw: string, newPw: string): Promise<User> {
  const u = await getUser(emailIn);
  if (!u || !(await checkPassword(oldPw || "", u.passwordHash))) throw new AuthError("Súčasné heslo nie je správne.", 401);
  validatePassword(newPw, u.email);
  u.passwordHash = await hashPassword(newPw);
  u.pwVer += 1;
  await save(u);
  await audit({ type: "password_changed", by: u.email, orgId: u.orgId });
  return u;
}
