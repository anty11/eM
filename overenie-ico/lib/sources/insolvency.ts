import { runCheck } from "../check";
import { fold, getText, stripHtml } from "../http";
import type { CheckResult, Ctx, Finding } from "../types";

const BASE = "https://replik.justice.sk/ru-verejnost-web/pages/searchKonanie.xhtml";

export interface Proceeding {
  debtor: string;
  ico: string;
  kind: string;
  number: string;
  state: string;
  ongoing: boolean;
}

/**
 * Z textu výsledkov REPLIK vytiahne konania. Formát riadku (overené na reálnych výsledkoch):
 *   „PharmaComp s.r.o. (IČO: 47358203) - Konkurz č. 2K/8/2026  Začaté konkurzné konanie  14.8.2026, Okresný súd …“
 *   „IVENSLOVAK s.r.o. (IČO: 46870555) - Likvidácia č. 32CbLd/1/2026 …“
 * Stránka vždy obsahuje aj filter (Konkurz, Reštrukturalizácia, Likvidácia…) a hľadané IČO v hlavičke,
 * preto sa nález uzná len podľa riadku „(IČO: …) – druh č. spisová značka“ s presne tým istým IČO.
 */
export function parseReplik(text: string, ico: string): { noResults: boolean; count?: number; proceedings: Proceeding[] } {
  const t = text.replace(/\s+/g, " ");
  const noResults = /nena[sš]li sa [zž]iadne konania/i.test(t);
  const count = Number((t.match(/Po[cč]et v[yý]sledkov:\s*(\d+)/i) || [])[1]) || undefined;
  const row = /\(I[CČ]O:\s*(\d{6,8})\)\s*[-–—]\s*(.{3,60}?)\s+[cč]\.\s*([0-9A-Za-z]+\/\d+\/\d{4})/g;
  const hits = [...t.matchAll(row)];
  const proceedings: Proceeding[] = [];
  hits.forEach((m, i) => {
    if (m[1].padStart(8, "0") !== ico) return;
    const from = m.index! + m[0].length;
    const next = i + 1 < hits.length ? hits[i + 1].index! : t.length;
    const tail = t.slice(from, next);
    const state = (tail.split(/\d{1,2}\.\s?\d{1,2}\.\s?\d{4}/)[0] || "").replace(/^[\s|,–-]+|[\s|,–-]+$/g, "").slice(0, 120);
    const before = t.slice(Math.max(0, m.index! - 120), m.index!);
    const debtor = (before.split(/\d{4},?[^\d]*?(?:súd|sud)[^A-ZÁ-Ž]*|Po[cč]et v[yý]sledkov:\s*\d+/i).pop() || "").trim();
    const fs = fold(state);
    const ended = /skonc|ukonc|zastav|zrusen[ey]? konkurz|zrusen[ey]? restruktur|zamiet|odmiet|vymazan|zanik/.test(fs);
    proceedings.push({ debtor, ico: m[1], kind: m[2].trim(), number: m[3], state, ongoing: !ended });
  });
  return { noResults, count, proceedings };
}

/**
 * Register predinsolvenčných, likvidačných a insolvenčných konaní (REPLIK, MS SR).
 * Stránka je dynamická (JSF). Ak nevieme jednoznačne určiť výsledok, kontrola ostáva na manuálne overenie
 * (alebo ju doplní AI) – nikdy nehlásime nález bez konkrétneho konania.
 */
export async function checkInsolvency(ctx: Ctx): Promise<CheckResult> {
  return runCheck(
    {
      id: "insolvency",
      category: "insolvency",
      name: "Register úpadcov a likvidácií (konkurz, reštrukturalizácia, likvidácia)",
      source: "Ministerstvo spravodlivosti SR – REPLIK",
      sourceUrl: "https://replik.justice.sk/ru-verejnost-web/",
    },
    async () => {
      const verifyUrl = `${BASE}?query=${ctx.ico}`;
      const html = await getText(verifyUrl, { timeoutMs: 15000 });
      const { noResults, proceedings } = parseReplik(stripHtml(html), ctx.ico);

      if (proceedings.length) {
        const f: Finding[] = [];
        const ongoing = proceedings.filter((p) => p.ongoing);
        const isLiq = (p: Proceeding) => /likvid/i.test(p.kind);
        for (const p of ongoing)
          f.push({
            severity: "critical",
            text: `${p.kind} č. ${p.number} – ${p.state || "prebieha"}`,
            penalty: isLiq(p) ? 60 : 80,
          });
        for (const p of proceedings.filter((x) => !x.ongoing))
          f.push({ severity: "warning", text: `V minulosti: ${p.kind} č. ${p.number} – ${p.state}`, penalty: 8 });
        // pri viacerých konaniach sa body nesčítavajú nad rámec najzávažnejšieho
        let crit = false;
        for (const x of f) if (x.severity === "critical") { if (crit) x.penalty = 0; crit = true; }
        const liq = ongoing.find(isLiq);
        const asOf = ctx.asOf
          ? (() => {
              const y = Number(ctx.asOf!.slice(0, 4));
              const yearOf = (n: string) => Number((n.match(/\/(\d{4})\b/) || [])[1] || 0);
              return {
                date: ctx.asOf,
                startedBefore: proceedings.filter((p) => yearOf(p.number) && yearOf(p.number) < y).map((p) => `${p.kind} č. ${p.number}`),
                startedSameYear: proceedings.filter((p) => yearOf(p.number) === y).map((p) => `${p.kind} č. ${p.number}`),
                startedAfter: proceedings.filter((p) => yearOf(p.number) > y).map((p) => `${p.kind} č. ${p.number}`),
              };
            })()
          : undefined;
        return {
          status: ongoing.length ? "critical" : "warning",
          summary: ongoing.length
            ? `Prebiehajúce konanie: ${ongoing.map((p) => `${p.kind} č. ${p.number}`).join(", ")}.`
            : `Žiadne prebiehajúce konanie; v minulosti: ${proceedings.map((p) => `${p.kind} č. ${p.number}`).join(", ")}.`,
          findings: f,
          verifyUrl,
          data: {
            asOf,
            proceedings,
            insolvent: ongoing.some((p) => !isLiq(p)),
            dissolution: Boolean(liq),
            dissolutionText: liq ? `${liq.kind} č. ${liq.number} (${liq.state || "prebieha"})` : undefined,
          },
        };
      }
      if (noResults)
        return { status: "ok", summary: "V registri úpadcov a likvidácií nie je žiadne konanie voči subjektu.", findings: [], verifyUrl, data: { proceedings: [], asOf: ctx.asOf ? { date: ctx.asOf, startedBefore: [], startedSameYear: [], startedAfter: [] } : undefined } };
      return {
        status: "manual",
        summary: "Register úpadcov nevrátil jednoznačný výsledok (dynamická stránka). Otvorte odkaz a potvrďte manuálne.",
        findings: [],
        verifyUrl,
      };
    },
  );
}
