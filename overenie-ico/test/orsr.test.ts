/** Záloha identifikácie z Obchodného registra (orsr.sk), keď RPO neodpovie. Spustenie: npm test */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { orsrExtractLinks, parseOrsrExtract } from "../lib/sources/orsr";
import { checkRpo } from "../lib/sources/rpo";
import type { Ctx } from "../lib/types";

const vypisBytes = readFileSync(new URL("./fixtures/orsr-vypis.cp1250.html", import.meta.url));
const hladaj = readFileSync(new URL("./fixtures/orsr-hladaj.html", import.meta.url), "utf8");

async function main() {
  // 1) parsovanie výpisu (windows-1250)
  const html = new TextDecoder("windows-1250").decode(vypisBytes);
  const o = parseOrsrExtract(html, "https://www.orsr.sk/vypis.asp?ID=1366&SID=2&P=0")!;
  assert.equal(o.name, "SLOVNAFT, a.s.");
  assert.equal(o.address, "Vlčie hrdlo 1, Bratislava 824 12");
  assert.equal(o.legalForm, "Akciová spoločnosť");
  assert.equal(o.established, "1992-05-01");
  assert.equal(o.registrationNumber, "Sa, vložka 426/B");
  assert.equal(o.inLiquidation, false);
  assert.deepEqual(o.statutory.map((s) => s.name), ["Ing. Gabriel Szabó", "Ferenc Horváth"]);
  assert.equal(o.statutory[0].role, "predseda predstavenstva");
  assert.equal(o.statutory[1].since, "2020-06-20");
  assert.deepEqual(o.owners.map((s) => s.name), ["MOL Nyrt."]);
  assert.equal(o.owners[0].role, "akcionár");
  assert.deepEqual(orsrExtractLinks(hladaj), ["https://www.orsr.sk/vypis.asp?ID=1366&SID=2&P=0"]);
  console.log("OK – parsovanie výpisu z obchodného registra.");

  // 2) RPO zlyhá → identifikácia z orsr.sk
  const calls: string[] = [];
  globalThis.fetch = (async (input: any) => {
    const url = String(input);
    calls.push(url);
    const u = new URL(url);
    if (u.host === "api.statistics.sk") return new Response("Service Unavailable", { status: 503 });
    if (u.host === "www.orsr.sk" && u.pathname.includes("hladaj_ico")) return new Response(hladaj, { headers: { "content-type": "text/html; charset=windows-1250" } });
    if (u.host === "www.orsr.sk" && u.pathname.includes("vypis")) return new Response(vypisBytes, { headers: { "content-type": "text/html" } });
    return new Response("not found", { status: 404 });
  }) as typeof fetch;
  const ctx: Ctx = { ico: "31322832", profile: { ico: "31322832" } } as Ctx;
  const t0 = Date.now();
  const r = await checkRpo(ctx);
  assert.equal(r.status, "ok", r.summary);
  assert.equal((r.data as any).via, "orsr");
  assert.ok(r.summary.includes("podľa Obchodného registra SR"));
  assert.equal(ctx.profile.name, "SLOVNAFT, a.s.");
  assert.equal(ctx.profile.statutory?.length, 2);
  assert.ok(r.findings.some((f) => f.severity === "positive"), "stabilná história");
  assert.ok(Date.now() - t0 < 3000, "pri rýchlej chybe RPO sa záloha spustí hneď");
  assert.ok(calls.some((c) => c.includes("hladaj_ico.asp?ICO=31322832")));
  console.log("OK – RPO nedostupné → identifikácia z orsr.sk.");

  // 2b) RPO mešká (neodpovedá) → po 7 s sa spustí orsr.sk, po ďalších 3 s sa použije
  globalThis.fetch = (async (input: any) => {
    const u = new URL(String(input));
    if (u.host === "api.statistics.sk") return new Promise<Response>((r) => setTimeout(() => r(new Response("{}", { status: 504 })), 16000));
    if (u.pathname.includes("hladaj_ico")) return new Response(hladaj);
    return new Response(vypisBytes);
  }) as typeof fetch;
  const t1 = Date.now();
  const ctxSlow = { ico: "31322832", profile: { ico: "31322832" } } as Ctx;
  const rs = await checkRpo(ctxSlow);
  const took = Date.now() - t1;
  assert.equal((rs.data as any).via, "orsr");
  assert.ok(took >= 9500 && took < 12500, `záloha po ~10 s (${took} ms)`);
  assert.equal(ctxSlow.profile.name, "SLOVNAFT, a.s.");
  console.log(`OK – pomalé RPO → orsr.sk po ${Math.round(took / 1000)} s (namiesto chyby po 22 s).`);

  // 3) obe zlyhajú → chyba s vysvetlením
  globalThis.fetch = (async () => new Response("x", { status: 503 })) as typeof fetch;
  const r2 = await checkRpo({ ico: "31322832", profile: { ico: "31322832" } } as Ctx);
  assert.equal(r2.status, "error");
  assert.ok(r2.summary.includes("záloha z Obchodného registra"), r2.summary);
  console.log("OK – testy zálohy z obchodného registra prešli.");
  process.exit(0);
}

main().catch((e) => {
  console.error("FAIL", e);
  process.exit(1);
});
