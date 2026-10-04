/** Testy oddelenia firiem a prechodu na viacfiremný režim (pamäťové úložisko). Spustenie: npm test */
import assert from "node:assert/strict";
import { audit, listAudit } from "../lib/audit";
import { orgScope, type Actor } from "../lib/auth/guard";
import { kv, useMemoryKV } from "../lib/auth/kv";
import { AuthError, ensureMigrated, getUser, listUsers, seatsUsed } from "../lib/auth/users";
import { listCompanies } from "../lib/companies";
import { getContact } from "../lib/contacts";
import { createOrg, effectiveMode, getOrg, LEGACY_ORG, listOrgs, orgKey, OrgError, updateOrg } from "../lib/orgs";

const rejects = async (fn: () => unknown, re: RegExp) => {
  await assert.rejects(async () => fn(), (e: Error) => re.test(e.message) || (console.error("Neočakávaná chyba:", e.message), false));
};

async function main() {
  useMemoryKV();

  // Dáta spred viacfiremného režimu: správca, používateľ bez firmy, spoločná databáza preverení, karta kontaktu, spoločný protokol
  await kv().set("user:admin@obozretne.sk", { email: "admin@obozretne.sk", role: "admin", pwVer: 1, createdAt: "2026-01-01", createdBy: "ADMIN_EMAILS", passwordHash: "x" });
  await kv().set("user:stary@firma.sk", { email: "stary@firma.sk", role: "user", pwVer: 1, createdAt: "2026-01-01", createdBy: "admin@obozretne.sk", passwordHash: "x" });
  await kv().sadd("users", "admin@obozretne.sk");
  await kv().sadd("users", "stary@firma.sk");
  await kv().hset("companies", { "47244895": JSON.stringify({ ico: "47244895", name: "URBAN & PARTNERS s.r.o.", lastAt: "2026-09-01T10:00:00.000Z", lastBy: "stary@firma.sk", verdict: "recommended", score: 100, scanId: "SK-1", firstAt: "2026-09-01T10:00:00.000Z", count: 1 }) });
  await kv().set("contact:47244895", { ico: "47244895", active: true, personName: "Janko Mrkvička", owners: [], updatedAt: "2026-09-01", updatedBy: "stary@firma.sk" });
  await audit({ type: "scan", by: "stary@firma.sk", ico: "35757442", company: "Stará firma a.s.", verdict: "caution", score: 70, scanId: "SK-2" });
  await audit({ type: "order", by: "web", detail: "objednávka" });

  await ensureMigrated();
  await ensureMigrated(); // opakované volanie nič nepokazí
  const legacy = await getOrg(LEGACY_ORG);
  assert.ok(legacy, "firma pre doterajšie dáta musí vzniknúť");
  assert.equal((await getUser("stary@firma.sk"))!.orgId, LEGACY_ORG, "doterajší používateľ patrí do firmy test");
  assert.equal((await getUser("admin@obozretne.sk"))!.orgId, undefined, "správca platformy do firmy nepatrí");
  const legacyCompanies = await listCompanies(LEGACY_ORG);
  assert.deepEqual(legacyCompanies.map((c) => c.ico).sort(), ["35757442", "47244895"], "pôvodná databáza aj preverenia z pôvodného protokolu sú vo firme test");
  assert.equal((await getContact(LEGACY_ORG, "47244895"))!.personName, "Janko Mrkvička", "pôvodná karta kontaktu je dostupná firme test");
  const legacyLog = await listAudit({ orgId: LEGACY_ORG, limit: 100 });
  assert.ok(legacyLog.some((e) => e.type === "scan"), "pôvodné preverenia sú v protokole firmy test");
  assert.ok(!legacyLog.some((e) => e.type === "order"), "objednávky ostávajú platforme");

  // Nová firma nevidí nič z firmy test
  const b = await createOrg({ name: "Firma B s.r.o.", mode: "firma", seats: 3 }, "admin@obozretne.sk");
  assert.equal((await listCompanies(b.id)).length, 0);
  assert.equal(await getContact(b.id, "47244895"), null);
  assert.equal((await listAudit({ orgId: b.id })).length, 0);
  assert.deepEqual((await listUsers(b.id)).length, 0);
  assert.equal(await seatsUsed(LEGACY_ORG), 1);
  assert.equal((await listOrgs()).length, 2);

  // Rozsah firmy: používateľ vždy len vlastná (parameter sa ignoruje), správca musí firmu zvoliť
  const user = { email: "stary@firma.sk", role: "user", orgId: LEGACY_ORG, org: legacy } as unknown as Actor;
  const admin = { email: "admin@obozretne.sk", role: "admin", org: null } as unknown as Actor;
  assert.equal(orgScope(user, b.id), LEGACY_ORG, "používateľ sa nedostane k inej firme ani parametrom");
  assert.equal(orgScope(admin, b.id), b.id);
  assert.throws(() => orgScope(admin, ""), (e: Error) => e instanceof AuthError && /zvoliť firmu/.test(e.message));
  assert.throws(() => orgScope({ ...user, orgId: undefined } as Actor), AuthError);

  // Kľúče dát sú vždy s predponou firmy; neplatný identifikátor sa odmietne
  assert.equal(orgKey(b.id, "companies"), `org:${b.id}:companies`);
  assert.throws(() => orgKey("../x", "companies"), OrgError);

  // Balík a miesta
  assert.equal(effectiveMode(b, false), "firma");
  assert.equal(effectiveMode(b, true), "advokat");
  await updateOrg(b.id, { mode: "advokat", seats: 10 });
  assert.equal(effectiveMode(await getOrg(b.id), false), "advokat");
  await rejects(() => createOrg({ name: "X" }, "a"), /názov/);
  await rejects(() => createOrg({ name: "Firma", ico: "12" }, "a"), /IČO/);
  await rejects(() => createOrg({ name: "Firma", id: LEGACY_ORG }, "a"), /už existuje/);

  console.log("OK – testy oddelenia firiem prešli.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
