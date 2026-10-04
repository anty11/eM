/** Testy pečate protokolu – kanonický JSON, odtlačok, idempotencia, zoznam. Spustenie: npm test */
import assert from "node:assert/strict";
import { useMemoryKV } from "../lib/auth/kv";
import { canonical, listSeals, sealProtocol, sha256, shortHash } from "../lib/seal";

async function main() {
  useMemoryKV();
  // kanonický JSON nezávisí od poradia kľúčov ani od undefined
  assert.equal(canonical({ b: 1, a: [3, { d: undefined, c: "x" }] }), canonical({ a: [3, { c: "x" }], b: 1 }));
  assert.equal(sha256("a"), "ca978112ca1bbdcafac231b39a23dc4da786eff8147c4e72b9807785afee48bb");
  assert.match(shortHash(sha256("a")), /^CA97 8112 CA1B BDCA … 48BB$/);

  const base = { scanId: "SK-47244895-20261004103339", ico: "47244895", scannedAt: "2026-10-04T10:33:39.000Z", profile: { name: "URBAN & PARTNERS s.r.o." }, checks: [{ id: "rpo", status: "ok" }], verdict: { level: "recommended", score: 100 }, company: "URBAN & PARTNERS s.r.o.", verdictLevel: "recommended", score: 100, by: "Jana Nováková", note: "", author: "Jana Nováková" };
  const s1 = await sealProtocol(base);
  assert.equal(s1.seq, 1);
  assert.equal(s1.by, "Jana Nováková");
  assert.ok(!JSON.stringify(s1).includes("@"), "pečať neobsahuje e-mail");
  const s1b = await sealProtocol({ ...base, profile: { name: "URBAN & PARTNERS s.r.o." } });
  assert.equal(s1b.hash, s1.hash, "rovnaký obsah = rovnaká pečať");
  assert.equal(s1b.sealedAt, s1.sealedAt, "a pôvodný čas");
  const s2 = await sealProtocol({ ...base, note: "Doplnená poznámka" });
  assert.equal(s2.seq, 2);
  assert.notEqual(s2.hash, s1.hash, "zmena poznámky mení odtlačok");
  const list = await listSeals(base.scanId);
  assert.deepEqual(list.map((s) => s.seq), [1, 2]);
  await assert.rejects(sealProtocol({ ...base, scanId: "../x" }), /Neplatné číslo/);
  assert.deepEqual(await listSeals("nic"), []);
  console.log("OK – testy pečate protokolu prešli.");
}
main().catch((e) => { console.error(e); process.exit(1); });
