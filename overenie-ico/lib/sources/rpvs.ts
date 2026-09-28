import { runCheck } from "../check";
import { getJson } from "../http";
import type { CheckResult, Ctx } from "../types";

/** Register partnerov verejného sektora (Ministerstvo spravodlivosti SR) – OData. */
const ENDPOINTS = [
  (ico: string) =>
    `https://rpvs.gov.sk/opendatav2/PartneriVerejnehoSektora?$filter=Ico%20eq%20'${ico}'&$expand=KonecniUzivateliaVyhod,Partner`,
  (ico: string) => `https://rpvs.gov.sk/OpenData/Partneri?$filter=Ico%20eq%20'${ico}'&$expand=KonecniUzivateliaVyhod`,
  (ico: string) => `https://rpvs.gov.sk/OpenData/Partneri?$filter=Ico%20eq%20'${ico}'`,
];

export async function checkRpvs(ctx: Ctx): Promise<CheckResult> {
  return runCheck(
    {
      id: "rpvs",
      category: "public",
      name: "Register partnerov verejného sektora",
      source: "Ministerstvo spravodlivosti SR – RPVS",
      sourceUrl: "https://rpvs.gov.sk",
    },
    async () => {
      const verifyUrl = `https://rpvs.gov.sk/rpvs/Partner/Partner/VyhladavaniePartnera?Ico=${ctx.ico}`;
      let rows: any[] | null = null;
      let lastErr: Error | null = null;
      for (const ep of ENDPOINTS) {
        try {
          const raw = await getJson<any>(ep(ctx.ico), { timeoutMs: 12000 });
          rows = raw?.value || [];
          break;
        } catch (e) {
          lastErr = e as Error;
        }
      }
      if (rows === null) throw lastErr || new Error("RPVS nedostupný");
      if (!rows.length)
        return {
          status: "info",
          summary: "Subjekt nie je zapísaný v RPVS (zápis je povinný len pri plneniach od štátu nad zákonné limity).",
          findings: [],
          verifyUrl,
        };
      const r = rows[0];
      const kuv = (r.KonecniUzivateliaVyhod || [])
        .filter((k: any) => !k.PlatnostDo)
        .map((k: any) => [k.TitulPred, k.Meno, k.Priezvisko, k.TitulZa].filter(Boolean).join(" ") || k.ObchodneMeno)
        .filter(Boolean);
      const deleted = r.PlatnostDo && new Date(r.PlatnostDo) < new Date();
      return {
        status: "ok",
        summary: `Zapísaný v RPVS${deleted ? " (zápis ukončený)" : ""}.${kuv.length ? ` Koneční užívatelia výhod: ${kuv.join(", ")}.` : ""}`,
        findings: kuv.length ? [{ severity: "info", text: `KUV podľa RPVS: ${kuv.join(", ")}`, penalty: 0 }] : [],
        verifyUrl,
        data: { kuv, raw: { Id: r.Id, CisloVlozky: r.CisloVlozky, PlatnostOd: r.PlatnostOd, PlatnostDo: r.PlatnostDo } },
      };
    },
  );
}
