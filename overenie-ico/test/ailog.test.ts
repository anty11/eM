/** Záznam AI overení a súhrn na zdieľanie. Spustenie: npm test */
import assert from "node:assert/strict";
import { clearRuns, listRuns, saveRun, summarize } from "../lib/ailog";
import { useMemoryKV } from "../lib/auth/kv";

async function main() {
  useMemoryKV();
  const page = (text: string) => ({ url: "https://reg.example/x", title: "Register", elements: ["input IČO name=ico", "button Hľadať"], tables: [], text });
  await saveRun({ kind: "ai", source: "diskv", ico: "1", result: "unknown", ms: 4000, error: undefined, rejected: "AI formulár registra neodoslala", actions: [{ at: "", action: "open https://reg.example/x", ok: true }], pages: [page("403 Forbidden nginx")] });
  await saveRun({
    kind: "ai",
    source: "ov",
    ico: "2",
    result: "clean",
    ms: 9000,
    steps: 2,
    provider: "anthropic",
    model: "claude-sonnet-5",
    actions: [
      { at: "", action: "open https://reg.example/ov", ok: true },
      { at: "", action: "fill e3 ← 2", ok: true, target: { kind: "input", name: "ctl00$CphMain$txtIco", label: "IČO:" }, value: "2" },
      { at: "", action: "fill e9 ← x", ok: false, target: { kind: "input", name: "txtDatumOd" }, value: "x" },
      { at: "", action: "click e12", ok: true, target: { kind: "button", label: "Vyhľadať" } },
    ],
    pages: [page("formulár"), page("Podanie Obchodného registra")],
  });
  await saveRun({ kind: "flow", source: "ov", ico: "3", result: "unknown", ms: 3000, error: "pole IČO sa nenašlo", pages: [page("formulár bez poľa")] });
  // veľké snímky sa skrátia
  await saveRun({ kind: "ai", source: "uvo", ico: "4", result: "clean", ms: 1, pages: Array.from({ length: 15 }, () => ({ ...page("x".repeat(2500)), tables: [Array.from({ length: 12 }, () => Array(8).fill("y".repeat(120)))] })) });

  const all = await listRuns();
  assert.equal(all.length, 4);
  assert.equal(all[0].source, "uvo", "najnovší prvý");
  assert.equal((await listRuns({ source: "ov" })).length, 2);

  const sum = summarize(all);
  const ov = sum.sources.find((s) => s.source === "ov")!;
  assert.deepEqual(ov.results, { clean: 1, found: 0, unknown: 1 });
  assert.deepEqual(ov.kinds, { ai: 1, flow: 1 });
  assert.deepEqual(
    ov.lastSuccess!.recipe.map((r) => [r.do, r.target?.name || r.target?.label || r.url]),
    [["open", "https://reg.example/ov"], ["fill", "ctl00$CphMain$txtIco"], ["click", "Vyhľadať"]],
    "recept len z úspešných akcií",
  );
  assert.equal(ov.lastSuccess!.resultPage!.text, "Podanie Obchodného registra");
  assert.equal(ov.lastFailure!.error, "pole IČO sa nenašlo");
  const dk = sum.sources.find((s) => s.source === "diskv")!;
  assert.equal(dk.lastFailure!.pages![0].text, "403 Forbidden nginx");
  assert.equal(sum.sources[0].results.unknown >= sum.sources[sum.sources.length - 1].results.unknown, true, "registre s neúspechmi prvé");
  await clearRuns();
  assert.equal((await listRuns()).length, 0);
  console.log("OK – testy záznamu AI overení prešli.");
}

main().catch((e) => {
  console.error("FAIL", e);
  process.exit(1);
});
