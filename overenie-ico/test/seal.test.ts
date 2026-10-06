/** Testy pečate protokolu – kanonický JSON, odtlačok, idempotencia, zoznam. Spustenie: npm test */
import assert from "node:assert/strict";
import { useMemoryKV } from "../lib/auth/kv";
import { gzipSync } from "node:zlib";
import { kv, useMemoryKV as _m } from "../lib/auth/kv";
import { audit } from "../lib/audit";
import { orgKey } from "../lib/orgs";
import { canonical, CODE_RE, getSealedDoc, listArchive, listSeals, newCode, normalizeCode, sealProtocol, sha256, shortHash } from "../lib/seal";
void _m;

async function main() {
  useMemoryKV();
  // kanonický JSON nezávisí od poradia kľúčov ani od undefined
  assert.equal(canonical({ b: 1, a: [3, { d: undefined, c: "x" }] }), canonical({ a: [3, { c: "x" }], b: 1 }));
  assert.equal(sha256("a"), "ca978112ca1bbdcafac231b39a23dc4da786eff8147c4e72b9807785afee48bb");
  assert.match(shortHash(sha256("a")), /^CA97 8112 CA1B BDCA … 48BB$/);

  const base = { scanId: "SK-47244895-20261004103339", ico: "47244895", scannedAt: "2026-10-04T10:33:39.000Z", profile: { name: "URBAN & PARTNERS s.r.o." }, checks: [{ id: "rpo", status: "ok" }], verdict: { level: "recommended", score: 100 }, company: "URBAN & PARTNERS s.r.o.", verdictLevel: "recommended", score: 100, by: "Janka Mrkvičková", note: "", author: "Janka Mrkvičková", orgId: "firmaa", orgName: "Firma A s.r.o." };
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
  // číslo protokolu patrí firme, ktorá ho zapečatila prvá
  await assert.rejects(sealProtocol({ ...base, orgId: "firmab", orgName: "Firma B" }), /inému prevereniu/);
  assert.equal(s1.orgName, "Firma A s.r.o.");
  assert.deepEqual(await listSeals("nic", "AAAAAAAAAA"), []);

  // archív firmy a uložený obsah protokolu
  const arch = await listArchive("firmaa");
  assert.deepEqual(arch.map((a) => a.seq), [2, 1], "archív: najnovšie prvé, bez duplicity pri rovnakom obsahu");
  assert.equal(arch[0].code, s1.code);
  assert.ok(arch.every((a) => a.stored));
  assert.deepEqual(await listArchive("firmab"), [], "iná firma nevidí cudzie pečate");
  const d = await getSealedDoc("firmaa", base.scanId, 2);
  assert.ok(d?.intact, "obsah zhodný s odtlačkom");
  assert.equal(d!.doc.note, "Doplnená poznámka");
  assert.equal(d!.seal.code, s1.code);
  assert.equal(await getSealedDoc("firmab", base.scanId, 2), null, "cudzia firma obsah nedostane");
  const packed = await kv().get<string>(`sealdoc:${base.scanId}:2`);
  assert.ok(packed && packed.length < 2000, `uložený obsah je malý (${packed?.length} B)`);
  // zmenený obsah v databáze sa prezradí
  await kv().set(`sealdoc:${base.scanId}:2`, gzipSync(Buffer.from(canonical({ ...JSON.parse(JSON.stringify(d!.doc)), note: "podvrh" }))).toString("base64"));
  assert.equal((await getSealedDoc("firmaa", base.scanId, 2))!.intact, false);
  // pečate spred archívu sa doplnia z auditu (bez obsahu)
  await kv().lpush(`seals:SK-12345678-20260101120000`, { scanId: "SK-12345678-20260101120000", seq: 1, ico: "12345678", scannedAt: "2026-01-01T12:00:00Z", sealedAt: "2026-01-01T12:05:00Z", hash: "ab".repeat(32), verdict: "caution", score: 70, by: "Starý", code: "" }, 50);
  await kv().set("sealcode:SK-12345678-20260101120000", "ABCDEFGHJK");
  await kv().set("sealorg:SK-12345678-20260101120000", "firmac");
  await audit({ type: "protocol_sealed", by: "Starý", orgId: "firmac", ico: "12345678", scanId: "SK-12345678-20260101120000" });
  const old = await listArchive("firmac");
  assert.equal(old.length, 1);
  assert.equal(old[0].code, "ABCDEFGHJK");
  assert.equal(old[0].stored, false);
  assert.equal((await kv().lrange(orgKey("firmac", "seals"), 0, 10)).length, 1, "doplnenie len raz");
  await listArchive("firmac");
  assert.equal((await kv().lrange(orgKey("firmac", "seals"), 0, 10)).length, 1);
  console.log("OK – testy pečate protokolu prešli.");
}
main().catch((e) => { console.error(e); process.exit(1); });
