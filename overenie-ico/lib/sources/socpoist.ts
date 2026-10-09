import { runCheck } from "../check";
import { cached, fetchWithTimeout, fold, getText, stripHtml } from "../http";
import { kv } from "../auth/kv";
import { sq } from "../searchlog";
import type { SearchLog } from "../types";
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
    // XLSX je tiež ZIP. Sociálna poisťovňa však dáva ZIP archív so súborom (XLSX sa naň „nechytí“ – Unsupported ZIP file)
    try {
      books = readBook(buf);
    } catch {
      books = [];
    }
    const hasIco = (bs: any[][][]) => bs.some((rows) => rows.some((r) => r.some((c: any) => /^i[cč]o$/i.test(String(c).trim()))));
    if (!hasIco(books)) {
      const { unzipSync } = await import("fflate");
      const files = unzipSync(new Uint8Array(buf));
      const names = Object.keys(files);
      books = Object.entries(files)
        .filter(([n, d]) => !n.endsWith("/") && d.length > 0 && !/__MACOSX/.test(n))
        .flatMap(([, d]) => {
          try {
            return readBook(Buffer.from(d));
          } catch {
            return [];
          }
        });
      if (!hasIco(books)) throw new Error(`v archíve sa nenašiel zoznam s IČO (súbory: ${names.slice(0, 5).join(", ")})`);
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
  return cached("socpoist-index", 6 * 3600e3, downloadIndex);
}

async function downloadIndex(): Promise<{ map: Map<string, Debtor>; count: number; file: string }> {
  {
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
  }
}

/**
 * Trvalý index v databáze (Upstash): hash IČO → „suma|názov|mesto“. Kontrola potom potrebuje 1 dotaz
 * namiesto sťahovania ~136 000 riadkov. Obnovuje sa na pozadí, keď je starší ako 3 dni.
 */
const META_KEY = "sp:meta";
const MAX_AGE = 3 * 864e5;
interface SpMeta {
  key: string;
  count: number;
  updatedAt: number;
  file: string;
}

async function persistIndex(idx: { map: Map<string, Debtor>; count: number; file: string }) {
  const key = `sp:idx:${Date.now()}`;
  const entries = [...idx.map.entries()];
  for (let i = 0; i < entries.length; i += 4000) {
    const chunk: Record<string, string> = {};
    for (const [ico, d] of entries.slice(i, i + 4000)) chunk[ico] = [d.amount || "", d.name || "", d.city || ""].join("|");
    await kv().hset(key, chunk);
  }
  const old = await kv().get<SpMeta>(META_KEY);
  await kv().set(META_KEY, { key, count: idx.count, updatedAt: Date.now(), file: idx.file } satisfies SpMeta);
  if (old?.key && old.key !== key) await kv().del(old.key);
}

/** Stiahne a uloží zoznam; najviac jedna príprava naraz (zámok 10 min). */
export async function buildIndexNow(): Promise<{ built: boolean; count?: number; error?: string }> {
  if ((await kv().incr("sp:lock", 600)) !== 1) return { built: false, error: "príprava už beží" };
  try {
    const idx = await downloadIndex();
    await persistIndex(idx);
    return { built: true, count: idx.count };
  } catch (e) {
    return { built: false, error: (e as Error).message };
  } finally {
    await kv().del("sp:lock");
  }
}

/** Príprava na pozadí (po odoslaní odpovede). */
async function startBackgroundBuild() {
  try {
    const { after } = await import("next/server");
    after(() => buildIndexNow().catch(() => undefined));
  } catch {
    buildIndexNow().catch(() => undefined);
  }
}
const refreshInBackground = startBackgroundBuild;

