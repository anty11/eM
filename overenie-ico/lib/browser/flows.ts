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
  /** postup ľudskými slovami (z /api/browser/flow) */
  steps?: string[];
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
    // len odhad do záznamu behu – „bez záznamu“ sa do protokolu nedá dať podľa istoty modelu, výsledok ostáva neistý (manuálne / AI s dôkazom)
    return { ...r, jev: `${v.choice} ${Math.round(v.confidence * 100)} %${nearRecord ? " (pri IČO sú sumy/udalosti)" : ""}` };
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
      let target = from;
      // pole „od“ je neaktívne, kým sa nezvolí prepínač rozsahu (OV: „dňa“ / „od – do“) → najbližší nezaškrtnutý prepínač pred poľom
      if (from.disabled) {
        const idx = snap.elements.findIndex((e) => e.ref === from.ref);
        const radio = snap.elements.slice(0, idx).reverse().find((e) => e.kind === "radio" && e.value !== "zaškrtnuté" && !e.disabled);
        if (radio) {
          snap = await s.click(radio.ref).catch(() => snap);
          done.push("prepínač rozsahu dátumov");
          target = snap.elements.find((e) => e.name && e.name === from.name) || from;
        }
      }
      if (!target.disabled) {
        snap = await s.fill(target.ref, skDate(d)).catch(() => snap);
        done.push(`dátum od ${skDate(d)}`);
        const to = snap.elements.find((e) => e.kind === "input" && e.ref !== target.ref && !e.disabled && /(datum|date|zverejn).*\b(do|to)$|^(do|to)$/.test(fieldKey(e.name)));
        if (to && !to.value) {
          snap = await s.fill(to.ref, skDate(new Date())).catch(() => snap);
          done.push(`dátum do ${skDate(new Date())}`);
        }
      } else done.push("dátum sa nedal nastaviť (pole neaktívne)");
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
export async function ovFlow(ico: string, opts: { diag?: boolean; url?: string; hosts?: string[] } = {}): Promise<FlowResult> {
  const t0 = Date.now();
  const url = opts.url || "https://obchodnyvestnik.justice.gov.sk/ObchodnyVestnik/Formular/FormulareZverejnene.aspx";
  let s: BrowserSession | null = null;
  try {
    // OV funguje priamo – len jeho hostiteľ, aby prehliadač nešiel cez proxy pre justice.gov.sk
    s = await BrowserSession.open(opts.hosts || ["obchodnyvestnik.justice.gov.sk"]);
    await s.open(url);
    const prelude = await searchPrelude(s, ico, { dateFromYearsBack: 3 });
    let snap = prelude.snap;
    if (!s.searched) return { verdict: "unknown", rows: [], url: snap.url, ms: Date.now() - t0, error: `formulár sa nepodarilo odoslať (${prelude.done.join(", ") || "pole IČO sa nenašlo"})`, rendered: opts.diag ? renderSnapshot(snap) : undefined, actions: s?.log, pages: s?.pages };
    // Všetky oznámenia za 3 roky: 100 na stránku, ďalšie stránky, kým sú novšie ako hranica (zoznam je zoradený od najnovších)
    const cutoff = new Date();
    cutoff.setFullYear(cutoff.getFullYear() - 3);
    const all: string[][] = [];
    let head: string[] | null = null;
    let complete = false;
    let pagesRead = 0;
    if (ovPager(snap).sizes.includes(100) && ovRows(snap).rows.length >= 10) snap = await s.clickLinkText("100").catch(() => snap);
    for (let page = 1; page <= 10; page++) {
      const { head: h, rows } = ovRows(snap);
      if (!h) break;
      head = h;
      pagesRead = page;
      all.push(...rows);
      const oldest = rows.map((r) => ovDate(r, h)).filter(Boolean).sort()[0];
      const pager = ovPager(snap);
      const hasNext = pager.pages.includes(page + 1) || (pager.more && pager.pages.length > 0);
      if (!hasNext || (oldest && oldest < cutoff.toISOString().slice(0, 10))) {
        complete = true;
        break;
      }
      try {
        snap = await s.clickLinkText(String(page + 1));
      } catch {
        break; // ďalšia stránka sa neotvorila → výsledok neúplný (unknown, ak nie je nález)
      }
    }
    const judged = head ? judgeOvRows(head, all, cutoff, complete, pagesRead) : judgeOv(snap, ico);
    return { ...(await withJev(judged, "ov", snap, ico)), url: snap.url, ms: Date.now() - t0, rendered: opts.diag ? renderSnapshot(snap) : undefined, actions: s?.log, pages: s?.pages };
  } catch (e) {
    return { verdict: "unknown", rows: [], url, ms: Date.now() - t0, error: (e as Error).message.split("\n")[0].slice(0, 300), actions: s?.log, pages: s?.pages };
  } finally {
    await s?.close();
  }
}

