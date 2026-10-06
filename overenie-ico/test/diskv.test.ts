/**
 * Register diskvalifikácií cez API Infosud (obcan.justice.sk/pilot/api/ress-isu-service/v1/diskvalifikacia):
 * tvar odpovede podľa diagnostiky 6. 10. 2026 ({ numFound, page od 0, size, updateDate, filterList, <zoznam> }), zistenie parametra
 * vyhľadávania, dopyt podľa IČO a priezvisk (nič sa nesťahuje celé), porovnanie štatutárov, verdikty. Spustenie: npm test
 */
import assert from "node:assert/strict";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { useMemoryKV } from "../lib/auth/kv";
import { checkDiskv, flatten, lookupDiskv, matchRecord, nameParts, recordsOf, searchParam } from "../lib/sources/diskv";

const facets = [{ filterName: "sud_string", facetValueList: [{ text: "Mestský súd Košice", count: 74 }] }];
const people = Array.from({ length: 23 }, (_, i) => ({
  guid: `g${i}`,
  meno: i === 7 ? "Gabriel" : `Meno${i}`,
  priezvisko: i === 7 ? "SZABÓ" : `Priezvisko${i}`,
  datumNarodenia: "01.01.1970",
  sud: { nazov: "Okresný súd Žilina" },
  zakazDo: "31.12.2028",
  obchodnaSpolocnost: i === 15 ? { nazov: "ZLÁ FIRMA s.r.o.", ico: "12345678" } : null,
}));

(async () => {
  // čisté funkcie
  assert.deepEqual(nameParts("Ing. Gabriel Szabó, PhD."), { given: ["gabriel"], surname: "szabo", raw: "Szabó" });
  assert.equal(nameParts("Szabó"), null);
  const flat = flatten(people[15]);
  assert.equal(flat["obchodnaSpolocnost.ico"], "12345678");
  assert.equal(flat["sud.nazov"], "Okresný súd Žilina");
  assert.deepEqual(matchRecord(flatten(people[7]), "99999999", ["Ing. Gabriel Szabó"]), { by: "name", who: "Ing. Gabriel Szabó" });
  assert.equal(matchRecord(flatten(people[7]), "99999999", ["Gabriela Szabóová"]), null, "iné meno sa nezhoduje");
  assert.equal(matchRecord(flatten(people[7]), "99999999", ["Peter Szabó"]), null, "len priezvisko nestačí");
  assert.deepEqual(matchRecord(flatten(people[15]), "12345678", []), { by: "ico" });
  assert.equal(matchRecord(flatten(people[15]), "1234567", []), null, "časť IČO sa nepočíta");
  const r = recordsOf({ numFound: 2, page: 0, size: 10, updateDate: "30.09.2026", filterList: facets, diskvalifikaciaList: people.slice(0, 2) });
  assert.equal(r.key, "diskvalifikaciaList");
  assert.equal(r.records.length, 2);
  assert.equal(recordsOf({ numFound: 0, filterList: facets, items: [] }).records.length, 0);

  // API: filtruje len parameter „query“ (fulltext bez diakritiky); neznáme parametre ignoruje a vráti celý register
  useMemoryKV();
  const seen: string[] = [];
  const fold = (x: string) => x.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  const srv = createServer((req, res) => {
    const u = new URL(req.url || "/", "http://x");
    seen.push(u.search);
    const q = u.searchParams.get("query");
    const list = q == null ? people : people.filter((p) => fold(JSON.stringify(p)).includes(fold(q)));
    const size = Number(u.searchParams.get("size") || 10);
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ numFound: list.length, page: 0, size, updateDate: "30.09.2026", filterList: facets, diskvalifikaciaList: list.slice(0, size) }));
  });
  await new Promise<void>((ok) => srv.listen(0, "127.0.0.1", ok));
  process.env.DISKV_API_URL = `http://127.0.0.1:${(srv.address() as AddressInfo).port}/diskvalifikacia`;

  assert.equal(await searchParam(), "query", "parameter zistený podľa numFound = 0");
  assert.equal(await searchParam(), "query");
  const probes = seen.length;
  const l = await lookupDiskv("12345678");
  assert.equal(l.total, 1);
  assert.ok(l.complete);
  assert.equal(seen.length, probes + 1, "jeden dopyt na výraz");
  assert.ok(!seen.some((q) => /size=(100|[2-9]\d\d)/.test(q)), "nikdy sa nesťahuje celý register");

  const ctx = (ico: string, names: string[]) => ({ ico, profile: { ico, statutory: names.map((name) => ({ name, role: "konateľ" })) } }) as any;
  const clean = await checkDiskv(ctx("31322832", ["Ing. Ján Novák", "Mária Kováčová"]));
  assert.equal(clean?.status, "ok");
  assert.match(clean!.summary, /Bez záznamu.*\(2\).*30\.09\.2026/);
  assert.ok(seen.some((q) => q.includes(`query=${encodeURIComponent("Novák")}`)), "dopyt podľa priezviska štatutára");
  const name = await checkDiskv(ctx("31322832", ["Ing. Gabriel Szabó"]));
  assert.equal(name?.status, "warning");
  assert.equal(name!.findings[0].cap, "caution", "zhoda mena = najviac S výhradou");
  assert.ok(name!.findings[0].ask);
  assert.match(name!.findings[0].text, /možná zhoda.*Gabriel Szabó/);
  const ico = await checkDiskv(ctx("12345678", []));
  assert.equal(ico?.status, "critical");
  assert.equal(ico!.findings[0].severity, "critical");
  assert.equal(await checkDiskv(ctx("31322832", [])), null, "bez štatutárov sa nerozhoduje");
  console.log("OK – register diskvalifikácií: API, stránkovanie, porovnanie štatutárov a IČO");
  srv.close();
  process.exit(0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
