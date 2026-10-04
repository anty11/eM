import type { CheckResult, Finding, Verdict } from "./types";

export type ManualAnswer = "clean" | "found";
export type ManualAnswers = Record<string, ManualAnswer | undefined>;

export const LEVEL_LABEL = {
  recommended: "ODPORÚČAME – bezpečný obchodný partner",
  caution: "S VÝHRADOU – zvýšená opatrnosť",
  not_recommended: "NEODPORÚČAME – rizikový subjekt",
} as const;

/** Doplní do kontrol výsledky manuálneho overenia povereným zamestnancom. */
export function applyManual(checks: CheckResult[], answers: ManualAnswers): CheckResult[] {
  return checks.map((c) => {
    const a = answers[c.id];
    if (c.status !== "manual" && !(c.status === "error" && a)) return c;
    if (!a) return c;
    if (a === "clean") return { ...c, status: "ok", findings: [], summary: `${c.summary} — Overené manuálne: bez záznamu.` };
    const pen = Number((c.data as any)?.penaltyIfFound ?? 30);
    const sev = ((c.data as any)?.severityIfFound ?? "critical") as Finding["severity"];
    return {
      ...c,
      status: sev === "critical" ? "critical" : "warning",
      findings: [{ severity: sev, text: `${c.name}: manuálne zistený negatívny záznam`, penalty: pen }],
      summary: `${c.summary} — Overené manuálne: ZÁZNAM NÁJDENÝ.`,
    };
  });
}

/**
 * @param opts.ignore ID kontrol, ktoré sa nezapočítavajú do „čakajúcich“ (vo verzii Firma sa neverejné registre
 * len odporúčajú, verdikt pre ne neostáva predbežný).
 */
/** Strop pre súčet upozornení – samotné upozornenia (bez kritického nálezu) nikdy nedajú „Neodporúčame“, najviac „S výhradou“. */
export const WARNING_CAP = 40;
/** Strop pre pozitívne body (bonus najviac +10). */
export const POSITIVE_CAP = 10;

/**
 * Skóre = 100 − kritické nálezy − upozornenia (spolu najviac WARNING_CAP) + pozitíva (najviac POSITIVE_CAP).
 * Kritický nález (daňový dlžník, dlh v SP, konkurz / likvidácia / zrušenie, záporné imanie, chýbajúce závierky za 2+ obdobia,
 * dôvody na zrušenie registrácie DPH) znamená „Neodporúčame“ vždy; upozornenia bez kritického nálezu najviac „S výhradou“.
 */
export function computeVerdict(checks: CheckResult[], opts: { ignore?: string[] } = {}): Verdict {
  const findings = checks.flatMap((c) => c.findings);
  const critical = findings.filter((f) => f.severity === "critical").reduce((s, f) => s + Math.max(0, f.penalty), 0);
  const warnings = Math.min(WARNING_CAP, findings.filter((f) => f.severity === "warning").reduce((s, f) => s + Math.max(0, f.penalty), 0));
  const bonus = Math.min(POSITIVE_CAP, findings.filter((f) => f.severity === "positive").reduce((s, f) => s + Math.max(0, -f.penalty), 0));
  const score = Math.max(0, Math.min(100, Math.round(100 - critical - warnings + bonus)));
  const hasCritical = findings.some((f) => f.severity === "critical");
  const pendingManual = checks.filter((c) => (c.status === "manual" || c.status === "error") && !opts.ignore?.includes(c.id)).length;

  let level: Verdict["level"] = score >= 85 ? "recommended" : score >= 60 ? "caution" : "not_recommended";
  if (hasCritical) level = "not_recommended";

  const reasons = findings
    .filter((f) => f.severity === "critical" || f.severity === "warning")
    .sort((a, b) => b.penalty - a.penalty)
    .map((f) => f.text);
  const positives = findings.filter((f) => f.severity === "positive").map((f) => f.text);

  if (!reasons.length) reasons.push("Automatizované kontroly nezistili negatívne záznamy.", ...positives);

  return {
    level,
    label: LEVEL_LABEL[level],
    score,
    reasons,
    // Pri kritickom náleze je verdikt „neodporúčame“ konečný aj bez manuálnych kontrol
    preliminary: pendingManual > 0 && !hasCritical,
    pendingManual,
  };
}
