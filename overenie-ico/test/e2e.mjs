// Voliteľný E2E test: npm i -D playwright && npx playwright install chromium; spustite server podľa README a potom: node test/e2e.mjs
import { chromium } from "playwright";
import assert from "node:assert/strict";
const B = "http://127.0.0.1:3100";
async function call(page, method, url, data, headers = {}) {
  return page.evaluate(async ([method, url, data, headers]) => {
    const r = await fetch(url, { method, headers: { "Content-Type": "application/json", ...headers }, body: data ? JSON.stringify(data) : undefined });
    return { status: r.status, text: await r.text() };
  }, [method, url, data, headers]);
}

const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 1200, height: 900 } });
const p = await ctx.newPage();
p.on("pageerror", (e) => console.log("PAGEERROR", e.message));

// 1) neprihlásený → login
await p.goto(B + "/?ico=47244895");
assert.match(p.url(), /\/login\?next=/);
let r = await call(p, "GET", "/api/check?ico=47244895");
assert.equal(r.status, 401);
await p.screenshot({ path: "/tmp/e2e-1-login.png" });

// 2) prvý admin
await p.click("text=Prvé prihlásenie");
await p.fill("#email", "antonin.cajka@publicis.no");
await p.fill("#code", "PRVY-ADMIN-2026");
await p.fill("#pw", "SilneHeslo2026!");
await p.fill("#pw2", "SilneHeslo2026!");
await p.click("button.btn");
await p.waitForSelector(".verdict", { timeout: 30000 });
assert.match(p.url(), /ico=47244895/);
console.log("admin prihlásený, sken hotový");

// 3) admin – pridanie používateľov
await p.goto(B + "/admin");
await p.fill("#em", "jana.novakova@kancelaria.sk; peter.horvath@kancelaria.sk\nnie-je-email@");
await p.click("button.btn:has-text(\"Pridať\")");
await p.waitForSelector(".code");
const code = (await p.locator("tr", { hasText: "jana.novakova" }).locator(".code").textContent()).trim();

await p.waitForTimeout(600);
await p.screenshot({ path: "/tmp/e2e-2-admin.png", fullPage: true });
console.log("kód pre Janu:", code);

// 4) odhlásenie, prihlásenie Jany
await p.click("text=Odhlásiť");
await p.waitForURL(/login/);
await p.fill("#email", "jana.novakova@kancelaria.sk");
await p.fill("#pw", "cokolvek12345");
await p.click("button.btn");
await p.waitForSelector("#code"); // prepne na nastavenie hesla
await p.fill("#code", code);
await p.fill("#pw", "Kancel4riaHeslo!");
await p.fill("#pw2", "Kancel4riaHeslo!");
await p.click("button.btn");
await p.waitForURL(B + "/");
assert.equal(await p.locator("text=Administrácia").count(), 0);
await p.goto(B + "/admin");
assert.equal(new URL(p.url()).pathname, "/");
r = await call(p, "GET", "/api/admin/users");
assert.equal(r.status, 403);
r = await call(p, "POST", "/api/admin/users", { emails: "x@y.sk" });
assert.equal(r.status, 403);
await p.fill("input[aria-label=IČO]", "31318177");
await p.click("text=Preveriť");
await p.waitForSelector(".verdict", { timeout: 30000 });
await p.screenshot({ path: "/tmp/e2e-3-user.png" });
console.log("Jana: bez prístupu do administrácie, sken OK");

// 5) admin vidí audit s oboma skenmi, zablokuje Janu → jej relácia prestane platiť
const a = await b.newContext({ viewport: { width: 1200, height: 900 } });
const ap = await a.newPage();
await ap.goto(B + "/login");
await ap.fill("#email", "antonin.cajka@publicis.no");
await ap.fill("#pw", "SilneHeslo2026!");
await ap.click("button.btn");
await ap.waitForURL(B + "/");
const log = JSON.parse((await call(ap, "GET", "/api/admin/log?type=scan")).text);
assert.deepEqual(log.map((e) => [e.by, e.ico]), [["jana.novakova@kancelaria.sk", "31318177"], ["antonin.cajka@publicis.no", "47244895"]]);
const csv = (await call(ap, "GET", "/api/admin/log?format=csv&type=scan")).text;
assert.match(csv, /31318177/);
r = await call(ap, "PATCH", "/api/admin/users", { email: "jana.novakova@kancelaria.sk", action: "disable" });
assert.equal(r.status, 200);
r = await call(p, "GET", "/api/check?ico=47244895");
assert.equal(r.status, 401, "zablokovaný používateľ nesmie pokračovať");
// CSRF: POST z cudzieho pôvodu
// CSRF: prehliadač nedovolí podvrhnúť Origin, preto overíme serverovú kontrolu priamo cez Node s platným cookie
const ck = (await a.cookies()).find((c) => c.name === "oi_session");
const rr = await fetch(B + "/api/admin/users", { method: "PATCH", headers: { cookie: "oi_session=" + ck.value, origin: "https://zly.example", "content-type": "application/json" }, body: JSON.stringify({ email: "jana.novakova@kancelaria.sk", action: "enable" }) });
assert.equal(rr.status, 403);
await ap.goto(B + "/admin");
await ap.waitForSelector("text=Zablokovaný");
await ap.waitForTimeout(500);
await ap.screenshot({ path: "/tmp/e2e-4-admin-log.png", fullPage: true });
console.log("E2E OK");
await b.close();
