/**
 * Register diskvalifikácií – stránka je aplikácia React, ktorá dáta berie z API (obcan.justice.sk/pilot/api/ress-isu-service/v1).
 * Diagnostika diskvCapture otvorí stránku, zaznamená dopyty XHR/fetch s odpoveďami a skúsi hľadať podľa IČO a mena. Spustenie: npm test
 */
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { diskvCapture } from "../lib/browser/flows";
import { browserAvailable } from "../lib/browser/session";
import { useMemoryKV } from "../lib/auth/kv";

// obal ako na justice.gov.sk: prázdny <div id="root">, formulár vykreslí skript a hľadá cez fetch na /pilot/api
const SHELL = `<!doctype html><html><head><title>Registre</title></head><body><div id="root"></div><script>
const root = document.getElementById("root");
root.innerHTML = '<label for="q">Priezvisko</label><input id="q" name="priezvisko"><button id="b">Vyhľadať</button><div id="out"></div>';
async function go(){ const r = await fetch("/pilot/api/ress-isu-service/v1/diskvalifikacie?priezvisko=" + encodeURIComponent(document.getElementById("q").value));
  const j = await r.json(); document.getElementById("out").textContent = j.content.length ? j.content.map(x => x.meno).join(", ") : "Nenašli sa žiadne záznamy"; }
document.getElementById("b").onclick = go;
document.getElementById("q").addEventListener("keydown", e => { if (e.key === "Enter") go(); });
fetch("/pilot/api/ress-isu-service/v1/ciselniky");
</script></body></html>`;

(async () => {
  useMemoryKV();
  if (!process.env.CHROMIUM_PATH && existsSync("/opt/pw-browsers/chromium")) process.env.CHROMIUM_PATH = "/opt/pw-browsers/chromium";
  if (!(await browserAvailable()).ok) return console.log("PRESKOČENÉ – prehliadač nie je k dispozícii");
  const srv = createServer((req, res) => {
    const u = new URL(req.url || "/", "http://x");
    if (u.pathname.startsWith("/pilot/api/")) {
      res.setHeader("content-type", "application/json");
      const q = u.searchParams.get("priezvisko") || "";
      return res.end(JSON.stringify(u.pathname.endsWith("ciselniky") ? { ok: 1 } : { content: q === "Szabó" ? [{ meno: "Gabriel Szabó", zakazDo: "2027-01-01" }] : [] }));
    }
    res.setHeader("content-type", "text/html; charset=utf-8");
    res.end(SHELL);
  });
  await new Promise<void>((r) => srv.listen(0, "127.0.0.1", r));
  const url = `http://127.0.0.1:${(srv.address() as AddressInfo).port}/registre/registerDiskvalifikacii/`;
  const r = await diskvCapture("31322832", ["Ing. Gabriel Szabó"], { url, hosts: ["127.0.0.1"] });
  const api = r.calls.filter((c) => c.url.includes("/pilot/api/"));
  assert.ok(api.some((c) => c.url.endsWith("/ciselniky")), "zaznamená dopyt pri načítaní");
  const search = api.find((c) => c.url.includes("priezvisko=Szab"));
  assert.ok(search, `zaznamená hľadanie podľa priezviska: ${JSON.stringify(r.steps)}`);
  assert.equal(search!.status, 200);
  assert.match(search!.body || "", /Gabriel Szabó/);
  assert.ok(r.steps.some((s) => /meno: Szabó/.test(s.step) && /Gabriel Szabó/.test(s.rendered || "")), "snímka po hľadaní obsahuje výsledok");
  console.log("OK diskvCapture – dopyty API a hľadanie podľa mena");
  srv.close();
  process.exit(0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
