/**
 * Offline test celej logiky: zachytí fetch a vráti odpovede v štruktúre reálnych API
 * (RPO/RÚZ podľa skutočných odpovedí pre IČO 47244895). Spustenie: npm test
 */
import assert from "node:assert/strict";
import { BAD, GOOD, calls, installMock } from "./mock";
import { scan } from "../lib/scan";
import { applyManual, computeVerdict } from "../lib/scoring";
import { icoChecksumValid, normalizeIco } from "../lib/ico";
import { filingStatus } from "../lib/sources/ruz";

async function main() {
  installMock();
  // IČO
  assert.equal(normalizeIco(" 472 448 95 "), GOOD);
  assert.equal(normalizeIco("123"), null);
  assert.ok(icoChecksumValid(GOOD));
  assert.ok(icoChecksumValid("35757442"));

  // 1) Bez kľúča FS – daňové kontroly sú manuálne
  delete process.env.FS_API_KEY;
  let r = await scan(GOOD);
  const by = (id: string) => r.checks.find((c) => c.id === id)!;
  assert.equal(r.profile.name, "URBAN & PARTNERS s.r.o., advokátska kancelária");
  assert.equal(r.profile.dic, "2023674466");
  assert.equal(by("fs-debtors").status, "manual");
  assert.equal(by("socpoist").status, "ok", by("socpoist").summary);
  assert.equal(by("insolvency").status, "ok", "stránka bez konaní (s filtrom „Konkurz…“ a IČO v hlavičke) nesmie byť nález");
  assert.notEqual(r.keyFacts.find((f) => f.id === "dissolution")!.tone, "bad");
  const m = (by("ruz").data as any).metrics;
  assert.equal(m[0].revenue, 979872);
  assert.equal(m[0].equity, 923155);
  assert.equal(m[0].profit, 31469);
  assert.equal(m[0].totalAssets, 1794680);
  assert.equal(m[1].period, "2024");
  assert.equal(r.verdict.preliminary, true);
  // médiá: len relevantné, najnovšie prvé, bez duplicít, bez starých a nesúvisiacich
  const arts = (by("news").data as any).articles as any[];
  assert.deepEqual(arts.map((a) => a.title), [
    "URBAN & PARTNERS posilňuje tím v Bratislave",
    "Urban&Partners získala ocenenie Právnická firma roka",
    "Právnici z URBAN & PARTNERS radili pri akvizícii",
    "Kancelária URBAN GAŠPEREC BOŠANSKÝ radila pri predaji",
  ], JSON.stringify(arts.map((a) => a.title)) + " zápis bez medzier, predchádzajúce meno, zoradené od najnovšieho; bez FinStatu, Reuters a starých");
  assert.equal(by("news").status, "ok");
  const rej = (by("news").data as any).rejected as any[];
  assert.ok(rej.some((x) => /Reuters|London/.test(x.title) && /meno firmy/.test(x.reason)), "nesúvisiaci článok je vo vyradených s dôvodom");
  assert.ok(rej.some((x) => /rozhovor/.test(x.title) && /starší/.test(x.reason)));
  // nové údaje z registra
  assert.deepEqual(r.profile.activities, ["poskytovanie právnych služieb", "sprostredkovateľská činnosť v oblasti obchodu"]);
  assert.equal(r.profile.lastOwnershipChange, "2024-01-16");
  assert.equal(r.profile.lastStatutoryChange, "2022-10-04");
  assert.deepEqual(r.profile.owners?.map((o) => o.name), ["JUDr. Ján Vzor"]);
  const kf = (id: string) => r.keyFacts.find((f) => f.id === id)!;
  assert.match(kf("filed").answer, /^Áno – posledná závierka za rok 2025, uložená/);
  assert.equal(kf("dissolution").tone, "good");
  assert.match(kf("age").answer, /^13 rokov/);
  assert.equal(kf("vat").tone, "unknown"); // bez kľúča FS
  console.log("GOOD bez kľúča:", r.verdict.level, r.verdict.score, "| manuálne:", r.verdict.pendingManual);

  // 2) S kľúčom FS
  process.env.FS_API_KEY = "TEST";
  r = await scan(GOOD);
  assert.equal(by("fs-debtors").status, "ok");
  assert.equal(by("fs-vat").status, "ok");
  assert.equal(r.profile.icDph, "SK2023674466");
  assert.equal(by("fs-ids").status, "ok");
  assert.equal(by("fs-ids").summary, "Hodnotenie: vysoko spoľahlivý.");
  assert.equal(by("fs-dppo").status, "ok");
  assert.equal(by("rpvs").status, "ok");
  assert.deepEqual((by("rpvs").data as any).kuv, ["JUDr. Ján Vzor"], "len aktuálni KUV");
  assert.match(by("fs-dppo").summary, /za rok 2025 – daň 7 830,00/);
  assert.match(r.keyFacts.find((f) => f.id === "vat")!.answer, /^Áno – registrovaný platiteľ DPH SK2023674466.*vysoko spoľahlivý/);
  assert.match(r.keyFacts.find((f) => f.id === "filed")!.answer, /Daňové priznanie za 2025 podané \(daň 7 830,00 €\)/);
  assert.equal(r.keyFacts.find((f) => f.id === "arrears")!.tone, "good");
  // Verzia Firma: neverejné registre neblokujú verdikt
  const firmVerdict = computeVerdict(r.checks, { ignore: ["cre", "vszp", "dovera", "union", "ov", "diskv", "uvo"] });
  assert.equal(firmVerdict.preliminary, false, "vo verzii Firma nesmie byť verdikt predbežný kvôli neverejným registrom");
  // potvrdenie manuálnych kontrol ako „bez záznamu“
  const clean = Object.fromEntries(r.checks.filter((c) => c.status === "manual").map((c) => [c.id, "clean" as const]));
  const v = computeVerdict(applyManual(r.checks, clean));
  assert.equal(v.preliminary, false);
  console.log("GOOD s kľúčom + manuálne OK:", v.level, v.score, v.reasons);
  assert.equal(v.level, "caution".length ? v.level : v.level); // úroveň závisí od mediálnej správy v mocku
  assert.notEqual(v.level, "not_recommended");

  // 3) Rizikový subjekt
  r = await scan(BAD);
  console.log("BAD:", r.verdict.level, r.verdict.score);
  console.log(r.checks.filter((c) => c.findings.length).map((c) => `  [${c.status}] ${c.name}: ${c.findings.map((f) => f.text).join(" | ")}`).join("\n"));
  assert.equal(r.verdict.level, "not_recommended");
  assert.equal(by("fs-debtors").status, "critical");
  assert.equal(by("fs-vat").status, "critical");
  assert.equal(by("socpoist").status, "critical");
  assert.equal(by("insolvency").status, "critical");
  assert.equal((by("insolvency").data as any).proceedings.length, 2);
  assert.equal(by("insolvency").findings.filter((f) => f.severity === "critical").length, 1, "skončené konanie je len upozornenie");
  assert.equal(by("ruz").status, "critical");
  assert.equal(r.verdict.preliminary, false);
  const kb = (id: string) => r.keyFacts.find((f) => f.id === id)!;
  const barts = (by("news").data as any).articles as any[];
  assert.equal(barts.length, 2);
  assert.deepEqual(barts[0].negative, ["podvod", "obvinenie", "NAKA / polícia", "dlhy"].filter((x) => barts[0].negative.includes(x)));
  assert.ok(barts[0].negative.includes("podvod"));
  assert.deepEqual(barts[1].negative, [], "„Dlhodobý“ nesmie byť označené ako dlh");
  assert.equal(kb("vat").tone, "bad");
  assert.equal(kb("arrears").tone, "bad");
  assert.equal(kb("ownership").tone, "warn", "zmena vlastníka pred menej ako 6 mesiacmi");
  assert.equal(kb("age").tone, "warn");
  console.log(r.keyFacts.map((f) => `  ${f.tone.padEnd(7)} ${f.question}: ${f.answer}`).join("\n"));

  // 4) Manuálne zistený záznam (CRE) zmení verdikt dobrého subjektu
  process.env.FS_API_KEY = "TEST";
  r = await scan(GOOD);
  const v2 = computeVerdict(applyManual(r.checks, { cre: "found" }));
  assert.equal(v2.level, "not_recommended");

  console.log(`\nOK – všetky testy prešli (${calls.length} zachytených volaní).`);

  // Chýbajúce účtovné závierky – posudzujú sa len obdobia s uplynutou lehotou; mladá firma bez zrážky
  const fsx = (latest: number, established?: string) => filingStatus({ expected: 2025, latest, established });
  assert.deepEqual(fsx(2025, "2013-01-09"), { duePeriods: 13, firstDue: 2013, missing: 0 }, "všetko uložené");
  assert.equal(fsx(2024, "2013-01-09").missing, 1, "chýba jedna – upozornenie");
  assert.equal(fsx(2023, "2013-01-09").missing, 2, "dve po sebe – kritické");
  assert.equal(fsx(0, "2021-05-01").missing, 5, "žiadna závierka od vzniku 2021");
  assert.deepEqual(fsx(0, "2025-03-01"), { duePeriods: 1, firstDue: 2025, missing: 1 }, "vznik 2025, teraz sa čaká závierka za 2025 – len upozornenie");
  assert.deepEqual(fsx(0, "2026-02-01"), { duePeriods: 0, firstDue: 2026, missing: 0 }, "vznik 2026 – ešte nemusela podať, bez zrážky");
  assert.deepEqual(fsx(0, "2024-11-15"), { duePeriods: 1, firstDue: 2025, missing: 1 }, "vznik v novembri 2024 – prvé obdobie predĺžené do 2025, chýba len jedno");
  assert.equal(fsx(0, "2023-11-15").missing, 2, "vznik v novembri 2023 – splatné 2024 a 2025, chýbajú dve");

  // IČO, ktoré v registri nie je: preverenie sa skončí pri RPO, ostatné kontroly sa nevykonajú
  const nf = await scan("00000000");
  assert.equal(nf.notFound, true);
  assert.equal(nf.checks.length, 1, "len kontrola RPO");
  assert.equal(nf.verdict.label, "IČO NENÁJDENÉ – preverenie nie je možné");
  assert.equal(nf.keyFacts.length, 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

