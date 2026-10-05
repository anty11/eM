/**
 * Testy AI agenta s prehliadačom: skutočné Chromium (CHROMIUM_PATH alebo Playwright) proti lokálnemu „registru“ (formulár + tabuľka),
 * model simulovaný lokálnym serverom (Anthropic aj OpenAI tvar). Overuje: snímku stránky, vyplnenie a odoslanie formulára,
 * cyklus nástrojov u oboch poskytovateľov, nezávislú kontrolu tvrdení modelu a zapojenie do aiCheck.
 * Spustenie: npm test (preskočí sa, ak Chromium nie je k dispozícii).
 */
import assert from "node:assert/strict";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { aiCheck } from "../lib/ai/fallback";
import { AI_SPECS } from "../lib/ai/specs";
import { runBrowserAgent, verifyAgentClaims } from "../lib/ai/agent";
import { BrowserSession, browserAvailable, renderSnapshot } from "../lib/browser/session";
import type { CheckResult } from "../lib/types";

const page = (q: URLSearchParams) => {
  const ico = q.get("ico");
  const result = !ico
    ? ""
    : ico === "31322832"
      ? `<p class="msg">Nenašli sa žiadne záznamy.</p>`
      : `<table><tr><th>Obchodné meno</th><th>IČO</th><th>Pohľadávka</th></tr><tr><td>Dlžník s.r.o.</td><td>${ico}</td><td>1 234,00 €</td></tr></table>`;
  return `<!doctype html><html lang="sk"><head><title>Zoznam dlžníkov – test</title></head><body>
  ${ico ? "" : `<div id="cookie"><p>Používame cookies.</p><button onclick="document.getElementById('cookie').remove()">Súhlasím</button></div>`}
  <main><h1>Zoznam dlžníkov</h1>
  <form method="get" action="/reg">
    <label for="typ">Typ platiteľa</label><select id="typ" name="typ"><option value="1">Zamestnávatelia</option><option value="2">SZČO</option></select>
    <label for="ico">IČO alebo obchodné meno</label><input id="ico" name="ico" placeholder="IČO" value="${ico || ""}">
    <button type="submit">Hľadať</button>
  </form>
  ${result}
  </main></body></html>`;
};

/** Simulovaný model: podľa poslednej snímky rozhodne o ďalšom kroku (rovnaká politika pre oba tvary API). */
function policy(lastTool: string | null, lastOutput: string, ico: string, startUrl: string): { tool?: { name: string; args: Record<string, unknown> }; final?: string } {
  if (!lastTool) return { tool: { name: "open_page", args: { url: startUrl } } };
  const ref = (re: RegExp) => lastOutput.match(re)?.[1];
  if (lastOutput.includes("Súhlasím")) {
    const r = ref(/(e\d+) \[button\] · Súhlasím/);
    if (r) return { tool: { name: "click", args: { ref: r } } };
  }
  if (/Nenašli sa žiadne záznamy/.test(lastOutput))
    return { final: `<json>{"result":"clean","summary":"Subjekt nie je v zozname.","evidence":[{"url":"${startUrl}?typ=1&ico=${ico}","quote":"Nenašli sa žiadne záznamy."}],"data":{"amount":null}}</json>` };
  if (/Pohľadávka/.test(lastOutput) && lastOutput.includes("1 234,00"))
    return { final: `<json>{"result":"found","summary":"Subjekt je v zozname s pohľadávkou 1 234,00 €.","evidence":[{"url":"${startUrl}?typ=1&ico=${ico}","quote":"Dlžník s.r.o. | ${ico} | 1 234,00 €"}],"data":{"amount":1234}}</json>` };
  if (lastTool === "fill") {
    const b = ref(/(e\d+) \[button\] · Hľadať/);
    return { tool: { name: "click", args: { ref: b } } };
  }
  const input = ref(/(e\d+) \[input\][^\n]*name=ico/);
  if (input) return { tool: { name: "fill", args: { ref: input, text: ico } } };
  return { final: `<json>{"result":"unknown","summary":"Nenašiel som pole."}</json>` };
}

