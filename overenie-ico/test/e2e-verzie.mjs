// Voliteľný E2E test verzií Firma/Advokát (vyžaduje playwright)
import { chromium } from "playwright";
import assert from "node:assert/strict";
const B = "http://127.0.0.1:3100";
const b = await chromium.launch();
const errs = [];
async function signup(page, email, code, pw) {
  await page.goto(B + "/login?mode=code&email=" + encodeURIComponent(email));
  await page.fill("#code", code); await page.fill("#pw", pw); await page.fill("#pw2", pw);
  await page.click("button.btn"); await page.waitForURL(B + "/app");
}
// Admin = verzia Firma
const a = await b.newContext({ viewport: { width: 1200, height: 900 } });
const p = await a.newPage(); p.on("pageerror", (e) => errs.push(e.message));
await signup(p, "antonin.cajka@publicis.no", "PRVY-ADMIN-2026", "SilneHeslo2026!");
await p.goto(B + "/admin");
await p.fill("#em", "jana.novakova@kancelaria.sk");
await p.selectOption("select[title='Verzia rozhrania']", "advokat");
await p.click("button.btn:has-text('Pridať')");
await p.waitForSelector(".code");
const code = (await p.locator(".code").first().textContent()).trim();
// meno pre admina
p.once("dialog", (d) => d.accept("Antonín Čajka"));
await p.locator("tr", { hasText: "antonin.cajka" }).locator("text=doplniť meno").first().click();
await p.waitForSelector("text=Antonín Čajka");

await p.goto(B + "/app?ico=47244895");
await p.waitForSelector(".facts");
assert.equal(await p.locator(".modal").count(), 0, "Firma nemá vyskakovacie okno");
assert.equal(await p.locator(".prelim").count(), 0, "Firma nemá predbežný verdikt");
assert.equal(await p.locator("summary", { hasText: "Ďalšie odporúčané overenia" }).count(), 1);
assert.equal(await p.locator("text=Centrálny register exekúcií").isVisible(), false, "neverejné sú schované v rozbaľovacom zozname");
// kontakt
await p.check("text=S touto spoločnosťou komunikujeme");
await p.fill("#cp-name", "Ján Vzor");
await p.fill("#cp-role", "konateľ");
await p.fill("#cp-phone", "+421 905 123 456");
await p.fill("#cp-email", "vzor@urban.sk");
await p.waitForSelector("text=je v obchodnom registri zapísaný ako štatutár");
await p.check("text=Kontaktná osoba je štatutár");
await p.locator(".owner-list label", { hasText: "jana.novakova" }).locator("input").check();
await p.click("text=Uložiť kontakt");
await p.waitForSelector("text=Uložené.");
await p.screenshot({ path: "/tmp/v2-firma.png", fullPage: true });
await p.emulateMedia({ media: "print" });
await p.pdf({ path: "/tmp/v2-firma.pdf", format: "A4", printBackground: true });
await p.emulateMedia({ media: "screen" });

// Advokát
const j = await b.newContext({ viewport: { width: 1200, height: 900 } });
const q = await j.newPage(); q.on("pageerror", (e) => errs.push(e.message));
await signup(q, "jana.novakova@kancelaria.sk", code, "Kancel4riaHeslo!");
await q.goto(B + "/app?ico=47244895");
await q.waitForSelector(".modal");
await q.screenshot({ path: "/tmp/v2-advokat-modal.png" });
const items = await q.locator(".mlist li").count();
assert.ok(items >= 7, "advokát vidí zoznam manuálnych overení: " + items);
await q.locator(".mlist li", { hasText: "Centrálny register exekúcií" }).locator("text=Bez záznamu").click();
await q.click("text=Dokončím neskôr");
await q.waitForSelector(".prelim");
// kontakt uložený adminom je viditeľný
assert.equal(await q.inputValue("#cp-phone"), "+421 905 123 456");
await q.screenshot({ path: "/tmp/v2-advokat.png", fullPage: true });

// audit obsahuje kontakt
await p.goto(B + "/admin");
await p.selectOption(".filters select", "contact_saved");
await p.waitForSelector("text=+421 905 123 456");
assert.deepEqual(errs, []);
console.log("E2E v2 OK, manuálnych položiek:", items);
await b.close();
