import { classifyNotice } from "../sources/ov";
import { getJevConfig, jevJudgeResult } from "../ai/jev";
import { AI_SPECS } from "../ai/specs";
import { BrowserSession, renderSnapshot, type Snapshot } from "./session";

/**
 * Skriptované dopyty cez prehliadač na serveri – bez AI, deterministicky, pre registre, ktoré sú len aplikáciou v prehliadači.
 * Použijú sa ako záloha priamych dopytov (lib/sources/public.ts), keď API nie je dostupné (Union vracia 401 bez tokenu aplikácie).
 * Výsledok má rovnaký tvar ako pokus v probe(): verdict + rows + evidence + výňatok stránky.
 */
export interface FlowResult {
  /** Záznam pre administráciu (akcie a snímky stránok) */
  actions?: import("./session").SessionLog[];
  pages?: import("./session").PageTrace[];
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
 * Kľúč poľa z technického názvu: posledný segment (ASP.NET „ctl00$CphMain$txtIco“ → „txtIco“), bez typických predpôn (txt, tb, inp …),
 * malými písmenami s oddelením slov – „ico“, „datum zverejnenia od“. Umožní nájsť pole aj bez viditeľného popisu.
 */
export function fieldKey(name?: string): string {
  if (!name) return "";
  const last = name.split(/[$.:/\[\]]/).filter(Boolean).pop() || name;
  const noPrefix = last.replace(/^(txt|tb|tbx|inp|input|fld|field|ctl|ed|edt)(?=[A-Z_-])/, "");
  return fold(noPrefix.replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/[_-]+/g, " ")).trim();
}

/**
 * Keď pevné pravidlá výsledok nevedia určiť („unknown“), skúsi ho rýchlo vyhodnotiť Jev (ak je nastavený). Prijme sa len „bez záznamu“
 * s istotou nad prahom a len ak sa na stránke IČO nevyskytuje pri údajoch o dlhu/zázname; nález vždy ostáva na AI/manuálne (detaily).
 */
async function withJev(r: Pick<FlowResult, "verdict" | "rows" | "evidence">, id: "union" | "ov", snap: Snapshot, ico: string): Promise<Pick<FlowResult, "verdict" | "rows" | "evidence"> & { jev?: string }> {
  if (r.verdict !== "unknown") return r;
  const spec = AI_SPECS[id]?.jev;
  const cfg = spec ? await getJevConfig().catch(() => null) : null;
  if (!spec || !cfg) return r;
  try {
    const v = await jevJudgeResult(cfg, { register: spec.register, ico, snapshot: snap, negativeMeans: spec.negative, routineMeans: spec.routine });
    const i = snap.text.indexOf(ico);
    const nearRecord = i >= 0 && /dlh|pohľadáv|nedoplat|likvid|konkurz|dražb|€|eur/i.test(snap.text.slice(Math.max(0, i - 160), i + 160));
    if (v.choice === "clean" && v.confidence >= cfg.minConfidence && !nearRecord)
      return { verdict: "clean", rows: [], evidence: `vyhodnotil Jev (TypeSafe), istota ${Math.round(v.confidence * 100)} %`, jev: `${v.model} ${v.ms} ms` };
    return { ...r, jev: `${v.choice} ${Math.round(v.confidence * 100)} %` };
  } catch {
    return r;
  }
}

const skDate = (d: Date) => `${String(d.getDate()).padStart(2, "0")}.${String(d.getMonth() + 1).padStart(2, "0")}.${d.getFullYear()}`;

/**
 * Všeobecný úvod vyhľadávania (bez AI): prijme cookies, nájde pole pre IČO, vyplní ho, voliteľne nastaví dátum „od“ a odošle formulár.
 * Používa ho skriptovaný dopyt aj AI agent (ktorému tak ušetrí 4 – 6 krokov – vidí už stránku s výsledkom a len ju číta / opraví).
 * Vracia, čo sa podarilo; ak sa pole nenašlo, formulár sa neodoslal (searched ostane false).
 */
