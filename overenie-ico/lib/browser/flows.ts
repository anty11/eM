import { classifyNotice } from "../sources/ov";
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
  const field = snap.elements.find((e) => e.kind === "input" && icoRe.test(fold(`${e.label} ${e.name || ""} ${e.placeholder || ""}`)));
  if (!field) return { snap, done };
  snap = await s.fill(field.ref, ico);
  done.push(`IČO → ${field.label || field.name || field.ref}`);
  if (opts.dateFromYearsBack) {
    const from = snap.elements.find((e) => e.kind === "input" && /(datum|zverejn|date).*(od|from)|(^|\s)od(\s|$)|from/.test(fold(`${e.label} ${e.name || ""} ${e.placeholder || ""}`)) && !/\bdo\b|\bto\b/.test(fold(e.label)));
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
    if (!s.searched) return { verdict: "unknown", rows: [], url: snap.url, ms: Date.now() - t0, error: `formulár sa nepodarilo odoslať (${done.join(", ") || "pole IČO sa nenašlo"})`, rendered: opts.diag ? renderSnapshot(snap) : undefined };
    return { ...judgeOv(snap, ico), url: snap.url, ms: Date.now() - t0, rendered: opts.diag ? renderSnapshot(snap) : undefined };
  } catch (e) {
    return { verdict: "unknown", rows: [], url, ms: Date.now() - t0, error: (e as Error).message.split("\n")[0].slice(0, 300) };
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
