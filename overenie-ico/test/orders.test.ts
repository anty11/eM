/** Testy objednávok z verejného webu (pamäťové úložisko). Spustenie: npm test */
import assert from "node:assert/strict";
import { useMemoryKV } from "../lib/auth/kv";
import { createOrder, listOrders, setOrderStatus } from "../lib/orders";

const rejects = async (p: Promise<unknown>, re: RegExp) => assert.rejects(p, (e: Error) => re.test(e.message) || (console.error("Neočakávaná chyba:", e.message), false));

async function main() {
  useMemoryKV();
  const ok = { company: "Vzorová firma, s.r.o.", ico: "47 244 895", contactName: "Jana Nováková", email: "Jana@Firma.sk", phone: "+421 900 111 222", users: "5", plan: "rozsirene", message: "Školenie prosím v Bratislave.", consent: true };

  await rejects(createOrder({ ...ok, company: "" }, "1.1.1.1"), /názov spoločnosti/);
  await rejects(createOrder({ ...ok, ico: "12" }, "1.1.1.1"), /IČO/);
  await rejects(createOrder({ ...ok, email: "zly-email" }, "1.1.1.1"), /e-mail/);
  await rejects(createOrder({ ...ok, consent: false }, "1.1.1.1"), /súhlas/);
  await rejects(createOrder({ ...ok, website: "http://spam" }, "1.1.1.1"), /zlyhalo/); // pasca na roboty

  const o = await createOrder(ok, "1.1.1.1");
  assert.match(o.id, /^OBJ-\d{8}-[A-Z0-9]{5}$/);
  assert.equal(o.ico, "47244895");
  assert.equal(o.email, "jana@firma.sk");
  assert.equal(o.users, 5);
  assert.equal(o.plan, "rozsirene");
  assert.equal(o.status, "new");

  const o2 = await createOrder({ ...ok, plan: "cokolvek", users: "9999", ico: "" }, "1.1.1.1");
  assert.equal(o2.plan, "standard");
  assert.equal(o2.users, 500);
  assert.equal(o2.ico, "");

  const list = await listOrders();
  assert.deepEqual(list.map((x) => x.id), [o2.id, o.id], "najnovšia prvá");

  await setOrderStatus(o.id, "contacted", "admin@kancelaria.sk");
  assert.equal((await listOrders()).find((x) => x.id === o.id)?.status, "contacted");
  assert.equal((await listOrders()).length, 2);
  await rejects(setOrderStatus("OBJ-NEEXISTUJE", "done", "admin@kancelaria.sk"), /nenašla/);

  // limit odoslaní z jednej adresy
  for (let i = 0; i < 10; i++) await createOrder(ok, "2.2.2.2").catch(() => undefined);
  await rejects(createOrder(ok, "2.2.2.2"), /Príliš veľa/);

  console.log("OK – testy objednávok prešli.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