/** Stránkovanie výsledkov OV: „Aktuálna stránka: 1 2 3 … 13 Počet záznamov na stránku: 10 20 50 100“. */
export function ovPager(snap: Snapshot): { current: number; pages: number[]; sizes: number[]; more: boolean } {
  const m = snap.text.match(/Aktu[áa]lna str[áa]nka:\s*([\d\s.…]+?)\s*(Po[čc]et z[áa]znamov na str[áa]nku:\s*([\d\s]+))?(?:$|[^\d\s.…])/i);
  const pages = (m?.[1].match(/\d+/g) || []).map(Number);
  const sizes = (m?.[3]?.match(/\d+/g) || []).map(Number);
  // aktuálna stránka nie je odkaz – jediné číslo, ktoré medzi odkazmi chýba
  const linkNums = new Set(snap.elements.filter((e) => e.kind === "link" && /^\d+$/.test(e.label)).map((e) => Number(e.label)));
  const current = pages.find((n) => !linkNums.has(n)) || pages[0] || 1;
  return { current, pages, sizes, more: /…|\.\.\./.test(m?.[1] || "") };
}

/** Dátové riadky tabuľky výsledkov OV (bez riadku so stránkovaním). */
export function ovRows(snap: Snapshot): { head: string[] | null; rows: string[][] } {
  const table = snap.tables.find((tb) => tb[0]?.some((h) => /typ podania|kapitol/i.test(h)) && tb[0].length >= 4);
  if (!table) return { head: null, rows: [] };
  const head = table[0];
  const rows = table.slice(1).filter((r) => r.length >= 4 && r.some((c) => /\d{1,2}\.\d{1,2}\.\d{4}/.test(c)));
  return { head, rows };
}

const ovDate = (r: string[], head: string[]) => {
  const c = r[head.findIndex((h) => /d[áa]tum/i.test(h))] || r.find((x) => /\d{1,2}\.\d{1,2}\.\d{4}/.test(x)) || "";
  const m = c.match(/(\d{1,2})\.(\d{1,2})\.(\d{4})/);
  return m ? `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}` : "";
};

/** Posúdenie oznámení OV za posledné 3 roky (riadky zo všetkých prečítaných stránok). */
export function judgeOvRows(head: string[], all: string[][], cutoff: Date, complete: boolean, pagesRead?: number): Pick<FlowResult, "verdict" | "rows" | "evidence"> {
  const typeCol = head.findIndex((h) => /typ|podani/i.test(h));
  const chapCol = head.findIndex((h) => /kapitol/i.test(h));
  const subjCol = head.findIndex((h) => /subjekt|n[áa]zov/i.test(h));
  const lim = cutoff.toISOString().slice(0, 10);
  const rows = all.filter((r) => {
    const d = ovDate(r, head);
    return !d || d >= lim;
  });
  const negative = rows.map((r) => ({ r, c: classifyNotice(r[typeCol] || "", r[chapCol] || "") })).filter((x) => x.c.severity !== "info");
  const sk = (iso: string) => (iso ? iso.split("-").reverse().join(".") : "");
  if (negative.length) return { verdict: "found", rows: negative.map((x) => `${x.c.label}: ${x.r[typeCol]} · ${sk(ovDate(x.r, head))} · ${x.r[subjCol] || ""}`.trim()), evidence: negative[0].r.filter(Boolean).join(" | ") };
  if (!complete) return { verdict: "unknown", rows: [] };
  const counts = new Map<string, number>();
  for (const r of rows) if (r[typeCol]) counts.set(r[typeCol], (counts.get(r[typeCol]) || 0) + 1);
  const types = [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([t, n]) => `${t} (${n})`);
  const period = `${skDate(cutoff)} – ${skDate(new Date())}`;
  return {
    verdict: "clean",
    rows: [],
    evidence: rows.length
      ? `obdobie ${period}, prečítané všetky výsledky (${rows.length} podaní${pagesRead ? ` na ${pagesRead} ${pagesRead === 1 ? "strane" : "stranách"}` : ""}); druhy podaní: ${types.slice(0, 6).join(", ")}${types.length > 6 ? ` a ďalšie (${types.length - 6})` : ""}; žiadne oznámenie o likvidácii, konkurze, reštrukturalizácii, zrušení, znížení základného imania, výzve veriteľom ani dražbe`
      : `obdobie ${period}: vyhľadávanie podľa IČO nevrátilo žiadne podanie`,
  };
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
  const rows = table.slice(1).filter((r) => r.length >= 4 && r.some(Boolean));
  const negative = rows.map((r) => ({ r, c: classifyNotice(r[typeCol] || "", r[chapCol] || "") })).filter((x) => x.c.severity !== "info");
  // stránkovanie: ak stránka ukazuje len časť výsledkov, nevieme posúdiť zvyšok
  const pageInfo = t.match(/(\d+)\s*[–-]\s*(\d+)\s*z\s*(\d+)/) || t.match(/strana\s*(\d+)\s*z\s*(\d+)/);
  const pager = ovPager(snap);
  const paged = (pager.pages.length > 1) || (Boolean(pageInfo) && rows.length >= 10 && !(pageInfo && pageInfo.length === 4 && Number(pageInfo[2]) === Number(pageInfo[3])));
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
    if (!dataRows.length || /ziadne|nenasli|neboli najdene|0 z 0|z 0\b/.test(t))
      return { verdict: "clean", rows: [], evidence: [table[1]?.join(" ").trim(), snap.text.match(/\d+\s*[–-]\s*\d+\s*z\s*\d+/)?.[0]].filter(Boolean).join(" · ") || "prázdny zoznam výsledkov" };
    if (m && Number(m[1]) < 1000 && Number(m[1]) === dataRows.length) return { verdict: "clean", rows: [], evidence: `výsledky hľadania (${m[1]}) neobsahujú IČO ${ico}` };
  }
  return { verdict: "unknown", rows: [] };
}

