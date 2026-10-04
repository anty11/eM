import { BrowserSession, renderSnapshot, type Snapshot } from "./session";

/**
 * Skriptované dopyty cez prehliadač na serveri – bez AI, deterministicky, pre registre, ktoré sú len aplikáciou v prehliadači.
 * Použijú sa ako záloha priamych dopytov (lib/sources/public.ts), keď API nie je dostupné (Union vracia 401 bez tokenu aplikácie).
 * Výsledok má rovnaký tvar ako pokus v probe(): verdict + rows + evidence + výňatok stránky.
 */
export interface FlowResult {
  verdict: "found" | "clean" | "unknown";
  rows: string[];
  evidence?: string;
  url: string;
  ms: number;
  rendered?: string;
  error?: string;
}

const fold = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

/**
 * Union ZP – zoznam dlžníkov (portal.unionzp.sk/pub/dlznici): pole „Zadajte priezvisko, IČO, obchodný názov, obec“, tlačidlo „Hľadať“,
 * tabuľka Priezvisko a meno / Názov · IČO · Pohľadávka · Nárok na ZS · Adresa; pod ňou „1–10 z N“.
 */
export async function unionFlow(ico: string, opts: { diag?: boolean } = {}): Promise<FlowResult> {
  const t0 = Date.now();
  const url = "https://portal.unionzp.sk/pub/dlznici";
  let s: BrowserSession | null = null;
  try {
    s = await BrowserSession.open(["unionzp.sk"]);
    let snap = await s.open(url);
    const field = snap.elements.find((e) => e.kind === "input" && /ico|icˇo|obchodn/i.test(fold(e.placeholder || e.label || "")));
    if (!field) return { verdict: "unknown", rows: [], url, ms: Date.now() - t0, error: "vyhľadávacie pole sa nenašlo", rendered: opts.diag ? renderSnapshot(snap) : undefined };
    snap = await s.fill(field.ref, ico);
    const btn = snap.elements.find((e) => e.kind === "button" && /hladat/.test(fold(e.label)));
    snap = btn ? await s.click(btn.ref) : await s.pressEnter(field.ref);
    // výsledky sa načítavajú na pozadí – počkáme, kým zmizne pôvodný zoznam alebo sa objaví hlásenie / počet
    for (let i = 0; i < 6 && !settled(snap, ico); i++) snap = await s.wait(1000);
    return { ...judgeUnion(snap, ico), url: snap.url, ms: Date.now() - t0, rendered: opts.diag ? renderSnapshot(snap) : undefined };
  } catch (e) {
    return { verdict: "unknown", rows: [], url, ms: Date.now() - t0, error: (e as Error).message.split("\n")[0].slice(0, 300) };
  } finally {
    await s?.close();
  }
}

/** Je výsledok hľadania už načítaný? (tabuľka s riadkom pre IČO, prázdny zoznam alebo počet „z N“ menší než celý zoznam) */
function settled(snap: Snapshot, ico: string): boolean {
  const t = fold(snap.text);
  if (t.includes(ico)) return true;
  if (/ziadne|nenasli|neboli najdene|0 z 0|z 0\b/.test(t)) return true;
  const m = t.match(/\d+[–-]\d+ z (\d+)/);
  return Boolean(m && Number(m[1]) < 1000);
}

export function judgeUnion(snap: Snapshot, ico: string): Pick<FlowResult, "verdict" | "rows" | "evidence"> {
  const table = snap.tables.find((t) => t[0]?.some((h) => /IČO/i.test(h)));
  const t = fold(snap.text);
  if (table) {
    const icoCol = table[0].findIndex((h) => /IČO/i.test(h));
    const rows = table.slice(1).filter((r) => (r[icoCol] || "").replace(/\s/g, "") === ico);
    if (rows.length) {
      const amtCol = table[0].findIndex((h) => /pohľad/i.test(h));
      return { verdict: "found", rows: rows.map((r) => `${r[0]} · IČO ${r[icoCol]} · pohľadávka ${r[amtCol]} €`), evidence: rows[0].join(" | ") };
    }
    const dataRows = table.slice(1).filter((r) => r.some(Boolean));
    const m = t.match(/\d+[–-]\d+ z (\d+)/);
    // po hľadaní: prázdna tabuľka alebo hlásenie, alebo malý počet výsledkov bez nášho IČO (zhoda len podľa textu, nie podľa IČO)
    if (!dataRows.length || /ziadne|nenasli|neboli najdene|0 z 0|z 0\b/.test(t)) return { verdict: "clean", rows: [], evidence: snap.text.match(/.{0,60}(žiadne|nenašli|0 z 0|z 0\b).{0,60}/i)?.[0] || "prázdny zoznam výsledkov" };
    if (m && Number(m[1]) < 1000 && Number(m[1]) === dataRows.length) return { verdict: "clean", rows: [], evidence: `výsledky hľadania (${m[1]}) neobsahujú IČO ${ico}` };
  }
  return { verdict: "unknown", rows: [] };
}
