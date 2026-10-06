/**
 * docs/ARCHITEKTURA.md musí zodpovedať kódu: každý zdroj (META, MANUAL), každé zadanie AI (AI_SPECS), každá premenná prostredia
 * použitá v kóde a verzia v hlavičke. Pri zlyhaní doplňte dokument (pravidlá v kapitole 11). Spustenie: npm test
 */
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { AI_SPECS } from "../lib/ai/specs";
import { APP_VERSION } from "../lib/scan";
import { META } from "../lib/sources/meta";
import { MANUAL } from "../lib/sources/manual";

const root = join(__dirname, "..");
const doc = readFileSync(join(root, "docs/ARCHITEKTURA.md"), "utf8");

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    if (/node_modules|\.next/.test(p)) return [];
    return statSync(p).isDirectory() ? walk(p) : /\.(ts|tsx)$/.test(f) ? [p] : [];
  });
}

const missing: string[] = [];
for (const id of [...Object.keys(META), ...MANUAL.map((m) => m.id)]) if (!doc.includes(`\`${id}\``)) missing.push(`zdroj ${id} (kapitola 6)`);
for (const id of Object.keys(AI_SPECS)) if (!doc.includes(`\`${id}\``)) missing.push(`zadanie AI ${id} (kapitola 6)`);

const envs = new Set<string>();
for (const f of [...walk(join(root, "lib")), ...walk(join(root, "app")), join(root, "proxy.ts")]) {
  for (const m of readFileSync(f, "utf8").matchAll(/process\.env\.([A-Z][A-Z0-9_]+)/g)) envs.add(m[1]);
}
for (const e of envs) if (!doc.includes(`\`${e}\``)) missing.push(`premenná ${e} (kapitola 10)`);

const ver = doc.match(/Stav k verzii \*\*([\d.]+)\*\*/)?.[1];
if (ver !== APP_VERSION) missing.push(`verzia v hlavičke ${ver} ≠ APP_VERSION ${APP_VERSION}`);

for (const t of readdirSync(join(root, "test")).filter((f) => f.endsWith(".test.ts"))) {
  const base = t.replace(/\.test\.ts$/, "");
  if (!doc.includes(`${base}.test.ts`) && !doc.includes(`\`${base}\``)) missing.push(`test ${t} (kapitola 8)`);
}

assert.deepEqual(missing, [], `docs/ARCHITEKTURA.md treba doplniť:\n - ${missing.join("\n - ")}`);
console.log(`OK – ARCHITEKTURA.md pokrýva ${Object.keys(META).length + MANUAL.length} zdrojov, ${Object.keys(AI_SPECS).length} zadaní AI, ${envs.size} premenných, verzia ${APP_VERSION}.`);
