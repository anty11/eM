/** Testy indikátorov rizika (SKDP 03/2024), zhody predmetu obchodu, IBAN a daňových rajov. Spustenie: npm test */
import assert from "node:assert/strict";
import { buildDealCheck, ibanValid, INDICATORS, normalizeIban, regulatedFor, riskJurisdiction, subjectMatchesActivities } from "../lib/deal";
import { computeVerdict } from "../lib/scoring";

const acts = ["poskytovanie právnych služieb", "sprostredkovateľská činnosť v oblasti obchodu", "počítačové služby"];

// predmet obchodu vs. predmet podnikania
assert.equal(subjectMatchesActivities("právne služby – zastupovanie", acts).match, true);
assert.equal(subjectMatchesActivities("IT služby a počítačové siete", acts).match, true);
assert.equal(subjectMatchesActivities("kovový odpad", acts).match, false);
assert.equal(subjectMatchesActivities("tovar", acts).match, true, "bez významového slova sa zhoda nevyhodnocuje v neprospech");
assert.equal(subjectMatchesActivities("právne poradenstvo", [], "Právne činnosti").match, true, "hlavná činnosť zo ŠÚ SR");

// regulované činnosti
assert.ok(regulatedFor("dodávka pohonných látok").some((r) => /pohonn/.test(r.what)));
assert.ok(regulatedFor("odvoz kovového odpadu").some((r) => /odpad/.test(r.what)));
assert.equal(regulatedFor("grafický návrh loga").length, 0);

// IBAN
assert.equal(normalizeIban("sk31 1200 0000 1987 4263 7541"), "SK3112000000198742637541");
assert.equal(ibanValid("SK31 1200 0000 1987 4263 7541"), true);
assert.equal(ibanValid("SK31 1200 0000 1987 4263 7542"), false);
assert.equal(ibanValid("1234"), false);

// daňové raje
assert.equal(riskJurisdiction("Slovenská republika"), null);
assert.equal(riskJurisdiction("Česká republika"), null);
assert.equal(riskJurisdiction("Seychelská republika"), "Seychely");
assert.equal(riskJurisdiction("British Virgin Islands"), "Britské Panenské ostrovy");
assert.equal(riskJurisdiction("Panamská republika"), "Panama");

// syntetická kontrola a jej vplyv na verdikt
const profile = { activities: acts, mainActivity: "Právne činnosti" };
assert.equal(buildDealCheck({ direction: "buy", subject: "", iban: "", value: "", indicators: {} }, profile, null), null, "bez údajov sa kontrola nevytvorí");

const clean = buildDealCheck({ direction: "buy", subject: "právne služby", iban: "SK31 1200 0000 1987 4263 7541", value: "", indicators: Object.fromEntries(INDICATORS.map((i) => [i.id, "none"])) }, profile, { status: "listed", message: "ok" })!;
assert.equal(clean.status, "ok");
assert.equal(computeVerdict([clean]).score, 100, "pozitívny nález je orezaný na 100");
assert.match(clean.summary, /posúdených 9 z 9, potvrdených 0/);

const risky = buildDealCheck({ direction: "buy", subject: "kovový odpad", iban: "SK31 1200 0000 1987 4263 7541", value: "40 000 €", indicators: { price: "found", time: "found" } }, profile, { status: "not_listed", message: "nie je" })!;
assert.equal(risky.status, "critical", "neoznámený účet = kritické (ručenie § 69 ods. 14 písm. c))");
const v = computeVerdict([risky]);
assert.equal(v.level, "not_recommended");
assert.equal(v.score, 100 - 8 - 35 - 10 - 6, "nezhoda predmetu −8, účet −35, cena −10, čas −6");
assert.ok(risky.findings.some((f) => /odpad/.test(f.text) && f.severity === "info"), "pripomienka povolenia pre odpady");

const cash = buildDealCheck({ direction: "buy", subject: "", iban: "", value: "", indicators: { cash: "found" } }, profile, null)!;
assert.equal(computeVerdict([cash]).score, 88, "platby v hotovosti −12");

const chain = buildDealCheck({ direction: "sell", subject: "", iban: "", value: "", indicators: { chain: "found" } }, profile, null)!;
assert.equal(computeVerdict([chain]).level, "not_recommended", "umelé zapojenie osôb je kritické");

const unknownBank = buildDealCheck({ direction: "buy", subject: "", iban: "SK31 1200 0000 1987 4263 7541", value: "", indicators: {} }, profile, { status: "unknown", message: "bez kľúča" })!;
assert.equal(unknownBank.status, "ok", "neoverený účet nie je v neprospech partnera");
assert.equal(computeVerdict([unknownBank]).score, 100);

console.log("OK – testy indikátorov rizika a údajov o obchode prešli.");