function mockLlm(ico: string, startUrl: string) {
  // Anthropic: z messages zistí posledný tool_use + tool_result; OpenAI: z input function_call_output + uloženého stavu
  const openaiState = new Map<string, { name: string }>();
  let n = 0;
  return createServer(async (req, res) => {
    let body = "";
    for await (const c of req) body += c;
    const j = JSON.parse(body || "{}");
    const reply = (o: unknown) => {
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify(o));
    };
    if (req.url?.startsWith("/v1/messages")) {
      const msgs = j.messages as any[];
      const lastAssistant = [...msgs].reverse().find((m) => m.role === "assistant");
      const lastUse = lastAssistant?.content?.find((b: any) => b.type === "tool_use");
      const lastResult = msgs[msgs.length - 1]?.content?.find?.((b: any) => b.type === "tool_result");
      const firstUser = typeof msgs[0]?.content === "string" ? msgs[0].content : "";
      // úvod servera (prelude): ak prvá správa už obsahuje odoslaný formulár s výsledkom, model rozhodne bez akcie
      const snapPart = firstUser.split("Aktuálna snímka stránky:")[1] || "";
      const step = !lastUse && /formulár je odoslaný/.test(firstUser) ? policy("click", snapPart, ico, startUrl) : policy(lastUse?.name || null, String(lastResult?.content || ""), ico, startUrl);
      if (step.tool) return reply({ stop_reason: "tool_use", content: [{ type: "tool_use", id: `tu_${++n}`, name: step.tool.name, input: step.tool.args }], usage: { input_tokens: 100, output_tokens: 20 } });
      return reply({ stop_reason: "end_turn", content: [{ type: "text", text: step.final }], usage: { input_tokens: 100, output_tokens: 50 } });
    }
    if (req.url?.startsWith("/v1/responses")) {
      const inputs = Array.isArray(j.input) ? j.input : [];
      const out = inputs.find((i: any) => i.type === "function_call_output");
      const prev = out ? openaiState.get(out.call_id) : undefined;
      const step = policy(prev?.name || null, String(out?.output || ""), ico, startUrl);
      const id = `resp_${++n}`;
      if (step.tool) {
        const call_id = `call_${n}`;
        openaiState.set(call_id, { name: step.tool.name });
        return reply({ id, output: [{ type: "function_call", id: `fc_${n}`, call_id, name: step.tool.name, arguments: JSON.stringify(step.tool.args) }], usage: { input_tokens: 100, output_tokens: 20 } });
      }
      return reply({ id, output_text: step.final, output: [{ type: "message", content: [{ type: "output_text", text: step.final }] }], usage: { input_tokens: 100, output_tokens: 50 } });
    }
    res.statusCode = 404;
    res.end("{}");
  });
}