/**
 * Register diskvalifikácií – stránka na justice.gov.sk je len obal; zoznam vykresľuje aplikácia React
 * (obcan.justice.sk/pilot/isu) a dáta berie z API (obcan.justice.sk/pilot/api/ress-isu-service/v1). Diagnostika otvorí stránku
 * v prehliadači (cez proxy), zaznamená všetky dopyty XHR/fetch s odpoveďami a skúsi vyhľadať podľa IČO a mien štatutárov –
 * z výstupu sa potom dá písať priamy dopyt na API bez prehliadača.
 */
export interface NetCall { url: string; method: string; status: number; type: string; post?: string; body?: string; ms?: number }

export async function diskvCapture(ico: string, names: string[] = [], opts: { url?: string; hosts?: string[] } = {}) {
  const t0 = Date.now();
  const calls: NetCall[] = [];
  const steps: { step: string; url?: string; rendered?: string; error?: string }[] = [];
  let s: BrowserSession | null = null;
  try {
    s = await BrowserSession.open(opts.hosts || ["justice.gov.sk", "obcan.justice.sk"]);
    const started = new Map<unknown, number>();
    s.page.on("request", (r) => started.set(r, Date.now()));
    s.page.on("response", async (r) => {
      const req = r.request();
      const type = req.resourceType();
      if (type !== "xhr" && type !== "fetch") return;
      let body = "";
      try {
        body = (await r.text()).slice(0, 4000);
      } catch {}
      const st = started.get(req);
      calls.push({ url: r.url(), method: req.method(), status: r.status(), type, post: req.postData()?.slice(0, 800) || undefined, body, ms: st ? Date.now() - st : undefined });
    });
    const snapStep = async (step: string, snap: Snapshot) => steps.push({ step, url: snap.url, rendered: renderSnapshot(snap).slice(0, 5000) });
    const url = opts.url || "https://www.justice.gov.sk/registre/registerDiskvalifikacii/";
    let snap = await s.open(url);
    await s.wait(2500);
    snap = await s.snapshot();
    await snapStep("otvorenie", snap);
    // 1) IČO (ak má formulár také pole)
    const pre = await searchPrelude(s, ico).catch((e) => ({ snap, done: [`chyba: ${(e as Error).message.split("\n")[0]}`] }));
    if (pre.done.length) {
      await s.wait(2500);
      await snapStep(`IČO: ${pre.done.join(", ")}`, await s.snapshot());
    }
    // 2) meno štatutára – prvé textové pole s menom/priezviskom/hľadaním
    if (names[0]) {
      await s.open(url);
      await s.wait(2000);
      snap = await s.snapshot();
      const nameRe = /meno|priezvisko|nazov|hlad|search|osoba|fyzick/;
      const field = snap.elements.find((e) => e.kind === "input" && nameRe.test(fold(`${e.label} ${e.placeholder || ""} ${e.name || ""}`)));
      if (field) {
        const surname = names[0].replace(/,.*$/, "").split(/\s+/).filter((w) => !/\.$/.test(w)).pop() || names[0];
        snap = await s.fill(field.ref, surname);
        snap = await s.pressEnter(field.ref).catch(() => snap);
        await s.wait(3000);
        await snapStep(`meno: ${surname} → ${field.label || field.name || field.ref}`, await s.snapshot());
      } else steps.push({ step: "meno: pole na meno sa nenašlo" });
    }
  } catch (e) {
    steps.push({ step: "chyba", error: (e as Error).message.split("\n")[0] });
  } finally {
    await (s as BrowserSession | null)?.close();
  }
  return { ms: Date.now() - t0, proxied: (s as BrowserSession | null)?.proxied, calls: calls.slice(0, 40), steps };
}
