import { runCheck } from "../check";
import { getJson } from "../http";
import type { CheckResult, Ctx } from "../types";

/**
 * Register partnerov verejného sektora (MS SR) – OData API v2 (https://rpvs.gov.sk/opendatav2/swagger).
 * 1. PartneriVerejnehoSektora?$filter=Ico eq '{IČO}'&$expand=Partner  → Partner.Id
 * 2. Partneri({id})?$expand=KonecniUzivateliaVyhod,PartneriVerejnehoSektora → koneční užívatelia výhod
 * Prázdny výsledok = subjekt nie je zapísaný (zápis je povinný len pri plneniach od štátu).
 */
const BASE = "https://rpvs.gov.sk/opendatav2";

const active = (x: any) => !x?.PlatnostDo || new Date(x.PlatnostDo) > new Date();

export async function checkRpvs(ctx: Ctx): Promise<CheckResult> {
  return runCheck(
    {
      id: "rpvs",
      category: "public",
      name: "Register partnerov verejného sektora",
      source: "Ministerstvo spravodlivosti SR – RPVS",
      sourceUrl: "https://rpvs.gov.sk/rpvs",
    },
    async () => {
      const verifyUrl = "https://rpvs.gov.sk/rpvs";
      const q = `${BASE}/PartneriVerejnehoSektora?$filter=${encodeURIComponent(`Ico eq '${ctx.ico}'`)}&$expand=Partner`;
      const raw = await getJson<any>(q, { timeoutMs: 15000 });
      const pvs: any[] = Array.isArray(raw) ? raw : raw?.value || [];
      if (!pvs.length)
        return {
          status: "info",
          summary: "Subjekt nie je zapísaný v RPVS (zápis je povinný len pri plneniach od štátu nad zákonné limity).",
          findings: [],
          verifyUrl,
        };

      const latest = [...pvs].sort((a, b) => (b.Id || 0) - (a.Id || 0))[0];
      const partnerId = latest?.Partner?.Id ?? latest?.PartnerId;
      const cislo = latest?.Partner?.CisloVlozky;
      let kuv: string[] = [];
      let deleted = !active(latest) && !pvs.some(active);
      if (partnerId) {
        try {
          const p = await getJson<any>(`${BASE}/Partneri(${partnerId})?$expand=KonecniUzivateliaVyhod,PartneriVerejnehoSektora`, { timeoutMs: 15000 });
          kuv = (p?.KonecniUzivateliaVyhod || [])
            .filter(active)
            .map((k: any) => [k.TitulPred, k.Meno, k.Priezvisko, k.TitulZa].filter(Boolean).join(" ") || k.ObchodneMeno)
            .filter(Boolean);
          if (p?.PlatnostDo && !active(p)) deleted = true;
        } catch {
          /* detail je doplnkový – zápis samotný je overený */
        }
      }
      return {
        status: "ok",
        summary: `Zapísaný v RPVS${cislo ? ` (vložka č. ${cislo})` : ""}${deleted ? " – zápis ukončený" : ""}.${kuv.length ? ` Koneční užívatelia výhod: ${kuv.join(", ")}.` : ""}`,
        findings: kuv.length ? [{ severity: "info", text: `KUV podľa RPVS: ${kuv.join(", ")}`, penalty: 0 }] : [],
        verifyUrl: partnerId ? `https://rpvs.gov.sk/rpvs/Partner/Partner/Detail/${partnerId}` : verifyUrl,
        data: { kuv, partnerId, cisloVlozky: cislo, deleted },
      };
    },
  );
}
