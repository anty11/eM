/** Exporty FS (ZIP+XML): parser riadkov bez znalosti schémy, denný index platiteľov DPH, história zrušení, spotrebné dane. Spustenie: npm test */
import assert from "node:assert/strict";
import { zipSync } from "fflate";
import { useMemoryKV } from "../lib/auth/kv";
import { buildFsExports, exciseByIco, parseXmlRows, vatHistory } from "../lib/sources/fsexports";

const enc = (s: string) => new TextEncoder().encode(s);
const vatXml = (icos: string[]) =>
  `<?xml version="1.0" encoding="UTF-8"?>\n<zoznam>\n${icos.map((i) => `<zaznam><ic_dph>SK${i}00</ic_dph><nazov><![CDATA[Firma ${i} & spol.]]></nazov><ico>${i}</ico><druh_registracie>platiteľ DPH</druh_registracie><datum_registracie>2015-03-01</datum_registracie></zaznam>`).join("\n")}\n</zoznam>`;
const exciseXml = `<?xml version="1.0"?><root><row><registracne_cislo>SK5240000001</registracne_cislo><ico>40000000</ico><nazov_subjektu>C.C.C. s.r.o.</nazov_subjektu><druh_dane>Lieh</druh_dane><druh_danoveho_subjektu>Schválený príjemca</druh_danoveho_subjektu><datum_registracie>12.03.2021</datum_registracie></row><row><ico>40000000</ico><druh_dane>Elektrina</druh_dane><druh_danoveho_subjektu>Platiteľ dane - elektrina</druh_danoveho_subjektu><datum_registracie>2022-01-05</datum_registracie></row></root>`;

async function main() {
  useMemoryKV();
  // parser
  const p = parseXmlRows(vatXml(["12345678", "87654321"]));
  assert.equal(p.rowTag, "zaznam");
  assert.equal(p.rows.length, 2);
  assert.equal(p.rows[0].nazov, "Firma 12345678 & spol.", "CDATA a entity");
  assert.deepEqual(p.fields.sort(), ["datum_registracie", "druh_registracie", "ic_dph", "ico", "nazov"]);

  // deň 1: 100 001 platiteľov; deň 2: jeden vypadne → história zrušenia s oknom dní
  const many = Array.from({ length: 100_001 }, (_, i) => String(10_000_000 + i));
  let day = "2026-10-27";
  const realDate = Date.prototype.toISOString;
  Date.prototype.toISOString = function () { return `${day}T05:10:00.000Z`; };
  let vat = many;
  globalThis.fetch = (async (input: any) => {
    const u = String(input);
    const xml = u.includes("ds_dphs") ? vatXml(vat) : exciseXml;
    return new Response(zipSync({ "export.xml": enc(xml) }), { status: 200 });
  }) as typeof fetch;
  const m1 = await buildFsExports();
  assert.equal(m1.vatCount, 100_001);
  assert.equal(m1.exciseCount, 1);
  assert.equal(m1.goneAdded, 0);
  const h1 = await vatHistory("10000005");
  assert.equal(h1.current?.icDph, "SK1000000500");
  assert.equal(h1.current?.registeredFrom, "2015-03-01");
  assert.equal(h1.gone, undefined);
  const ex = await exciseByIco("40000000");
  assert.deepEqual(ex?.lines, ["Lieh – Schválený príjemca – od 12.03.2021", "Elektrina – Platiteľ dane - elektrina – od 05.01.2022"]);
  assert.deepEqual((await exciseByIco("11111111"))?.lines, []);

  day = "2026-10-28";
  vat = many.filter((i) => i !== "10000005");
  const m2 = await buildFsExports();
  assert.equal(m2.goneAdded, 1);
  assert.equal(m2.firstSnapshot, "2026-10-27");
  const h2 = await vatHistory("10000005");
  assert.equal(h2.current, undefined);
  assert.deepEqual(h2.gone, { lastSeen: "2026-10-27", firstMissing: "2026-10-28", icDph: "SK1000000500", kind: "platiteľ DPH" });
  assert.equal((await vatHistory("10000006")).gone, undefined);
  Date.prototype.toISOString = realDate;

  // príliš malý zoznam = chyba (nie prázdny index)
  vat = ["12345678"];
  await assert.rejects(buildFsExports(), /neočakávane málo záznamov/);
  console.log("OK – exporty FS: parser, denný index DPH, história zrušení, spotrebné dane.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
