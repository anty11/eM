/** Prístupy k registrom: proxy pre blokované registre (dopyty servera aj prehliadač) a prístup k exportu OV. Spustenie: npm test */
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { createServer, request as httpRequest } from "node:http";
import { connect } from "node:net";
import type { AddressInfo } from "node:net";
import { accessStatus, getOvAccess, proxyFor, saveAccess } from "../lib/access";
import { useMemoryKV } from "../lib/auth/kv";
import { fetchWithTimeout } from "../lib/http";

async function main() {
  useMemoryKV();
  // cieľový „register“ a jednoduchá proxy (CONNECT tunel aj absolútne URL), ktorá si zapisuje prístupy a prihlásenie
  const target = createServer((req, res) => res.end(`REGISTER OK ${req.url}`));
  await new Promise<void>((r) => target.listen(0, "127.0.0.1", r));
  const tPort = (target.address() as AddressInfo).port;
  const seen: { how: string; host: string; auth?: string }[] = [];
  const proxy = createServer((req, res) => {
    seen.push({ how: "request", host: req.url || "", auth: req.headers["proxy-authorization"] as string });
    const u = new URL(req.url!);
    const up = httpRequest({ host: "127.0.0.1", port: tPort, path: u.pathname + u.search, method: req.method, headers: req.headers }, (r2) => {
      res.writeHead(r2.statusCode || 200, r2.headers);
      r2.pipe(res);
    });
    up.on("error", () => res.destroy());
    req.pipe(up);
  });
  proxy.on("connect", (req, socket, head) => {
    seen.push({ how: "connect", host: req.url || "", auth: req.headers["proxy-authorization"] as string });
    socket.on("error", () => undefined);
    const up = connect(tPort, "127.0.0.1", () => {
      socket.write("HTTP/1.1 200 Connection Established\r\n\r\n");
      up.write(head);
      up.pipe(socket);
      socket.pipe(up);
    });
    up.on("error", () => socket.destroy());
  });
  await new Promise<void>((r) => proxy.listen(0, "127.0.0.1", r));
  const pPort = (proxy.address() as AddressInfo).port;

  // bez nastavenia nič
  assert.equal(await proxyFor("http://registre.test/x"), null);
  await assert.rejects(saveAccess({ proxy: { url: "ftp://x" } }, "a@x.sk"), /tvar/);
  const st = await saveAccess({ proxy: { url: `http://meno:tajne%40heslo@127.0.0.1:${pPort}`, domains: "registre.test, https://www.justice.gov.sk/" } }, "admin@x.sk");
  assert.equal(st.proxy.active, true);
  assert.deepEqual(st.proxy.domains, ["registre.test", "justice.gov.sk", "obcan.justice.sk"]);
  assert.equal(st.proxy.server, `http://127.0.0.1:${pPort}`);
  assert.ok(!JSON.stringify(st).includes("tajne"), "heslo sa nezobrazí");
  assert.ok(await proxyFor("https://obchodnyvestnik.justice.gov.sk/x"), "subdoména ide cez proxy");
  assert.equal(await proxyFor("https://www.uvo.gov.sk/"), null, "iné domény priamo");

  // dopyt servera na nastavenú doménu ide cez proxy (s prihlásením)
  const r = await fetchWithTimeout("http://registre.test/zoznam?ico=1", { timeoutMs: 5000 });
  assert.equal(await r.text(), "REGISTER OK /zoznam?ico=1");
  assert.ok(seen.length >= 1, "proxy bola použitá");
  assert.equal(seen[0].auth, `Basic ${Buffer.from("meno:tajne@heslo").toString("base64")}`);
  console.log(`OK – dopyt servera cez proxy (${seen[0].how}).`);

  // prehliadač (AI agent, skripty) – kontext s proxy pre registre z nastavených domén
  if (!process.env.CHROMIUM_PATH && existsSync("/opt/pw-browsers/chromium")) process.env.CHROMIUM_PATH = "/opt/pw-browsers/chromium";
  const { BrowserSession, browserAvailable } = await import("../lib/browser/session");
  if ((await browserAvailable()).ok) {
    const before = seen.length;
    const s = await BrowserSession.open(["registre.test"]);
    assert.equal(s.proxied, `http://127.0.0.1:${pPort}`);
    const snap = await s.open("http://registre.test/vyhladavanie?ico=2");
    assert.ok(snap.text.includes("REGISTER OK /vyhladavanie?ico=2"), snap.text);
    assert.ok(seen.length > before && seen.slice(before).some((x) => x.host.includes("registre.test")), "prehliadač išiel cez proxy");
    await s.close();
    console.log("OK – prehliadač cez proxy.");
  } else console.log("PRESKOČENÉ – prehliadač nie je k dispozícii.");

  // vypnutie
  await saveAccess({ proxy: { enabled: false } }, "admin@x.sk");
  assert.equal(await proxyFor("http://registre.test/x"), null);

  // export Obchodného vestníka z administrácie
  await assert.rejects(saveAccess({ ov: { exportUrl: "https://ov.example/export.xml" } }, "a"), /\{date\}/);
  await saveAccess({ ov: { exportUrl: "https://ov.example/export/{date}.xml", user: "firma", password: "Heslo-OV-1" } }, "admin@x.sk");
  const ov = await getOvAccess();
  assert.equal(ov?.user, "firma");
  assert.equal(ov?.password, "Heslo-OV-1");
  const st2 = await accessStatus();
  assert.equal(st2.ov.configured, true);
  assert.equal(st2.ov.hasPassword, true);
  assert.ok(!JSON.stringify(st2).includes("Heslo-OV-1"));
  console.log("OK – testy prístupov k registrom prešli.");
  target.close();
  proxy.close();
  process.exit(0);
}

main().catch((e) => {
  console.error("FAIL", e);
  process.exit(1);
});