async function lookupStored(ico: string): Promise<{ meta: SpMeta; d: Debtor | null } | null> {
  try {
    const meta = await kv().get<SpMeta>(META_KEY);
    if (!meta?.key) return null;
    const v = await kv().hget(meta.key, ico);
    if (v === null) return { meta, d: null };
    const [amount, name, city] = v.split("|");
    return { meta, d: { amount: amount || undefined, name, city: city || undefined } };
  } catch {
    return null;
  }
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
        let d: Debtor | null | undefined;
        let count = 0;
        let asOf: number | undefined;
        const stored = await lookupStored(ctx.ico);
        if (stored) {
          d = stored.d;
          count = stored.meta.count;
          asOf = stored.meta.updatedAt;
          if (Date.now() - stored.meta.updatedAt > MAX_AGE) await refreshInBackground();
        } else {
          // Prvé spustenie: zoznam (~130 000 riadkov) sa pripraví na pozadí, aby nezdržal preverenie.
          // Ak už beží príprava, počkáme najviac 6 s, či medzitým skončila.
          await startBackgroundBuild();
          for (let i = 0; i < 3; i++) {
            await new Promise((r) => setTimeout(r, 2000));
            const again = await lookupStored(ctx.ico);
            if (again) {
              d = again.d;
              count = again.meta.count;
              asOf = again.meta.updatedAt;
              break;
            }
          }
          if (d === undefined)
            return {
              status: "error",
              summary: "Zoznam dlžníkov Sociálnej poisťovne sa práve pripravuje (prvé spustenie, asi 1 minúta). Kliknite na „Skúsiť znova“.",
              findings: [],
              verifyUrl,
              data: { preparing: true },
            };
        }
        const search: SearchLog[] = [
          {
            dataset: "Sociálna poisťovňa – zoznam dlžníkov (súbor zverejnený SP, indexovaný podľa IČO)",
            total: count,
            asOf: asOf ? new Date(asOf).toLocaleDateString("sk-SK") : undefined,
            queries: [sq("IČO", ctx.ico, d ? 1 : 0, d ? 1 : 0, undefined, `priame vyhľadanie v zozname ${count.toLocaleString("sk-SK")} dlžníkov`)],
            rule: "zhoda IČO v zozname",
          },
        ];
        if (!d)
          return {
            search,
            status: "ok",
            summary: `Subjekt NIE JE v zozname dlžníkov Sociálnej poisťovne (prehľadaných ${count.toLocaleString("sk-SK")} záznamov${asOf ? `, zoznam k ${new Date(asOf).toLocaleDateString("sk-SK")}` : ""}).`,
            findings: [],
            verifyUrl,
          };
        return {
          search,
          status: "critical",
          summary: `Subjekt JE dlžníkom Sociálnej poisťovne${d.amount ? ` – dlh ${d.amount}` : ""}.`,
          findings: [{ severity: "critical", text: `Dlh voči Sociálnej poisťovni${d.amount ? ` ${d.amount}` : ""}`, penalty: 35 }],
          verifyUrl,
          data: d as unknown as Record<string, unknown>,
        };
      } catch (e) {
        // Záložné riešenie: vyhľadanie na webe. Spoľahlivý je len pozitívny nález (IČO v tabuľke).
        const html = await getText(`${PAGE}?search=${ctx.ico}`).catch(() => "");
        const webSearch: SearchLog[] = [{ dataset: "Sociálna poisťovňa – zoznam dlžníkov (web SP, záloha)", queries: [sq("IČO", ctx.ico, null, html && stripHtml(html).includes(ctx.ico) ? 1 : 0, `${PAGE}?search=${ctx.ico}`, `index zoznamu nedostupný: ${(e as Error).message.slice(0, 100)}`)], rule: "IČO v tabuľke výsledkov (spoľahlivý je len nález)" }];
        if (html && stripHtml(html).includes(ctx.ico))
          return {
            search: webSearch,
            status: "critical",
            summary: "Subjekt sa nachádza v zozname dlžníkov Sociálnej poisťovne (nález na webe SP).",
            findings: [{ severity: "critical", text: "Dlh voči Sociálnej poisťovni", penalty: 35 }],
            verifyUrl,
          };
        return {
          search: webSearch,
          status: "manual",
          summary: `Zoznam sa nepodarilo automaticky spracovať (${(e as Error).message}). Overte manuálne.`,
          findings: [],
          verifyUrl,
        };
      }
    },
  );
}
