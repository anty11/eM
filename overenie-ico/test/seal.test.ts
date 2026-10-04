/** Testy pečate protokolu – kanonický JSON, odtlačok, idempotencia, zoznam. Spustenie: npm test */
import assert from "node:assert/strict";
import { useMemoryKV } from "../lib/auth/kv";
import { canonical, CODE_RE, listSeals, newCode, normalizeCode, sealProtocol, sha256, shortHash } from "../lib/seal";

async function main() {
  useMemoryKV();
  // kanonický JSON nezávisí od poradia kľúčov ani od undefined
  assert.equal(canonical({ b: 1, a: [3, { d: undefined, c: "x" }] }), canonical({ a: [3, { c: "x" }], b: 1 }));
  assert.equal(sha256("a"), "ca978112ca1bbdcafac231b39a23dc4da786eff8147c4e72b9807785afee48bb");
  assert.match(shortHash(sha256("a")), /^CA97 8112 CA1B BDCA … 48BB$/);

  const base = { scanId: "SK-47244895-20261004103339", ico: "47244895", scannedAt: "2026-10-04T10:33:39.000Z", profile: { name: "URBAN & PARTNERS s.r.o." }, checks: [{ id: "rpo", status: "ok" }], verdict: { level: "recommended", score: 100 }, company: "URBAN & PARTNERS s.r.o.", verdictLevel: "recommended", score: 100, by: "Janka Mrkvičková", note: "", author: "Janka Mrkvičková" };
  const s1 = await sealProtocol(base);
  assert.equal(s1.seq, 1);
  assert.equal(s1.by, "Janka Mrkvičková");
  assert.ok(!JSON.stringify(s1).includes("@"), "pečať neobsahuje e-mail");
  const s1b = await sealProtocol({ ...base, profile: { name: "URBAN & PARTNERS s.r.o." } });
  assert.equal(s1b.hash, s1.hash, "rovnaký obsah = rovnaká pečať");
  assert.equal(s1b.sealedAt, s1.sealedAt, "a pôvodný čas");
  const s2 = await sealProtocol({ ...base, note: "Doplnená poznámka" });
  assert.equal(s2.seq, 2);
  assert.notEqual(s2.hash, s1.hash, "zmena poznámky mení odtlačok");
  assert.match(s1.code, CODE_RE, "overovací kód má 10 znakov");
  assert.equal(s2.code, s1.code, "všetky pečate protokolu zdieľajú jeden kód");
  const list = await listSeals(base.scanId, s1.code);
  assert.deepEqual(list.map((s) => s.seq), [1, 2]);
  assert.deepEqual(await listSeals(base.scanId, "AAAAAAAAAA"), [], "zlý kód → nič (ani existencia)");
  assert.deepEqual(await listSeals(base.scanId, ""), []);
  assert.equal(normalizeCode(" k7mq-2rt9 wx "), "K7MQ2RT9WX");
  assert.equal(normalizeCode("0O1I"), "OOII", "zameniteľné znaky sa zjednotia");
  assert.match(newCode(), CODE_RE);
  await assert.rejects(sealProtocol({ ...base, scanId: "../x" }), /Neplatné číslo/);
  assert.deepEqual(await listSeals("nic", "AAAAAAAAAA"), []);
  console.log("OK – testy pečate protokolu prešli.");
}
main().catch((e) => { console.error(e); process.exit(1); });
