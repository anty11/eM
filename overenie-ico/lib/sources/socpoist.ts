import { runCheck } from "../check";
import { cached, fetchWithTimeout, fold, getText, stripHtml } from "../http";
import type { CheckResult, Ctx } from "../types";

const PAGE = "https://www.socpoist.sk/nastroje-sluzby/zoznam-dlznikov";
const FALLBACK_FILE = "https://www.socpoist.sk/api/idsp/download/ed57da4c-93aa-4198-ae4b-b2d65d3ca099";

interface Debtor {
  name: string;
  city?: string;
  amount?: string;
}

/**
 * Sociálna poisťovňa zverejňuje celý zoznam dlžníkov ako súbor na stiahnutie (aktualizácia 4× mesačne).
 * Súbor stiahneme, zaindexujeme podľa IČO a držíme v pamäti 6 hodín.
 */
async function loadIndex(): Promise<{ map: Map<string, Debtor>; count: number; file: string }> {
  return cached("socpoist-index", 6 * 3600e3, async () => {
    let file = FALLBACK_FILE;
    try {
      const html = await getText(PAGE, { timeoutMs: 15000 });
      const m = html.match(/https?:\/\/www\.socpoist\.sk\/api\/idsp\/download\/[0-9a-f-]{36}|\/api\/idsp\/download\/[0-9a-f-]{36}/i);
      if (m) file = m[0].startsWith("http") ? m[0] : `https://www.socpoist.sk${m[0]}`;
    } catch {
      /* použijeme posledný známy odkaz */
    }
    const res = await fetchWithTimeout(file, { timeoutMs: 45000 });
    if (!res.ok) throw new Error(`HTTP ${res.status} pri sťahovaní zoznamu dlžníkov`);
    const buf = Buffer.from(await res.arrayBuffer());
    const XLSX = await import("xlsx");
    const wb = XLSX.read(buf, { type: "buffer", codepage: 65001 });
    const map = new Map<string, Debtor>();
    let count = 0;
    for (const sn of wb.SheetNames) {
      const rows: any[][] = XLSX.utils.sheet_to_json(wb.Sheets[sn], { header: 1, raw: false, defval: "" });
      // nájdi riadok s hlavičkou
      let hi = rows.findIndex((r) => r.some((c) => /^i[cč]o$/i.test(String(c).trim())));
      if (hi < 0) hi = 0;
      const h = rows[hi].map((c) => fold(String(c)));
      const iIco = h.findIndex((c) => /^ico$/.test(c.trim()));
      const iName = h.findIndex((c) => /nazov|meno|dlznik/.test(c));
      const iCity = h.findIndex((c) => /mesto|obec/.test(c));
      const iAmt = h.findIndex((c) => /suma|dlh|vyska|pohladav/.test(c));
      for (const r of rows.slice(hi + 1)) {
        const ico = String(iIco >= 0 ? r[iIco] : r.find((c) => /^\d{6,8}$/.test(String(c).trim())) || "")
          .replace(/\s/g, "")
          .padStart(8, "0");
        if (!/^\d{8}$/.test(ico) || ico === "00000000") continue;
        count++;
        map.set(ico, { name: String(r[iName] ?? ""), city: iCity >= 0 ? String(r[iCity]) : undefined, amount: iAmt >= 0 ? String(r[iAmt]) : undefined });
      }
    }
    if (count < 1000) throw new Error("súbor so zoznamom dlžníkov má neočakávaný formát");
    return { map, count, file };
  });
}

export async function checkSocpoist(ctx: Ctx): Promise<CheckResult> {
  return runCheck(
    {
      id: "socpoist",
      category: "insurance",
      name: "Dlžníci Sociálnej poisťovne",
      source: "Sociálna poisťovňa – zoznam dlžníkov",
      sourceUrl: PAGE,
    },
    async () => {
      const verifyUrl = `${PAGE}?search=${encodeURIComponent(ctx.profile.name || ctx.ico)}`;
      try {
        const { map, count } = await loadIndex();
        const d = map.get(ctx.ico);
        if (!d)
          return {
            status: "ok",
            summary: `Subjekt NIE JE v zozname dlžníkov Sociálnej poisťovne (prehľadaných ${count.toLocaleString("sk-SK")} záznamov).`,
            findings: [],
            verifyUrl,
          };
        return {
          status: "critical",
          summary: `Subjekt JE dlžníkom Sociálnej poisťovne${d.amount ? ` – dlh ${d.amount}` : ""}.`,
          findings: [{ severity: "critical", text: `Dlh voči Sociálnej poisťovni${d.amount ? ` ${d.amount}` : ""}`, penalty: 35 }],
          verifyUrl,
          data: d as unknown as Record<string, unknown>,
        };
      } catch (e) {
        // Záložné riešenie: vyhľadanie na webe. Spoľahlivý je len pozitívny nález (IČO v tabuľke).
        const html = await getText(`${PAGE}?search=${ctx.ico}`).catch(() => "");
        if (html && stripHtml(html).includes(ctx.ico))
          return {
            status: "critical",
            summary: "Subjekt sa nachádza v zozname dlžníkov Sociálnej poisťovne (nález na webe SP).",
            findings: [{ severity: "critical", text: "Dlh voči Sociálnej poisťovni", penalty: 35 }],
            verifyUrl,
          };
        return {
          status: "manual",
          summary: `Zoznam sa nepodarilo automaticky spracovať (${(e as Error).message}). Overte manuálne.`,
          findings: [],
          verifyUrl,
        };
      }
    },
  );
}