export async function searchPrelude(s: BrowserSession, ico: string, opts: { dateFromYearsBack?: number; icoField?: RegExp } = {}): Promise<{ snap: Snapshot; done: string[] }> {
  const done: string[] = [];
  let snap = await s.snapshot();
  const consent = snap.elements.find((e) => e.kind === "button" && /^(suhlasim|prijat|prijat vsetko|accept( all)?|rozumiem|ok|povolit( vsetko)?)$/.test(fold(e.label).replace(/[^a-z ]/g, "").trim()));
  if (consent) {
    snap = await s.click(consent.ref).catch(() => snap);
    done.push("súhlas s cookies");
  }
  const icoRe = opts.icoField || /(^|[^a-z])ico([^a-z]|$)|identifikacne cislo/;
  const field = snap.elements.find((e) => e.kind === "input" && (icoRe.test(fold(`${e.label} ${e.placeholder || ""}`)) || icoRe.test(fieldKey(e.name))));
  if (!field) return { snap, done };
  snap = await s.fill(field.ref, ico);
  done.push(`IČO → ${field.label || field.name || field.ref}`);
  if (opts.dateFromYearsBack) {
    const from = snap.elements.find(
      (e) =>
        e.kind === "input" &&
        e.ref !== field.ref &&
        (/(datum|zverejn|date).*(od|from)|(^|\s)od(\s|$)|from/.test(fold(`${e.label} ${e.placeholder || ""}`)) || /(datum|date|zverejn).*\b(od|from)$|^(od|from)$/.test(fieldKey(e.name))) &&
        !/\bdo\b|\bto\b/.test(fold(e.label)),
    );
    if (from) {
      const d = new Date();
      d.setFullYear(d.getFullYear() - opts.dateFromYearsBack);
      snap = await s.fill(from.ref, skDate(d)).catch(() => snap);
      done.push(`dátum od ${skDate(d)}`);
    }
  }
  const btn = snap.elements.find((e) => e.kind === "button" && /hladat|vyhladat|search|zobraz|filtrovat/.test(fold(e.label)));
  snap = btn ? await s.click(btn.ref) : await s.pressEnter(field.ref);
  done.push(btn ? `odoslané (${btn.label})` : "odoslané (Enter)");
  for (let i = 0; i < 5 && !snap.tables.length && !/ziadne|nenasli|nebol najden|0 zaznam/.test(fold(snap.text)); i++) snap = await s.wait(1000);
  return { snap, done };
}

/**
 * Obchodný vestník – „Zverejnené formuláre“ (ASP.NET): vyhľadanie podľa IČO s dátumom zverejnenia od (3 roky), tabuľka
 * „# | Typ podania | Dátum | Kapitola | Subjekt | Číslo OV“. Oznámenia sa triedia rovnako ako pri importe XML (classifyNotice):
 * negatívne (konkurz, likvidácia, zrušenie, dražba, zníženie imania, výzva veriteľom) = záznam; len podania OR / závierky = bez záznamu.
 * Ak je výsledkov viac strán, než vidíme, vráti „unknown“ (dokončí AI agent alebo manuálne).
 */
export async function ovFlow(ico: string, opts: { diag?: boolean } = {}): Promise<FlowResult> {
  const t0 = Date.now();
  const url = "https://obchodnyvestnik.justice.gov.sk/ObchodnyVestnik/Formular/FormulareZverejnene.aspx";
  let s: BrowserSession | null = null;
  try {
    s = await BrowserSession.open(["justice.gov.sk"]);
    await s.open(url);
    const { snap, done } = await searchPrelude(s, ico, { dateFromYearsBack: 3 });
    if (!s.searched) return { verdict: "unknown", rows: [], url: snap.url, ms: Date.now() - t0, error: `formulár sa nepodarilo odoslať (${done.join(", ") || "pole IČO sa nenašlo"})`, rendered: opts.diag ? renderSnapshot(snap) : undefined, actions: s?.log, pages: s?.pages };
    return { ...(await withJev(judgeOv(snap, ico), "ov", snap, ico)), url: snap.url, ms: Date.now() - t0, rendered: opts.diag ? renderSnapshot(snap) : undefined, actions: s?.log, pages: s?.pages };
  } catch (e) {
    return { verdict: "unknown", rows: [], url, ms: Date.now() - t0, error: (e as Error).message.split("\n")[0].slice(0, 300), actions: s?.log, pages: s?.pages };
  } finally {
    await s?.close();
  }
}

