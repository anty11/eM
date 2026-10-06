/**
 * Prehliadače v jednej inštancii: najviac BROWSER_MAX_PER_INSTANCE naraz, ďalší čaká na uvoľnenie (záťažová skúška 6. 10. 2026 –
 * súbežné spúšťanie Chromia padalo na „spawn ETXTBSY“ a prehliadače si konkurovali o CPU). Spustenie: npm test
 */
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { useMemoryKV } from "../lib/auth/kv";
import { BrowserSession, browserAvailable } from "../lib/browser/session";

(async () => {
  useMemoryKV();
  if (!process.env.CHROMIUM_PATH && existsSync("/opt/pw-browsers/chromium")) process.env.CHROMIUM_PATH = "/opt/pw-browsers/chromium";
  if (!(await browserAvailable()).ok) return console.log("PRESKOČENÉ – prehliadač nie je k dispozícii");
  process.env.BROWSER_MAX_PER_INSTANCE = "1";
  const a = await BrowserSession.open(["example.test"]);
  let bReady = false;
  const bP = BrowserSession.open(["example.test"]).then((b) => ((bReady = true), b));
  await new Promise((r) => setTimeout(r, 800));
  assert.equal(bReady, false, "druhý prehliadač čaká, kým beží prvý");
  await a.close();
  const b = await bP;
  assert.ok(bReady, "po zatvorení prvého sa druhý spustí");
  await b.close();
  await b.close(); // dvojité zatvorenie neuvoľní slot dvakrát
  const c = await Promise.race([BrowserSession.open(["example.test"]), new Promise<null>((r) => setTimeout(() => r(null), 15000))]);
  assert.ok(c, "slot je opäť voľný");
  await c!.close();
  console.log("OK – prehliadače v inštancii: limit súbežnosti a uvoľnenie slotu.");
  process.exit(0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
