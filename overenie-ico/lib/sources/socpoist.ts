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
/** Rozpozná formát (XLSX/XLS/CSV, prípadne ZIP s nimi) a zaindexuje dlžníkov podľa IČO. */
export async function indexFile(buf: Buffer, map: Map<string, Debtor>): Promise<number> {
  const XLSX = await import("xlsx");
  let count = 0;
  const sheetRows = (wb: any) => wb.SheetNames.map((sn: string) => XLSX.utils.sheet_to_json(wb.Sheets[sn], { header: 1, raw: false, defval: "" }) as any[][]);
  const readBook = (b: Buffer): any[][][] => {
    const magic = b.subarray(0, 4).toString("hex");
    if (magic === "504b0304" || magic === "d0cf11e0") return sheetRows(XLSX.read(b, { type: "buffer" }));
    // text (CSV): UTF-8, inak Windows-1250 (bežné pri slovenských exportoch)
    let text = b.toString("utf8");
    if (text.includes("\uFFFD")) text = new TextDecoder("windows-1250").decode(b);
    return sheetRows(XLSX.read(text, { type: "string" }));
  };
  let books: any[][][] = [];
  const magic = buf.subarray(0, 4).toString("hex");
  if (magic === "504b0304") {
    // XLSX je tiež ZIP – ak neobsahuje hárky s IČO, skúsime ho rozbaliť ako archív so súbormi
    books = readBook(buf);
    if (!books.some((rows) => rows.some((r) => r.some((c: any) => /^i[cč]o$/i.test(String(c).trim()))))) {
      const { unzipSync } = await import("fflate");
      const files = unzipSync(new Uint8Array(buf));
      books = Object.entries(files)
        .filter(([n]) => /\.(csv|txt|xlsx?|ods)$/i.test(n))
        .flatMap(([, d]) => readBook(Buffer.from(d)));
    }
  } else if (magic.startsWith("25504446")) {
    throw new Error("zoznam je vo formáte PDF – nedá sa strojovo spracovať");
  } else books = readBook(buf);

  for (const rows of books) {
    let hi = rows.findIndex((r) => r.some((c: any) => /^i[cč]o$/i.test(String(c).trim())));
    if (hi < 0) hi = 0;
    const h = (rows[hi] || []).map((c: any) => fold(String(c)));
    const iIco = h.findIndex((c: string) => /^ico$/.test(c.trim()));
    const iName = h.findIndex((c: string) => /nazov|meno|dlznik|subjekt/.test(c));
    const iCity = h.findIndex((c: string) => /mesto|obec/.test(c));
    const iAmt = h.findIndex((c: string) => /suma|dlh|vyska|pohladav|nedoplat/.test(c));
    for (const r of rows.slice(hi + 1)) {
      const ico = String(iIco >= 0 ? r[iIco] : r.find((c: any) => /^\d{6,8}$/.test(String(c).trim())) || "")
        .replace(/\s/g, "")
        .padStart(8, "0");
      if (!/^\d{8}$/.test(ico) || ico === "00000000") continue;
      count++;
      map.set(ico, { name: String(r[iName] ?? ""), city: iCity >= 0 ? String(r[iCity]) : undefined, amount: iAmt >= 0 ? String(r[iAmt]) : undefined });
    }
  }
  return count;
}

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
    const map = new Map<string, Debtor>();
    const count = await indexFile(buf, map);
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