export function judgeOv(snap: Snapshot, ico: string): Pick<FlowResult, "verdict" | "rows" | "evidence"> {
  const t = fold(snap.text);
  const table = snap.tables.find((tb) => tb[0]?.some((h) => /typ|kapitol|podani/i.test(h)) && tb.length > 1);
  if (!table) {
    if (/ziadne|nenasli|nebol najden|0 zaznam|neboli najdene/.test(t) && t.includes(ico)) return { verdict: "clean", rows: [], evidence: snap.text.match(/.{0,80}(žiadne|nenašli|nebol nájden|neboli nájdené).{0,60}/i)?.[0] };
    return { verdict: "unknown", rows: [] };
  }
  const head = table[0];
  const typeCol = head.findIndex((h) => /typ|podani/i.test(h));
  const chapCol = head.findIndex((h) => /kapitol/i.test(h));
  const dateCol = head.findIndex((h) => /d[áa]tum/i.test(h));
  const subjCol = head.findIndex((h) => /subjekt|n[áa]zov/i.test(h));
  const rows = table.slice(1).filter((r) => r.some(Boolean));
  const negative = rows.map((r) => ({ r, c: classifyNotice(r[typeCol] || "", r[chapCol] || "") })).filter((x) => x.c.severity !== "info");
  // stránkovanie: ak stránka ukazuje len časť výsledkov, nevieme posúdiť zvyšok
  const pageInfo = t.match(/(\d+)\s*[–-]\s*(\d+)\s*z\s*(\d+)/) || t.match(/strana\s*(\d+)\s*z\s*(\d+)/);
  const paged = Boolean(pageInfo) && rows.length >= 10 && !(pageInfo && pageInfo.length === 4 && Number(pageInfo[2]) === Number(pageInfo[3]));
  if (negative.length) return { verdict: "found", rows: negative.map((x) => `${x.c.label}: ${x.r[typeCol]} · ${x.r[dateCol] || ""} · ${x.r[subjCol] || ""}`.trim()), evidence: negative[0].r.join(" | ") };
  if (paged) return { verdict: "unknown", rows: [] };
  return { verdict: "clean", rows: [], evidence: `${rows.length} oznámení za 3 roky, len ${[...new Set(rows.map((r) => r[typeCol]))].slice(0, 3).join(", ")}` };
}


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
    if (!field) return { verdict: "unknown", rows: [], url, ms: Date.now() - t0, error: "vyhľadávacie pole sa nenašlo", rendered: opts.diag ? renderSnapshot(snap) : undefined, actions: s?.log, pages: s?.pages };
    snap = await s.fill(field.ref, ico);
    const btn = snap.elements.find((e) => e.kind === "button" && /hladat/.test(fold(e.label)));
    snap = btn ? await s.click(btn.ref) : await s.pressEnter(field.ref);
    // výsledky sa načítavajú na pozadí – počkáme, kým zmizne pôvodný zoznam alebo sa objaví hlásenie / počet
    for (let i = 0; i < 6 && !settled(snap, ico); i++) snap = await s.wait(1000);
    return { ...(await withJev(judgeUnion(snap, ico), "union", snap, ico)), url: snap.url, ms: Date.now() - t0, rendered: opts.diag ? renderSnapshot(snap) : undefined, actions: s?.log, pages: s?.pages };
  } catch (e) {
    return { verdict: "unknown", rows: [], url, ms: Date.now() - t0, error: (e as Error).message.split("\n")[0].slice(0, 300), actions: s?.log, pages: s?.pages };
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
