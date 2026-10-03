/** Testy databázy preverených spoločností (pamäťové úložisko). Spustenie: npm test */
import assert from "node:assert/strict";
import { audit } from "../lib/audit";
import { useMemoryKV } from "../lib/auth/kv";
import { agoLabel, daysSince, listCompanies, recordScan, removeCompany, STALE_DAYS } from "../lib/companies";

async function main() {
  useMemoryKV();
  const day = 86400000;
  const iso = (daysAgo: number) => new Date(Date.now() - daysAgo * day).toISOString();

  // Staršie preverenia existujú len v audite – zoznam sa z nich doplní pri prvom načítaní
  await audit({ type: "scan", by: "jana@kancelaria.sk", ico: "31318177", company: "C.C.C. s.r.o.", verdict: "not_recommended", score: 0, scanId: "SK-1" });
  const seeded = await listCompanies();
  assert.equal(seeded.length, 1);
  assert.equal(seeded[0].name, "C.C.C. s.r.o.");
  assert.equal(seeded[0].days, 0);
  assert.equal(seeded[0].stale, false);

  // Nové preverenia; staršie preverenie toho istého IČO nesmie prepísať novšie
  await recordScan({ ico: "47244895", name: "URBAN & PARTNERS s.r.o.", by: "antonin@kancelaria.sk", verdict: "recommended", score: 100, scanId: "SK-2", at: iso(200) });
  await recordScan({ ico: "47244895", name: "URBAN & PARTNERS s.r.o.", by: "peter@kancelaria.sk", verdict: "caution", score: 70, scanId: "SK-3", at: iso(10) });
  await recordScan({ ico: "47244895", name: "URBAN & PARTNERS s.r.o.", by: "stary@kancelaria.sk", verdict: "recommended", score: 95, scanId: "SK-0", at: iso(400) });
  await recordScan({ ico: "35757442", name: "Stará firma a.s.", by: "jana@kancelaria.sk", verdict: "recommended", score: 90, scanId: "SK-4", at: iso(STALE_DAYS + 1) });

  const all = await listCompanies();
  assert.deepEqual(all.map((c) => c.ico), ["31318177", "47244895", "35757442"], "zoradené od posledného preverenia");
  const urban = all[1];
  assert.equal(urban.count, 3);
  assert.equal(urban.lastBy, "peter@kancelaria.sk");
  assert.equal(urban.verdict, "caution");
  assert.equal(urban.days, 10);
  assert.equal(urban.stale, false);
  assert.equal(daysSince(urban.firstAt), 400, "prvé preverenie je najstaršie");
  const stara = all[2];
  assert.equal(stara.stale, true, `po ${STALE_DAYS} dňoch je preverenie zastarané`);
  assert.equal(stara.days, STALE_DAYS + 1);

  // Filter „len moje“
  const jana = await listCompanies({ by: "jana@kancelaria.sk" });
  assert.deepEqual(jana.map((c) => c.ico), ["31318177", "35757442"]);

  // Odstránenie
  await removeCompany("35757442");
  assert.equal((await listCompanies()).length, 2);

  // Popis veku
  assert.equal(agoLabel(0), "dnes");
  assert.equal(agoLabel(1), "včera");
  assert.equal(agoLabel(2), "pred 2 dňami");
  assert.equal(agoLabel(181), "pred 181 dňami");

  console.log("OK – testy databázy preverených spoločností prešli.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
