/** Spätné preverenie k rozhodnému dátumu – čo bolo zistiteľné z registrov. Spustenie: npm test */
import assert from "node:assert/strict";
import { installMock, GOOD } from "./mock";
import { scan } from "../lib/scan";
import { retroLines } from "../lib/retro";

async function main() {
  installMock();
  // Rozhodný dátum pred zmenou spoločníka (16. 1. 2024) a pred premenovaním na URBAN & PARTNERS
  const r = await scan(GOOD, undefined, { asOf: "2023-06-15" });
  assert.equal(r.asOf, "2023-06-15");
  const rpo = r.checks.find((c) => c.id === "rpo")!.data!.asOf as any;
  assert.equal(rpo.existed, true);
  assert.equal(rpo.name, "URBAN GAŠPEREC BOŠANSKÝ, s.r.o., advokátska kancelária", "názov platný k rozhodnému dátumu");
  assert.deepEqual(rpo.owners, ["Ferko Mrkvička"], "spoločník k rozhodnému dátumu, nie dnešný");
  assert.deepEqual(rpo.statutory, ["Janko Mrkvička"]);
  assert.equal(rpo.changesAfter.owners, 1, "po rozhodnom dátume pribudol nový spoločník");
  const ruz = r.checks.find((c) => c.id === "ruz")!.data!.asOf as any;
  assert.deepEqual(ruz.filedYears, [], "závierky za 2024/2025 boli uložené až po rozhodnom dátume");
  assert.equal(ruz.expectedThen, 2021);
  const lines = retroLines(r.asOf!, r.profile, r.checks);
  assert.ok(lines.some((l) => l.source === "Obchodný register" && /Ferko Mrkvička/.test(l.text)));
  assert.ok(lines.some((l) => /nemajú verejnú históriu/.test(l.text)), "čestné upozornenie na neoveriteľné zoznamy");
  assert.ok(lines.some((l) => l.source === "Register úpadcov"));
  // bez rozhodného dátumu žiadne retro údaje
  const plain = await scan(GOOD);
  assert.equal(plain.asOf, undefined);
  assert.equal(plain.checks.find((c) => c.id === "rpo")!.data!.asOf, undefined);
  console.log("OK – testy spätného preverenia prešli.");
}
main().catch((e) => { console.error(e); process.exit(1); });
