/** Záťažová skúška – vyhodnotenie behov (percentily, zdroje, rozpoznanie obmedzovania registrom). Spustenie: npm test */
import assert from "node:assert/strict";
import { percentile, summarizeLoad, THROTTLE_RE, type LoadRun } from "../lib/loadtest";

assert.equal(percentile([], 50), undefined);
assert.equal(percentile([5, 1, 3], 50), 3);
assert.equal(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 95), 10);
assert.ok(THROTTLE_RE.test("HTTP 429 z portal.unionzp.sk"));
assert.ok(THROTTLE_RE.test("Časový limit vypršal (11s)"));
assert.ok(!THROTTLE_RE.test("Bez záznamu – IČO sa v zozname nenachádza."));

const run = (i: number, union: string, done = true): LoadRun => ({
  ico: "31322832",
  wave: 1,
  startedAt: 0,
  firstMs: 400 + i,
  totalMs: done ? 10000 + i * 1000 : undefined,
  done,
  instance: i < 3 ? "a" : "b",
  region: "fra1",
  sources: [
    { id: "rpo", status: "ok", ms: 800 },
    { id: "union", status: union, ms: 9000, summary: union === "error" ? "HTTP 429 z portal.unionzp.sk" : "Bez záznamu" },
  ],
});
const s = summarizeLoad([run(0, "ok"), run(1, "error"), run(2, "error"), run(3, "ok"), run(4, "ok", false)]);
assert.equal(s.runs, 5);
assert.equal(s.done, 4);
assert.equal(s.failed, 1);
assert.equal(s.instances, 2);
assert.deepEqual(s.regions, ["fra1"]);
assert.equal(s.totalMs.p50, 11000);
assert.equal(s.totalMs.max, 13000);
assert.deepEqual(s.throttledSources, ["union"]);
assert.equal(s.sources[0].id, "union", "najproblémovejší zdroj prvý");
assert.equal(s.sources[0].errors, 2);
assert.equal(s.sources[0].ok, 3);
assert.match(s.sources[0].samples[0], /429/);
console.log("OK – vyhodnotenie záťažovej skúšky.");
