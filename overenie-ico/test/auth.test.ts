/** Testy prihlasovania a správy používateľov (pamäťové úložisko). Spustenie: npm test */
import assert from "node:assert/strict";
import { listAudit } from "../lib/audit";
import { useMemoryKV } from "../lib/auth/kv";
import { signSession, verifySession } from "../lib/auth/session";
import { getContact, saveContact } from "../lib/contacts";
import {
  addUsers, directory, changePassword, deleteUser, getUser, listUsers, login, parseEmailList, resetUser, setPasswordWithCode, updateUser,
} from "../lib/auth/users";

const rejects = async (p: Promise<unknown>, re: RegExp) => {
  await assert.rejects(p, (e: Error) => re.test(e.message) || (console.error("Neočakávaná chyba:", e.message), false));
};

async function main() {
  useMemoryKV();
  process.env.ADMIN_EMAILS = "Antonin.Cajka@publicis.no, partner@kancelaria.sk";
  process.env.ADMIN_SETUP_CODE = "PRVY-ADMIN-2026";
  const ip = "1.2.3.4";

  // Parsovanie zoznamu
  assert.deepEqual(parseEmailList("Jana <jana@a.sk>; PETER@a.sk\nzly-email, jana@a.sk"), ["jana@a.sk", "peter@a.sk"]);

  // Bootstrap prvého admina – nesprávny kód / e-mail mimo ADMIN_EMAILS
  await rejects(setPasswordWithCode("antonin.cajka@publicis.no", "ZLY-KOD", "SilneHeslo2026!", ip), /Neplatný/);
  await rejects(setPasswordWithCode("cudzi@x.sk", "PRVY-ADMIN-2026", "SilneHeslo2026!", ip), /Neplatný/);
  await rejects(setPasswordWithCode("antonin.cajka@publicis.no", "PRVY-ADMIN-2026", "kratke", ip), /aspoň 10/);
  const admin = await setPasswordWithCode(" Antonin.Cajka@publicis.no ", "prvy admin 2026", "SilneHeslo2026!", ip);
  assert.equal(admin.role, "admin");
  assert.equal((await login("antonin.cajka@publicis.no", "SilneHeslo2026!", ip)).role, "admin");

  // Hromadné pridanie
  const res = await addUsers("jana@kancelaria.sk, peter@kancelaria.sk\nzly@\nantonin.cajka@publicis.no", "user", admin.email);
  const by = (e: string) => res.find((r) => r.email === e)!;
  assert.equal(by("jana@kancelaria.sk").result, "created");
  assert.match(by("jana@kancelaria.sk").code!, /^[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/);
  assert.equal(by("antonin.cajka@publicis.no").result, "exists");
  assert.ok(res.some((r) => r.result === "invalid"));
  const janaCode = by("jana@kancelaria.sk").code!;

  // Pred nastavením hesla sa nedá prihlásiť
  await rejects(login("jana@kancelaria.sk", "cokolvek12345", ip), /jednorazový kód/);
  await rejects(setPasswordWithCode("jana@kancelaria.sk", by("peter@kancelaria.sk").code!, "Kancel4riaHeslo!", ip), /Neplatný/);
  await rejects(setPasswordWithCode("jana@kancelaria.sk", janaCode, "xjana12345678", ip), /e-mailovú/);
  await setPasswordWithCode("jana@kancelaria.sk", janaCode.toLowerCase().replace(/-/g, " "), "Kancel4riaHeslo!", ip);
  // kód je jednorazový
  await rejects(setPasswordWithCode("jana@kancelaria.sk", janaCode, "InéHeslo2026!!", ip), /Neplatný/);
  const jana = await login("JANA@kancelaria.sk", "Kancel4riaHeslo!", ip);
  assert.equal(jana.role, "user");
  await rejects(login("jana@kancelaria.sk", "zle-heslo-123", ip), /Nesprávny/);
  await rejects(login("neexistuje@kancelaria.sk", "zle-heslo-123", ip), /Nesprávny/);

  // Relácia: podpis, zneplatnenie po resete
  const tok = await signSession({ email: jana.email, role: jana.role, ver: jana.pwVer });
  const s = await verifySession(tok);
  assert.equal(s?.email, "jana@kancelaria.sk");
  assert.equal(await verifySession(tok.slice(0, -2) + "xx"), null, "zmenený podpis musí byť odmietnutý");
  const forged = Buffer.from(JSON.stringify({ email: jana.email, role: "admin", ver: jana.pwVer, exp: Date.now() + 1e7 })).toString("base64url");
  assert.equal(await verifySession(`${forged}.${tok.split(".")[1]}`), null, "podvrhnutá rola musí byť odmietnutá");
  const newCode = await resetUser("jana@kancelaria.sk", admin.email);
  const after = await getUser("jana@kancelaria.sk");
  assert.notEqual(after!.pwVer, s!.ver, "reset musí zneplatniť relácie");
  await rejects(login("jana@kancelaria.sk", "Kancel4riaHeslo!", ip), /jednorazový kód/);
  await setPasswordWithCode("jana@kancelaria.sk", newCode, "NoveHesloJany26", ip);

  // Zmena hesla
  await rejects(changePassword("jana@kancelaria.sk", "zle", "DalsieHeslo2026"), /Súčasné heslo/);
  await changePassword("jana@kancelaria.sk", "NoveHesloJany26", "DalsieHeslo2026");
  await login("jana@kancelaria.sk", "DalsieHeslo2026", ip);

  // Blokovanie a roly
  await updateUser("jana@kancelaria.sk", { disabled: true }, admin.email);
  await rejects(login("jana@kancelaria.sk", "DalsieHeslo2026", ip), /Nesprávny/);
  await updateUser("jana@kancelaria.sk", { disabled: false }, admin.email);
  await updateUser("jana@kancelaria.sk", { role: "admin" }, admin.email);
  assert.equal((await getUser("jana@kancelaria.sk"))!.role, "admin");
  await rejects(updateUser(admin.email, { role: "user" }, admin.email), /sami seba/);
  await rejects(deleteUser(admin.email, admin.email), /sami seba/);
  await updateUser("jana@kancelaria.sk", { role: "user" }, admin.email);
  await rejects(updateUser(admin.email, { disabled: true }, "jana@kancelaria.sk"), /aspoň jeden/);
  await deleteUser("peter@kancelaria.sk", admin.email);
  assert.equal(await getUser("peter@kancelaria.sk"), null);
  const list = await listUsers();
  assert.deepEqual(list.map((u) => [u.email, u.status]), [["antonin.cajka@publicis.no", "active"], ["jana@kancelaria.sk", "active"]]);
  assert.ok(!("passwordHash" in list[0]) && !("invite" in list[0]), "zoznam nesmie obsahovať hash hesla ani kód");

  // Obmedzenie pokusov
  for (let i = 0; i < 8; i++) await login("jana@kancelaria.sk", "zle-heslo-xx", "9.9.9.9").catch(() => {});
  await rejects(login("jana@kancelaria.sk", "DalsieHeslo2026", "9.9.9.9"), /Príliš veľa/);

  // Verzia a meno
  await updateUser("jana@kancelaria.sk", { mode: "advokat", name: "Mgr. Jana Nováková" }, admin.email);
  assert.equal((await listUsers()).find((u) => u.email === "jana@kancelaria.sk")!.mode, "advokat");
  assert.equal((await listUsers()).find((u) => u.email === admin.email)!.mode, "firma", "predvolená verzia je Firma");

  // Kontaktná karta partnera
  const dir = (await directory()).map((u) => u.email);
  await rejects(saveContact("47244895", { email: "zly" }, admin.email, dir), /e-mail/);
  const saved = await saveContact(
    "47244895",
    { active: true, personName: "JUDr. Ján Vzor", phone: "+421 905 123 456", email: "vzor@urban.sk", isStatutory: true, owners: ["jana@kancelaria.sk", "cudzi@x.sk"] },
    admin.email,
    dir,
  );
  assert.deepEqual(saved.owners, ["jana@kancelaria.sk"], "zodpovedný musí byť používateľ aplikácie");
  assert.equal((await getContact("47244895"))!.phone, "+421 905 123 456");

  // Audit
  const log = await listAudit({ limit: 1000 });
  for (const t of ["user_added", "password_set", "login", "login_failed", "user_reset", "user_disabled", "role_changed", "user_deleted", "password_changed", "mode_changed", "contact_saved"])
    assert.ok(log.some((e) => e.type === t), `v audite chýba ${t}`);
  assert.ok((await listAudit({ type: "admin" })).every((e) => !["scan", "login", "login_failed"].includes(e.type)));

  console.log(`OK – testy prihlasovania prešli (${log.length} udalostí v audite).`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
