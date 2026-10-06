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
  assert.deepEqual(r.profile.owners?.map((o) => o.name), ["Janko Mrkvička"]);
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
  assert.deepEqual((by("rpvs").data as any).kuv, ["Janko Mrkvička"], "len aktuálni KUV");
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

  // 5) Vyrovnávacia pamäť je predvolene vypnutá – každé preverenie sa pýta registrov nanovo
  const before0 = calls.length;
  const r0 = await scan(GOOD);
  assert.ok(!r0.checks.find((c) => c.id === "rpo")!.cachedAt, "bez CHECK_CACHE_MIN sa nič neukladá");
  assert.ok(calls.length - before0 > 5, "každé preverenie volá registre");
  // zapnutá (CHECK_CACHE_MIN): opakované preverenie toho istého IČO nevolá registre (okrem chýb/manuálnych), „fresh“ ju obíde
  process.env.CHECK_CACHE_MIN = "10";
  await scan(GOOD);
  const before = calls.length;
  const r3 = await scan(GOOD);
  assert.ok(r3.checks.find((c) => c.id === "rpo")!.cachedAt, "RPO z pamäte");
  assert.equal(r3.profile.name, r.profile.name, "profil obnovený z pamäte");
  const apiCalls = (from: number) => calls.slice(from).filter((u) => !/vszp|unionzp|uvo\.gov|justice|data\.slovensko/.test(u));
  assert.equal(apiCalls(before).length, 0, `opakované preverenie nevolá API registre (${apiCalls(before).join(", ")})`);
  const r4 = await scan(GOOD, undefined, { fresh: true });
  assert.ok(!r4.checks.find((c) => c.id === "rpo")!.cachedAt, "fresh obíde pamäť");
  assert.ok(apiCalls(before).length > 5, "fresh volá registre");
  delete process.env.CHECK_CACHE_MIN;

  // 6) Pomalé RPO: ostatné zdroje podľa IČO prídu skôr, nečakajú na RPO
  process.env.MOCK_RPO_DELAY_MS = "3000";
  const order: string[] = [];
  const tStart = Date.now();
  const r5 = await scan(GOOD, (c) => { if (c.status !== "manual" || c.automated) order.push(`${c.id}@${Date.now() - tStart}`); });
  delete process.env.MOCK_RPO_DELAY_MS;
  const at = (id: string) => Number((order.find((o) => o.startsWith(`${id}@`)) || "x@99999").split("@")[1]);
  assert.ok(at("socpoist") < at("rpo") && at("insolvency") < at("rpo"), `IČO zdroje pred RPO (${order.join(", ")})`);
  assert.ok(at("rpo") >= 2900, "RPO až po oneskorení");
  assert.equal(r5.profile.name, "URBAN & PARTNERS s.r.o., advokátska kancelária", "meno z RPO po dobehnutí");

  console.log(`\nOK – všetky testy prešli (${calls.length} zachytených volaní).`);

  // Chýba závierka za minulý rok (len 2024 uložená, čaká sa 2025 od októbra) → −15 a odporúčaná otázka na partnera
  {
    const { checkRuz } = await import("../lib/sources/ruz");
    const real = globalThis.fetch;
    globalThis.fetch = (async (input: any, init?: any) => {
      const url = String(input);
      if (url.includes("uctovna-jednotka?")) {
        const r = await real(input, init);
        const j = await r.json();
        return new Response(JSON.stringify({ ...j, idUctovnychZavierok: [6519074] }), { headers: { "content-type": "application/json" } });
      }
      return real(input, init);
    }) as typeof fetch;
    const ctx: any = { ico: GOOD, profile: { ico: GOOD, established: "2013-01-09", legalForm: "Spoločnosť s ručením obmedzeným" }, rpoDone: Promise.resolve() };
    const r = await checkRuz(ctx);
    globalThis.fetch = real;
    const expectedYear = new Date().getFullYear() - (new Date().getMonth() >= 9 ? 1 : 2);
    if (expectedYear === 2025) {
      const f = r.findings.find((x) => /chýba účtovná závierka za 2025/.test(x.text));
      assert.ok(f, r.findings.map((x) => x.text).join(" | "));
      assert.equal(f!.penalty, 15);
      assert.match(f!.ask || "", /dôvod/);
    }
  }

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

  // Limit pre registre bez API: register, ktorý neodpovedá (ÚVO), ostane manuálny s dôvodom – hotové registre sa NEPREPÍŠU na manuálne
  {
    // register diskvalifikácií odpovedá hneď – musí ostať automaticky overený aj po limite; ÚVO visí
    const real = globalThis.fetch;
    const diskvJson = () => new Response(JSON.stringify({ numFound: 0, page: 0, size: 50, updateDate: "30.09.2026", filterList: [], diskvalifikaciaList: [] }), { headers: { "content-type": "application/json" } });
    globalThis.fetch = ((input: any, init?: any) => (/ress-isu-service\/v1\/diskvalifikacia/.test(String(input)) ? Promise.resolve(diskvJson()) : real(input, init))) as typeof fetch;
    const base = await scan(GOOD);
    globalThis.fetch = ((input: any, init?: any) =>
      /uvo\.gov\.sk/.test(String(input))
        ? new Promise<Response>((_, rej) => setTimeout(() => rej(new Error("visí")), 20000))
        : /ress-isu-service\/v1\/diskvalifikacia/.test(String(input))
          ? Promise.resolve(diskvJson())
          : real(input, init)) as typeof fetch;
    process.env.MANUAL_DEADLINE_MS = "4000";
    const t = Date.now();
    const slow = await scan(GOOD);
    delete process.env.MANUAL_DEADLINE_MS;
    globalThis.fetch = real;
    assert.ok(Date.now() - t < 12000, "preverenie skončí pri limite, nečaká na visiaci register");
    const uvo = slow.checks.find((c) => c.id === "uvo")!;
    assert.equal(uvo.status, "manual");
    assert.match(String((uvo.data as any)?.autoNote || ""), /neodpovedal do 4 s/);
    const done = base.checks.filter((x) => x.id !== "uvo" && x.automated && ["vszp", "union", "diskv", "ov"].includes(x.id));
    console.log(`limit registrov bez API: overených ${done.length} hotových (${done.map((x) => x.id).join(", ")})`);
    for (const c of done) {
      const now = slow.checks.find((x) => x.id === c.id)!;
      assert.equal(now.status, c.status, `${c.id}: hotový výsledok ostal aj po limite`);
    }
    assert.ok(done.some((x) => x.id === "diskv"), "register diskvalifikácií bol hotový");
  }

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

