/** Testy hodnotenia: stropy upozornení, kritické nálezy, zaradenie právnych skutočností z registra. Spustenie: npm test */
import assert from "node:assert/strict";
import { computeVerdict, WARNING_CAP } from "../lib/scoring";
import { classifyLegalFact } from "../lib/sources/rpo";
import type { CheckResult, Finding } from "../lib/types";

const check = (id: string, findings: Finding[]): CheckResult =>
  ({ id, category: "register", name: id, source: "", sourceUrl: "", status: "ok", summary: "", findings, checkedAt: "", durationMs: 0, automated: true }) as CheckResult;
const w = (p: number): Finding => ({ severity: "warning", text: "u", penalty: p });
const c = (p: number): Finding => ({ severity: "critical", text: "k", penalty: p });
const pos = (p: number): Finding => ({ severity: "positive", text: "+", penalty: -p });

function main() {
  // samotné upozornenia nikdy nedajú „Neodporúčame“ – strop WARNING_CAP
  const many = computeVerdict([check("a", [w(10), w(10), w(10), w(15), w(15), w(8)])]);
  assert.equal(many.score, 100 - WARNING_CAP);
  assert.equal(many.level, "caution");
  // kritický nález = Neodporúčame bez ohľadu na skóre
  const crit = computeVerdict([check("a", [c(30), pos(3), pos(4)])]);
  assert.equal(crit.level, "not_recommended");
  assert.equal(crit.score, 77);
  // bonus najviac +10
  assert.equal(computeVerdict([check("a", [pos(5), pos(5), pos(5)])]).score, 100);
  assert.equal(computeVerdict([check("a", [w(20), pos(5), pos(5), pos(5)])]).score, 90);
  // zdravá veľká spoločnosť s pár upozorneniami ostáva „Odporúčame“
  assert.equal(computeVerdict([check("a", [w(8), w(3), pos(3), pos(4)])]).level, "recommended");

  // právne skutočnosti v registri
  assert.equal(classifyLegalFact("Rozhodnutie jediného akcionára zo dňa 12.05.2015 o zlúčení so spoločnosťou SLOVNAFT TRANS a.s., ktorá bola zrušená bez likvidácie. Nástupnícka spoločnosť SLOVNAFT, a.s. preberá imanie zanikajúcej spoločnosti."), "merger");
  assert.equal(classifyLegalFact("Zmluva o zlúčení vo forme notárskej zápisnice N 123/2019, na základe ktorej na spoločnosť ako na nástupnícku spoločnosť prechádza imanie zanikajúcej spoločnosti ABC s.r.o., zrušenej bez likvidácie."), "merger");
  assert.equal(classifyLegalFact("Spoločnosť zaniká zlúčením so spoločnosťou XYZ a.s., ktorá sa stáva jej právnym nástupcom."), "dissolution");
  assert.equal(classifyLegalFact("Uznesením Okresného súdu Bratislava I zo dňa 3.2.2024 bolo začaté konanie o zrušení spoločnosti podľa § 68b Obchodného zákonníka."), "dissolution");
  assert.equal(classifyLegalFact("Rozhodnutie valného zhromaždenia o zrušení spoločnosti a jej vstupe do likvidácie. Likvidátor: Ing. Ján Novák."), "dissolution");
  assert.equal(classifyLegalFact("Zrušuje sa prokúra udelená Ing. Petrovi Kováčovi."), null);
  assert.equal(classifyLegalFact("Záložné právo na obchodný podiel spoločníka v prospech Tatra banka, a.s."), "pledge");
  assert.equal(classifyLegalFact("Exekučný príkaz na obchodný podiel spoločníka EX 123/2023."), "proceeding");
  assert.equal(classifyLegalFact("Uznesením súdu bol vyhlásený konkurz na majetok spoločníka."), "proceeding");
  assert.equal(classifyLegalFact("Spoločnosť bola založená zakladateľskou listinou dňa 1.1.2001."), null);

  console.log("OK – testy hodnotenia prešli.");
}
main();

// manuálne overenie s poznámkou a prednosť pred AI
{
  const { applyManual } = require("../lib/scoring");
  const manual = { ...check("vszp", []), status: "manual", data: { penaltyIfFound: 25, severityIfFound: "critical" } } as CheckResult;
  const ai = { ...check("union", []), status: "ok", ai: { provider: "anthropic", model: "x", at: "", evidence: [] } } as CheckResult;
  const out = applyManual([manual, ai], { vszp: "found", union: "clean" }, { vszp: "dlh 1 250 € k 1. 10. 2026" });
  assert.equal(out[0].status, "critical");
  assert.match(out[0].findings[0].text, /dlh 1 250 €/);
  assert.match(out[0].summary, /Zistenie: dlh 1 250 €/);
  assert.equal(out[0].manual?.note, "dlh 1 250 € k 1. 10. 2026");
  assert.equal(out[1].status, "ok");
  assert.equal(out[1].manual?.answer, "clean", "manuálne overenie prepíše výsledok AI");
  console.log("OK – manuálne overenie s poznámkou.");
}
