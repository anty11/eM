/**
 * Obchodný vestník cez prehliadač – podľa skutočnej štruktúry stránky zo záznamu AI overení (10/2026): prepínač „dňa / od–do“
 * (polia od/do neaktívne, kým sa nezvolí rozsah), pole IČO, „Vyhľadať podania“, tabuľka s dátumom, stránkovanie
 * „Aktuálna stránka: 1 2 3 Počet záznamov na stránku: 10 20 50 100“. Spustenie: npm test
 */
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { ovFlow } from "../lib/browser/flows";
import { browserAvailable } from "../lib/browser/session";
import { useMemoryKV } from "../lib/auth/kv";

const d = (daysAgo: number) => {
  const x = new Date(Date.now() - daysAgo * 864e5);
  return `${String(x.getDate()).padStart(2, "0")}.${String(x.getMonth() + 1).padStart(2, "0")}.${x.getFullYear()}`;
};
const iso = (s: string) => s.split(".").reverse().join("-");

// 25 oznámení, od najnovších; pre IČO 11111111 je likvidácia na 2. strane (pred 2 rokmi), pre 22222222 len pred 5 rokmi
function notices(ico: string) {
  return Array.from({ length: 25 }, (_, i) => {
    const days = 20 + i * 80; // ~5,5 roka
    let typ = "Podanie Obchodného registra";
    let kap = "Obchodný register";
    if ((ico === "11111111" || ico === "44444444") && i === 12) [typ, kap] = ["Oznámenie o vstupe do likvidácie", "Oznámenia a výzvy likvidátorov"];
    if (ico === "22222222" && i === 23) [typ, kap] = ["Oznámenie o vstupe do likvidácie", "Oznámenia a výzvy likvidátorov"];
    return { typ, kap, date: d(days), cislo: `${100 + i}/2026` };
  });
}

function page(q: URLSearchParams) {
  const ico = q.get("txtIco") || "";
  const range = q.get("DatumUverejnenia") === "range";
  const od = q.get("txtOd") || "";
  const size = Number(q.get("size") || 10);
  const pg = Number(q.get("p") || 1);
  let list = ico ? notices(ico) : [];
  if (range && od && ico !== "44444444") list = list.filter((n) => iso(n.date) >= iso(od)); // 44444444: filter dátumu nezaberie
  const pages = Math.max(1, Math.ceil(list.length / size));
  const slice = list.slice((pg - 1) * size, pg * size);
  const base = `/ov?txtIco=${ico}&DatumUverejnenia=${range ? "range" : "den"}&txtOd=${od}`;
  const pager = ico
    ? `<tr><td colspan="7">Aktuálna stránka: ${Array.from({ length: pages }, (_, i) => (i + 1 === pg ? `<span>${i + 1}</span>` : `<a href="${base}&size=${size}&p=${i + 1}">${i + 1}</a>`)).join(" ")} Počet záznamov na stránku: ${[10, 20, 50, 100].map((n) => `<a href="${base}&size=${n}&p=1">${n}</a>`).join(" ")}</td></tr>`
    : "";
  return `<!doctype html><html><head><title>Webový portál Ministerstva spravodlivosti SR</title></head><body>
  <form method="get" action="/ov"><table>
    <tr><td>Dátum zverejnenia:</td><td><input type="radio" name="DatumUverejnenia" value="den" checked onclick="document.getElementById('od').disabled=true;document.getElementById('do').disabled=true"> dňa <input name="txtDen">
      <input type="radio" name="DatumUverejnenia" value="range" onclick="document.getElementById('od').disabled=false;document.getElementById('do').disabled=false"> od <input id="od" name="txtOd" disabled> do <input id="do" name="txtDo" disabled></td></tr>
    <tr><td>IČO:</td><td><input name="txtIco" value=""></td></tr>
    <tr><td colspan="2"><input type="submit" name="btnVyhladat" value="Vyhľadať podania"></td></tr>
  </table></form>
  ${ico ? `<table><tr><th>#</th><th>Typ podania</th><th>Dátum zverejnenia</th><th>Kapitola OV</th><th>Subjekt</th><th>Obchodný vestník</th><th></th></tr>
    ${slice.map((n, i) => `<tr><td>${(pg - 1) * size + i + 1}</td><td>${n.typ}</td><td>${n.date}</td><td>${n.kap}</td><td>FIRMA, a.s.</td><td><a href="#">${n.cislo}</a></td><td><a href="#">Detail</a></td></tr>`).join("")}
    ${pager}</table>` : ""}
  </body></html>`;
}

async function main() {
  useMemoryKV();
  if (!process.env.CHROMIUM_PATH && existsSync("/opt/pw-browsers/chromium")) process.env.CHROMIUM_PATH = "/opt/pw-browsers/chromium";
  if (!(await browserAvailable()).ok) return console.log("PRESKOČENÉ – prehliadač nie je k dispozícii");
  const reqs: string[] = [];
  const srv = createServer((req, res) => {
    reqs.push(req.url || "");
    const u = new URL(req.url || "/", "http://x");
    res.setHeader("content-type", "text/html; charset=utf-8");
    res.end(page(u.searchParams));
  });
  await new Promise<void>((r) => srv.listen(0, "127.0.0.1", r));
  const url = `http://127.0.0.1:${(srv.address() as AddressInfo).port}/ov`;

  // 1) bez nálezu za 3 roky: rozsah dátumov nastavený cez prepínač, všetky oznámenia na jednej stránke
  const c = await ovFlow("33333333", { url, hosts: ["127.0.0.1"] });
  assert.equal(c.verdict, "clean", JSON.stringify(c).slice(0, 400));
  assert.ok(reqs.some((r) => r.includes("DatumUverejnenia=range") && r.includes("txtOd=")), "prepínač rozsahu a dátum od");
  assert.ok(/oznámení za 3 roky \(všetky strany\)/.test(c.evidence || ""), c.evidence);
  console.log(`OK – OV bez nálezu: ${c.evidence}.`);

  // 2) likvidácia pred 2 rokmi (pri 10 na stránku by bola až na 2. strane) → nález
  const f = await ovFlow("11111111", { url, hosts: ["127.0.0.1"] });
  assert.equal(f.verdict, "found", JSON.stringify(f).slice(0, 400));
  assert.ok(f.rows[0].startsWith("likvidácia:"), f.rows[0]);
  console.log(`OK – OV nález z ďalších riadkov: ${f.rows[0]}.`);

  // 2b) filter dátumu nezaberie → 25 oznámení, 100 na stránku, rozhodne dátum v riadkoch
  const g = await ovFlow("44444444", { url, hosts: ["127.0.0.1"] });
  assert.equal(g.verdict, "found");
  assert.ok(reqs.some((r) => r.includes("txtIco=44444444") && r.includes("size=100")), "prepnuté na 100 na stránku");
  console.log("OK – bez filtra dátumu: 100 na stránku a dátumy v riadkoch.");

  // 3) likvidácia pred 5 rokmi → mimo 3 rokov, bez nálezu
  const o = await ovFlow("22222222", { url, hosts: ["127.0.0.1"] });
  assert.equal(o.verdict, "clean", JSON.stringify(o).slice(0, 400));
  console.log("OK – staré oznámenie (5 rokov) sa nepočíta.");
  srv.close();
  console.log("OK – testy Obchodného vestníka cez prehliadač prešli.");
  process.exit(0);
}

main().catch((e) => {
  console.error("FAIL", e);
  process.exit(1);
});
