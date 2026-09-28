import { runCheck } from "../check";
import { fold, getText, stripHtml } from "../http";
import type { CheckResult, Ctx } from "../types";

const BASE = "https://replik.justice.sk/ru-verejnost-web/pages/searchKonanie.xhtml";

/**
 * Register úpadcov (REPLIK, Ministerstvo spravodlivosti SR) – konkurzy, reštrukturalizácie, oddlženia.
 * Stránka je dynamická (JSF), preto za spoľahlivý považujeme iba pozitívny nález.
 * Ak sa nič nenájde, kontrola ostáva na manuálne potvrdenie.
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
      const text = stripHtml(html);
      const t = fold(text);
      if (text.includes(ctx.ico) && /konkurz|restrukturaliz|oddlzen|uspokojenie|upad|likvidac|zrusen/.test(t)) {
        const kind = /restrukturaliz/.test(t)
          ? "reštrukturalizácia"
          : /konkurz/.test(t)
            ? "konkurz"
            : /likvidac|zrusen/.test(t)
              ? "likvidácia / zrušenie"
              : "insolvenčné konanie";
        return {
          status: "critical",
          summary: `V registri úpadcov bolo nájdené konanie (${kind}) k IČO ${ctx.ico}.`,
          findings: [{ severity: "critical", text: `Insolvenčné konanie v REPLIK (${kind}) – overte stav konania`, penalty: 80 }],
          verifyUrl,
          data: { dissolution: kind === "likvidácia / zrušenie" },
        };
      }
      if (/nenasli|ziadne zaznamy|0 zaznamov|nebol najdeny/.test(t))
        return { status: "ok", summary: "V registri úpadcov sa nenašlo žiadne konanie.", findings: [], verifyUrl };
      return {
        status: "manual",
        summary: "Register úpadcov nevrátil jednoznačný výsledok (dynamická stránka). Otvorte odkaz a potvrďte manuálne.",
        findings: [],
        verifyUrl,
      };
    },
  );
}