async function main() {
  if (!process.env.CHROMIUM_PATH && !process.env.VERCEL) {
    const guess = "/opt/pw-browsers/chromium";
    const { existsSync } = await import("node:fs");
    if (existsSync(guess)) process.env.CHROMIUM_PATH = guess;
  }
  const avail = await browserAvailable();
  if (!avail.ok) {
    console.log(`PRESKOČENÉ – prehliadač nie je k dispozícii (${avail.error})`);
    return;
  }

  const reg = createServer((req, res) => {
    const u = new URL(req.url || "/", "http://x");
    res.setHeader("content-type", "text/html; charset=utf-8");
    res.end(page(u.searchParams));
  });
  await new Promise<void>((r) => reg.listen(0, "127.0.0.1", r));
  const regPort = (reg.address() as AddressInfo).port;
  const startUrl = `http://127.0.0.1:${regPort}/reg`;

  // 1) Sedenie prehliadača: snímka, cookies, výber, vyplnenie, odoslanie, tabuľka
  const s = await BrowserSession.open(["127.0.0.1"]);
  let snap = await s.open(startUrl);
  assert.equal(snap.title, "Zoznam dlžníkov – test");
  const cookieBtn = snap.elements.find((e) => e.kind === "button" && e.label === "Súhlasím")!;
  assert.ok(cookieBtn, "tlačidlo cookies v snímke");
  snap = await s.click(cookieBtn.ref);
  assert.ok(!snap.elements.some((e) => e.label === "Súhlasím"), "lišta cookies zmizla");
  const sel = snap.elements.find((e) => e.kind === "select")!;
  assert.deepEqual(sel.options, ["Zamestnávatelia", "SZČO"]);
  assert.equal(sel.label, "Typ platiteľa");
  const input = snap.elements.find((e) => e.kind === "input" && e.name === "ico")!;
  assert.equal(input.label, "IČO alebo obchodné meno");
  snap = await s.fill(input.ref, "12345678");
  assert.equal(snap.elements.find((e) => e.name === "ico")!.value, "12345678");
  const btn = snap.elements.find((e) => e.kind === "button" && e.label === "Hľadať")!;
  snap = await s.click(btn.ref);
  assert.ok(s.searched, "formulár bol odoslaný");
  assert.ok(snap.url.includes("ico=12345678"));
  assert.equal(snap.tables.length, 1);
  assert.deepEqual(snap.tables[0][1], ["Dlžník s.r.o.", "12345678", "1 234,00 €"]);
  const rendered = renderSnapshot(snap);
  assert.ok(rendered.includes("TABUĽKY:") && rendered.includes("Dlžník s.r.o. | 12345678 | 1 234,00 €"));
  await assert.rejects(s.open("https://www.example.com/"), /Doména nie je povolená/);
  await s.close();
  console.log("OK – sedenie prehliadača (snímka, formulár, tabuľka, povolené domény).");

  // 2) Agent s oboma poskytovateľmi (simulovaný model) – „bez záznamu“ aj „nájdený“
  const cases: [string, "anthropic" | "openai", "clean" | "found"][] = [
    ["31322832", "anthropic", "clean"],
    ["12345678", "anthropic", "found"],
    ["31322832", "openai", "clean"],
    ["12345678", "openai", "found"],
  ];
  for (const [ico, provider, expected] of cases) {
    const llm = mockLlm(ico, startUrl);
    await new Promise<void>((r) => llm.listen(0, "127.0.0.1", r));
    const base = `http://127.0.0.1:${(llm.address() as AddressInfo).port}`;
    process.env.ANTHROPIC_BASE_URL = base;
    process.env.OPENAI_BASE_URL = base;
    const run = runBrowserAgent;
    const cfg = { provider, model: "test-model", key: "k".repeat(30), auto: false, noApiSources: false, origin: "env" as const };
    const r = await run(cfg, { user: `Over IČO ${ico}. Začni: ${startUrl}`, allowedHosts: ["127.0.0.1"], timeoutMs: 60000 });
    if (!r.searched) console.log(JSON.stringify({ log: r.log, text: r.text, steps: r.steps }, null, 1));
    assert.ok(r.searched, `${provider}/${ico}: formulár odoslaný`);
    assert.ok(r.steps >= 3 && r.steps <= 6, `${provider}/${ico}: počet krokov ${r.steps}`);
    assert.ok(r.text.includes(`"result":"${expected}"`), `${provider}/${ico}: výsledok ${expected}`);
    assert.equal(verifyAgentClaims(r, expected, ico, "Dlžník s.r.o."), null, `${provider}/${ico}: tvrdenie obstojí`);
    // opačné tvrdenie server zamietne
    if (expected === "found") assert.ok(verifyAgentClaims(r, "clean", ico), "„bez záznamu“ pri stránke s pohľadávkou sa zamietne");
    else assert.ok(verifyAgentClaims(r, "found", "99999999"), "„nájdený“ bez IČO na stránke sa zamietne");
    llm.close();
  }
  console.log("OK – agent s prehliadačom (Claude aj OpenAI tvar API, bez záznamu / nájdený, kontrola tvrdení).");

  // 2b) Úvod bez AI (prelude): server sám vyplní IČO a odošle – model dostane výsledok a rozhodne bez jediného kroku
  {
    const llm = mockLlm("31322832", startUrl);
    await new Promise<void>((r) => llm.listen(0, "127.0.0.1", r));
    process.env.ANTHROPIC_BASE_URL = `http://127.0.0.1:${(llm.address() as AddressInfo).port}`;
    const cfg = { provider: "anthropic" as const, model: "m", key: "k".repeat(30), auto: false, noApiSources: false, origin: "env" as const };
    const events: { kind: string; text: string }[] = [];
    const r = await runBrowserAgent(cfg, { user: "Over IČO 31322832.", allowedHosts: ["127.0.0.1"], timeoutMs: 60000, prelude: { url: startUrl, ico: "31322832" }, onEvent: (e) => events.push(e) });
    // živý priebeh: ľudsky čitateľné kroky v poradí
    const texts = events.map((e) => e.text);
    assert.ok(texts[0].startsWith("Spúšťam prehliadač"), texts[0]);
    assert.ok(texts.some((t) => /^Otváram 127\.0\.0\.1/.test(t)), "otvorenie stránky");
    assert.ok(texts.some((t) => t === "Vypĺňam pole „IČO alebo obchodné meno“: 31322832"), `vyplnenie s popisom poľa (${texts.join(" | ")})`);
    assert.ok(texts.some((t) => t === "Klikám na „Hľadať“"), "kliknutie s popisom tlačidla");
    assert.ok(texts.some((t) => /Na stránke: .*hlásenie „Nenašli sa žiadne záznamy/.test(t)), "popis výsledku");
    assert.ok(events.some((e) => e.kind === "think"), "AI uvažuje");
    assert.ok(texts[texts.length - 1].startsWith("AI dokončila"));
    assert.ok(r.searched, "prelude odoslal formulár");
    assert.equal(r.steps, 0, `model nepotreboval žiadny krok (${r.steps})`);
    assert.ok(r.text.includes('"result":"clean"'));
    assert.ok(r.log.some((l) => l.action.startsWith("fill")) && r.log.some((l) => l.action.startsWith("click")), "záznam obsahuje vyplnenie a odoslanie serverom");
    llm.close();
    console.log("OK – úvod bez AI (server vyplnil a odoslal formulár, model len prečítal výsledok).");
  }

  // 3) Zapojenie do aiCheck (VšZP spec s prehliadačom) – doména testovacieho registra sa dočasne povolí
  const llm = mockLlm("12345678", startUrl);
  await new Promise<void>((r) => llm.listen(0, "127.0.0.1", r));
  process.env.ANTHROPIC_BASE_URL = `http://127.0.0.1:${(llm.address() as AddressInfo).port}`;
  const spec = AI_SPECS.vszp;
  const saved = { domains: spec.domains, urls: spec.urls };
  spec.domains = ["127.0.0.1"];
  spec.urls = () => [startUrl];
  const check: CheckResult = { id: "vszp", category: "insurance", name: "VšZP", source: "VšZP", sourceUrl: startUrl, status: "manual", summary: "", findings: [], checkedAt: "", durationMs: 0, automated: false };
  const checkEvents: { kind: string; text: string }[] = [];
  const r = await aiCheck({ provider: "anthropic", model: "m", key: "k".repeat(30), auto: false, noApiSources: false, origin: "env" }, check, "12345678", { ico: "12345678", name: "Dlžník s.r.o." } as any, (e) => checkEvents.push(e));
  assert.equal(r.check.ai?.mode, "browser");
  assert.ok(checkEvents.some((e) => e.text.startsWith("Kontrolujem prehliadač")), "aiCheck hlási kontrolu prehliadača");
  assert.ok(checkEvents.some((e) => e.kind === "ok" && /Overené: záznam nájdený/.test(e.text)), `aiCheck hlási výsledok overenia (${checkEvents.map((e) => e.text).join(" | ")})`);
  assert.equal(r.check.status, "critical", "nález dlhu → kritické");
  assert.ok(r.check.findings.some((f) => /Dlh voči VšZP/.test(f.text)));
  assert.ok(r.check.ai?.evidence[0]?.url.startsWith(startUrl));
  assert.ok((r.check.ai?.trace || []).some((t) => t.startsWith("✓ fill")), "záznam akcií obsahuje vyplnenie");
  Object.assign(spec, saved);
  llm.close();
  reg.close();
  console.log("OK – aiCheck s agentom (nález, dôkaz, záznam akcií).");
  console.log("OK – testy AI agenta s prehliadačom prešli.");
  process.exit(0);
}

main().catch((e) => {
  console.error("FAIL", e);
  process.exit(1);
});
