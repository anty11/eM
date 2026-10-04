/** Testy registrov bez API (prísne rozpoznanie výsledku) a indexu Obchodného vestníka. Spustenie: npm test */
import assert from "node:assert/strict";
import { useMemoryKV } from "../lib/auth/kv";
import { checkOv, classifyNotice, importOvXml, parseOvXml } from "../lib/sources/ov";
import { judge } from "../lib/sources/public";
import type { Ctx } from "../lib/types";

async function main() {
  useMemoryKV();
  // --- rozpoznanie odpovede registra
  const form = `<html><form><input name="ico" value=""></form><p>Zadajte IČO alebo meno.</p></html>`;
  assert.equal(judge(form, ["47244895"]).verdict, "unknown", "neprehľadaný formulár nie je „bez záznamu“");
  const empty = `<html><form><input name="ico" value="47244895"></form><div>Neboli nájdené žiadne záznamy.</div></html>`;
  assert.equal(judge(empty, ["47244895"]).verdict, "clean");
  const noEcho = `<html><div>Neboli nájdené žiadne záznamy.</div></html>`;
  assert.equal(judge(noEcho, ["47244895"]).verdict, "unknown", "bez ozveny dopytu sa prázdny výsledok neuzná");
  const hit = `<table><tr><th>IČO</th><th>Dlh</th></tr><tr><td>47244895</td><td>URBAN &amp; PARTNERS</td><td>1 250,00 €</td></tr></table>`;
  const j = judge(hit, ["47244895"]);
  assert.equal(j.verdict, "found");
  assert.match(j.rows[0], /1 250,00 €/);
  assert.equal(judge(`[]`, ["47244895"]).verdict, "clean");
  assert.equal(judge(`{"data":[],"total":0}`, ["47244895"]).verdict, "clean");
  assert.equal(judge(`[{"ico":"47244895","dlh":320.5}]`, ["47244895"]).verdict, "found");
  assert.equal(judge(`[{"ico":"11111111"}]`, ["47244895"]).verdict, "unknown", "cudzí riadok nie je ani nález, ani bez záznamu");
  // diskvalifikácie podľa mena štatutára
  assert.equal(judge(`<table><tr><td>Ing. Janko Mrkvička</td><td>zákaz do 2027</td></tr></table>`, ["47244895", "Ing. Janko Mrkvička"]).verdict, "found");

  // --- Obchodný vestník
  assert.equal(classifyNotice("Konkurzy a reštrukturalizácie").severity, "critical");
  assert.equal(classifyNotice("Oznámenie o vstupe do likvidácie").label, "likvidácia");
  assert.equal(classifyNotice("Zlúčenie spoločností").penalty, 0);
  const xml = `<?xml version="1.0"?><vydanie><cisloVydania>190/2026</cisloVydania><datumVydania>2026-10-02</datumVydania>
    <oznamenie><typ>Konkurzy a reštrukturalizácie</typ><znacka>K012345</znacka><obchodneMeno>Zlá firma s.r.o.</obchodneMeno><ico>12345678</ico><text>Uznesenie o vyhlásení konkurzu.</text></oznamenie>
    <oznamenie><typ>Účtovné závierky</typ><znacka>Z999</znacka><obchodneMeno>Dobrá firma a.s.</obchodneMeno><ico>47244895</ico><datumZverejnenia>2026-10-02</datumZverejnenia></oznamenie>
    <oznamenie><typ>Dražby</typ><ico>12345678</ico><text>Oznámenie o dobrovoľnej dražbe 20261002.</text></oznamenie>
  </vydanie>`;
  const parsed = parseOvXml(xml);
  assert.equal(parsed.length, 3);
  assert.deepEqual(parsed.map((p) => p.ico), ["12345678", "47244895", "12345678"], "dátum 20261002 sa nepovažuje za IČO");
  assert.equal(parsed[0].notice.issue, "190/2026");
  assert.equal(parsed[0].notice.date, "2026-10-02");
  const r = await importOvXml(xml, "test");
  assert.equal(r.added, 3);
  assert.equal((await importOvXml(xml, "test")).added, 0, "opakovaný import nič nepridá");
  const ctx = (ico: string): Ctx => ({ ico, profile: { ico } as any, rpoDone: Promise.resolve(), dicReady: Promise.resolve(), resolveDic: () => undefined });
  const bad = await checkOv(ctx("12345678"));
  assert.equal(bad!.status, "critical");
  assert.ok(bad!.findings.some((f) => /konkurz/.test(f.text)));
  assert.equal(bad!.findings.filter((f) => f.penalty > 0).length, 2, "konkurz + dražba");
  const good = await checkOv(ctx("47244895"));
  assert.equal(good!.status, "ok", "závierka v OV nie je negatívny nález");
  const none = await checkOv(ctx("99999999"));
  assert.equal(none!.status, "ok");
  assert.match(none!.summary, /Bez oznámenia/);

  console.log("OK – testy registrov bez API a Obchodného vestníka prešli.");
}
main().catch((e) => { console.error(e); process.exit(1); });

// VšZP: výsledková tabuľka bez IČO – vyhodnotenie podľa dátových riadkov / hlásenia
{
  const { judgeFor } = require("../lib/sources/public");
  const page = (body: string) => `<html><form><input name="nazov" value="31322832"></form><h3>Zamestnávatelia a SZČO</h3>${body}</html>`;
  const empty = page(`<table><tr><th>Obchodné meno</th><th>Obec</th><th>Ulica</th><th>PSČ</th><th>Pohľadávka</th><th>Typ platiteľa</th></tr></table><p>Nenašli sa žiadne záznamy.</p>`);
  assert.equal(judgeFor("vszp", empty, ["31322832"]).verdict, "clean");
  const hit = page(`<table><tr><th>Obchodné meno</th><th>Obec</th><th>Ulica</th><th>PSČ</th><th>Pohľadávka</th><th>Typ platiteľa</th></tr><tr><td>Zlá firma s.r.o.</td><td>Košice</td><td>Hlavná 1</td><td>04001</td><td>1 250,30 €</td><td>Zamestnávateľ</td></tr></table>`);
  const j = judgeFor("vszp", hit, ["31322832"]);
  assert.equal(j.verdict, "found");
  assert.match(j.rows[0], /1 250,30/);
  const noEcho = `<html><table><tr><th>Obchodné meno</th><th>Pohľadávka</th></tr></table><p>Nenašli sa žiadne záznamy.</p></html>`;
  assert.equal(judgeFor("vszp", noEcho, ["31322832"]).verdict, "unknown", "bez ozveny dopytu nie je výsledok platný");
  console.log("OK – VšZP tabuľka.");
}
