/** Testy AI záložného vyhľadávania so simulovaným Claude API. Spustenie: npm test */
import assert from "node:assert/strict";
import { aiCheck, parseAiJson } from "../lib/ai/fallback";
import { aiStatus, getAiConfig, saveAiSettings } from "../lib/ai/config";
import { AI_SPECS } from "../lib/ai/specs";
import { useMemoryKV } from "../lib/auth/kv";
import { kv } from "../lib/auth/kv";
import { MANUAL } from "../lib/sources/manual";
import type { CheckResult } from "../lib/types";
import { BAD, GOOD, installMock } from "./mock";

const stub = (id: string): CheckResult => ({
  id, category: "insurance", name: id, source: "x", sourceUrl: "https://x", status: "error", summary: "", findings: [], checkedAt: "", durationMs: 0, automated: true,
});

async function main() {
  installMock();
  useMemoryKV();
  delete process.env.ANTHROPIC_API_KEY;
  delete process.env.OPENAI_API_KEY;

  // Každý manuálny register má AI zadanie (alebo zdôvodnenie, prečo nie)
  for (const m of MANUAL) assert.ok(AI_SPECS[m.id], `chýba AI zadanie pre ${m.id}`);
  assert.ok(AI_SPECS.cre.disabled && AI_SPECS.dovera.disabled);

  // Nastavenia: bez kľúča nič; kľúč z administrácie sa uloží šifrovane
  assert.equal(await getAiConfig(), null);
  await saveAiSettings({ provider: "anthropic", key: "sk-ant-test-0123456789abcdefXYZ9" }, "admin@x.sk");
  const raw = JSON.stringify(await kv().get("settings:ai"));
  assert.ok(!raw.includes("sk-ant-test"), "kľúč nesmie byť v databáze v čitateľnej podobe");
  const st = await aiStatus();
  assert.equal(st.keyHint, "…XYZ9");
  assert.equal(st.model, "claude-haiku-4-5-20251001", "predvolene rýchly model");
  assert.equal(st.speed, "fast");
  const cfg = (await getAiConfig())!;
  assert.equal(cfg.key, "sk-ant-test-0123456789abcdefXYZ9");
  assert.equal(cfg.model, "claude-haiku-4-5-20251001");
  assert.equal(cfg.fallbackModel, "claude-sonnet-5", "záložný štandardný model");
  // prepnutie na štandardný model a späť
  await saveAiSettings({ speed: "standard" }, "admin@x.sk");
  assert.equal((await getAiConfig())!.model, "claude-sonnet-5");
  assert.equal((await getAiConfig())!.fallbackModel, undefined);
  await saveAiSettings({ speed: "fast" }, "admin@x.sk");
  assert.equal((await getAiConfig())!.model, "claude-haiku-4-5-20251001");
  // premenné prostredia majú prednosť pre kľúč daného poskytovateľa a zamknú jeho zmenu v administrácii
  process.env.ANTHROPIC_API_KEY = "sk-ant-env-0000000000000000ENV1";
  assert.equal((await getAiConfig())!.origin, "env");
  assert.equal((await getAiConfig())!.key, "sk-ant-env-0000000000000000ENV1");
  await assert.rejects(saveAiSettings({ provider: "anthropic", key: "sk-ant-other-000000000000000000" }, "a"), /premenných prostredia/);
  // druhý poskytovateľ má vlastný kľúč; prepínanie je možné vždy a kľúč druhého ostáva
  await saveAiSettings({ provider: "openai", key: "sk-openai-test-00000000000000AB12" }, "admin@x.sk");
  let c2 = (await getAiConfig())!;
  assert.equal(c2.provider, "openai");
  assert.equal(c2.key, "sk-openai-test-00000000000000AB12");
  assert.equal(c2.model, "gpt-6-luna", "rýchly model OpenAI");
  await saveAiSettings({ provider: "openai", model: "gpt-5.5-mini" }, "admin@x.sk");
  assert.equal((await getAiConfig())!.model, "gpt-5.5-mini", "vlastný model prepíše rýchlosť");
  assert.equal((await getAiConfig())!.fallbackModel, undefined, "pri vlastnom modeli sa nezopakuje");
  await saveAiSettings({ provider: "anthropic" }, "admin@x.sk");
  c2 = (await getAiConfig())!;
  assert.equal(c2.provider, "anthropic");
  assert.equal(c2.origin, "env", "po prepnutí späť sa použije kľúč Claude z prostredia");
  const st2 = await aiStatus();
  assert.equal(st2.providers.openai.hasKey, true, "kľúč OpenAI po prepnutí ostáva uložený");
  assert.equal(st2.providers.openai.model, "gpt-5.5-mini");
  assert.equal(st2.providers.anthropic.envLocked, true);
  delete process.env.ANTHROPIC_API_KEY;
  await saveAiSettings({ provider: "openai", clearKey: true }, "admin@x.sk");
  await saveAiSettings({ provider: "anthropic" }, "admin@x.sk");
  // v produkcii len cez prostredie
  (process.env as any).NODE_ENV = "production";
  assert.equal(await getAiConfig(), null, "v produkcii sa kľúč z administrácie nepoužije");
  (process.env as any).NODE_ENV = "test";

  // Parsovanie odpovede
  assert.equal(parseAiJson('bla <json>{"result":"clean","summary":"ok"}</json>').result, "clean");
  assert.throws(() => parseAiJson("žiadny json"), /štruktúrovanú/);
  assert.throws(() => parseAiJson('<json>{"result":"asi"}</json>'), /neplatný/);

  // Register bez API s priamou adresou (ÚVO) – čistý subjekt (vrátane pause_turn pokračovania)
  let r = await aiCheck(cfg, stub("uvo"), GOOD, { ico: GOOD, name: "URBAN & PARTNERS s.r.o." });
  assert.equal(r.check.status, "ok");
  assert.equal(r.check.ai?.evidence.length, 1);
  assert.match(r.check.ai!.evidence[0].url, /uvo\.gov\.sk/);
  // registre bez API ostávajú pre AI dostupné (na overenie v praxi) – okrem CRE (prihlásenie, poplatok) a Dôvery (zákaz automatizácie)
  assert.ok(!AI_SPECS.vszp.disabled && !AI_SPECS.union.disabled && !AI_SPECS.ov.disabled && !AI_SPECS.diskv.disabled);

  // Negatívny nález – postih ako pri API
  r = await aiCheck(cfg, stub("socpoist"), BAD, { ico: BAD, name: "C.C.C. s.r.o." });
  assert.equal(r.check.status, "critical");
  assert.equal(r.check.findings[0].penalty, 35);
  assert.match(r.check.findings[0].text, /\[AI\] Dlh voči Sociálnej poisťovni, 999 €/);

  // Vymyslený dôkaz (URL, ktorú AI neotvorila) → zamietnuté, ostáva manuálne
  r = await aiCheck(cfg, stub("socpoist"), "12345679", { ico: "12345679" });
  assert.equal(r.check.status, "manual");
  assert.match(r.check.ai!.rejected!, /dôkaz/);

  // Identifikácia z OR, keď RPO API zlyhá → doplní profil
  r = await aiCheck(cfg, { ...stub("rpo"), category: "register" }, GOOD, { ico: GOOD });
  assert.equal(r.profilePatch?.name, "AI FIRMA s.r.o.");
  assert.equal(r.profilePatch?.statutory?.[0].name, "Ing. AI Konateľ");

  // CRE / Dôvera – AI sa nepoužije
  await assert.rejects(aiCheck(cfg, stub("cre"), GOOD, { ico: GOOD }), /prihlásení/);
  await assert.rejects(aiCheck(cfg, stub("dovera"), GOOD, { ico: GOOD }), /zakazuje/);

  console.log("OK – testy AI záložného vyhľadávania prešli.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
