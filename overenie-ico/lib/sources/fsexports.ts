import { gunzipSync, gzipSync, unzipSync } from "fflate";
import { fetchWithTimeout, fold } from "../http";
import { kv } from "../auth/kv";

/**
 * Exporty informačných zoznamov Finančnej správy (https://www.financnasprava.sk/sk/elektronicke-sluzby/verejne-sluzby/zoznamy/
 * exporty-z-online-informacnych, ZIP s XML, „pravidelne aktualizované“, len aktuálny stav – archív FS nemá):
 *  - ds_dphs.zip  Zoznam daňových subjektov registrovaných pre DPH (~13 MB)
 *  - cis_spds.zip Zoznam daňových subjektov registrovaných pre spotrebné dane (~220 KB) – OpenData API tento zoznam neponúka
 *
 * Nočná úloha (/api/cron/fs-exports) z nich postaví index v Redise:
 *  - `fsx:vat:cur`   hash IČO → „IČ DPH|dátum registrácie|druh“ (aktuálny zoznam platiteľov) + množina IČO ako gzip (`fsx:vat:set`)
 *  - `fsx:vat:gone`  hash IČO → „naposledy v zozname|prvýkrát chýba|IČ DPH|druh“ – HISTÓRIA ZRUŠENÍ: subjekt, ktorý včera v zozname bol
 *                    a dnes nie je, dostane okno zániku registrácie s presnosťou na deň (od spustenia úlohy; FS archív nevedie,
 *                    preto sa história buduje dopredu). Vymazaní z úradnej moci (§ 52 ods. 8) majú presný dátum v `ds_dphv` (OpenData).
 *  - `fsx:excise`    hash IČO → „druh dane – druh subjektu – od dátum; …“ (registrácie pre spotrebné dane)
 *  - `fsx:meta`      { at, vatCount, exciseCount, vatRowTag, vatFields, exciseFields, goneAdded } – diagnostika a stav dát v protokole
 */
export const FS_EXPORT = {
  vat: "https://report.financnasprava.sk/ds_dphs.zip",
  excise: "https://report.financnasprava.sk/cis_spds.zip",
};
const KEY_CUR = "fsx:vat:cur";
const KEY_SET = "fsx:vat:set";
const KEY_GONE = "fsx:vat:gone";
const KEY_EXCISE = "fsx:excise";
const KEY_META = "fsx:meta";

export interface FsxMeta {
  at: string;
  date: string;
  vatCount: number;
  exciseCount: number;
  vatRowTag?: string;
  vatFields?: string[];
  exciseFields?: string[];
  goneAdded?: number;
  goneTotal?: number;
  firstSnapshot?: string;
  error?: string;
}

/** Stiahne ZIP a vráti text prvého XML (alebo CSV) v archíve. */
export async function downloadExport(url: string): Promise<{ name: string; text: string; bytes: number }> {
  const r = await fetchWithTimeout(url, { timeoutMs: 120000 });
  if (!r.ok) throw new Error(`HTTP ${r.status} pri sťahovaní ${url}`);
  const buf = new Uint8Array(await r.arrayBuffer());
  const files = unzipSync(buf);
  const name = Object.keys(files).find((n) => /\.xml$/i.test(n)) || Object.keys(files).find((n) => /\.csv$/i.test(n)) || Object.keys(files)[0];
  if (!name) throw new Error("archív je prázdny");
  return { name, text: new TextDecoder("utf-8").decode(files[name]), bytes: buf.length };
}

/**
 * Riadky z XML bez znalosti schémy: značka riadku = prvý prvok pod koreňom, polia = listové prvky riadku (CDATA a entity rozbalené).
 * Nezávisí od názvov FS (menia sa) – diagnostika `fs-exports` ukáže zistenú značku a polia.
 */
export function parseXmlRows(xml: string, max = 2_000_000): { rowTag: string; rows: Record<string, string>[]; fields: string[] } {
  const body = xml.replace(/^﻿/, "").replace(/<\?xml[^>]*\?>/, "").replace(/<!--[\s\S]*?-->/g, "");
  const root = body.match(/<([A-Za-z_][\w.-]*)(?:\s[^>]*)?>/);
  if (!root) return { rowTag: "", rows: [], fields: [] };
  const afterRoot = body.slice((root.index || 0) + root[0].length);
  const first = afterRoot.match(/<([A-Za-z_][\w.-]*)(?:\s[^>]*)?>/);
  if (!first) return { rowTag: "", rows: [], fields: [] };
  const rowTag = first[1];
  const rowRe = new RegExp(`<${rowTag}(?:\\s[^>]*)?>([\\s\\S]*?)</${rowTag}>`, "g");
  const leafRe = /<([A-Za-z_][\w.-]*)(?:\s[^>]*)?>(?:<!\[CDATA\[([\s\S]*?)\]\]>|([^<]*))<\/\1>/g;
  const unesc = (s: string) => s.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n))).trim();
  const rows: Record<string, string>[] = [];
  const fields = new Set<string>();
  let m: RegExpExecArray | null;
  while ((m = rowRe.exec(afterRoot)) && rows.length < max) {
    const row: Record<string, string> = {};
    let l: RegExpExecArray | null;
    leafRe.lastIndex = 0;
    while ((l = leafRe.exec(m[1]))) {
      const v = unesc(l[2] ?? l[3] ?? "");
      if (v) row[l[1]] = v;
      fields.add(l[1]);
    }
    if (Object.keys(row).length) rows.push(row);
  }
  return { rowTag, rows, fields: [...fields] };
}

const pick = (row: Record<string, string>, re: RegExp) => Object.entries(row).find(([k, v]) => re.test(fold(k)) && v)?.[1];
const icoOf = (row: Record<string, string>) => {
  const v = pick(row, /(^|_)ico($|_)/) || "";
  const d = v.replace(/\D/g, "");
  return /^\d{6,8}$/.test(d) ? d.padStart(8, "0") : "";
};
const isoDate = (v?: string) => {
  const s = String(v || "").trim();
  const a = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (a) return `${a[1]}-${a[2]}-${a[3]}`;
  const b = s.match(/^(\d{1,2})\.\s*(\d{1,2})\.\s*(\d{4})/);
  return b ? `${b[3]}-${b[2].padStart(2, "0")}-${b[1].padStart(2, "0")}` : s;
};

const packSet = (icos: string[]) => Buffer.from(gzipSync(new TextEncoder().encode(icos.join("\n")))).toString("base64");
const unpackSet = (s: string) => new TextDecoder().decode(gunzipSync(new Uint8Array(Buffer.from(s, "base64")))).split("\n").filter(Boolean);
const CHUNK = 200_000; // znakov base64 na pole hashu (Upstash: požiadavka do 1 MB)

async function saveSet(key: string, icos: string[]) {
  const packed = packSet(icos);
  const fields: Record<string, string> = { n: String(Math.ceil(packed.length / CHUNK)) };
  for (let i = 0; i * CHUNK < packed.length; i++) fields[`c${i}`] = packed.slice(i * CHUNK, (i + 1) * CHUNK);
  await kv().del(key);
  await kv().hset(key, fields);
}
async function loadSet(key: string): Promise<string[] | null> {
  const all = await kv().hgetall(key).catch(() => ({}) as Record<string, string>);
  const n = Number(all.n || 0);
  if (!n) return null;
  let packed = "";
  for (let i = 0; i < n; i++) packed += all[`c${i}`] || "";
  try {
    return unpackSet(packed);
  } catch {
    return null;
  }
}

async function hsetChunked(key: string, entries: [string, string][]) {
  for (let i = 0; i < entries.length; i += 4000) await kv().hset(key, Object.fromEntries(entries.slice(i, i + 4000)));
}

/** Nočná obnova: stiahne oba exporty, prepíše aktuálne indexy a doplní históriu zrušení DPH. */
export async function buildFsExports(): Promise<FsxMeta> {
  const today = new Date().toISOString().slice(0, 10);
  const prevMeta = await kv().get<FsxMeta>(KEY_META).catch(() => null);
  const meta: FsxMeta = { at: new Date().toISOString(), date: today, vatCount: 0, exciseCount: 0, firstSnapshot: prevMeta?.firstSnapshot || today, goneTotal: prevMeta?.goneTotal || 0 };
  if ((await kv().incr("fsx:lock", 900)) !== 1) throw new Error("obnova už beží");
  try {
    // 1) platitelia DPH
    const vat = await downloadExport(FS_EXPORT.vat);
    const parsed = parseXmlRows(vat.text);
    meta.vatRowTag = parsed.rowTag;
    meta.vatFields = parsed.fields.slice(0, 20);
    const cur = new Map<string, string>();
    for (const r of parsed.rows) {
      const ico = icoOf(r);
      if (!ico) continue;
      const icdph = pick(r, /ic_?dph|icdph/) || "";
      const reg = isoDate(pick(r, /datum_?reg|reg.*datum|dat_?reg|od$/));
      const kind = pick(r, /druh|typ_?reg/) || "";
      cur.set(ico, [icdph, reg, kind].join("|"));
    }
    if (cur.size < 100_000) throw new Error(`zoznam platiteľov DPH má neočakávane málo záznamov (${cur.size}; značka riadku „${parsed.rowTag}“, polia: ${parsed.fields.slice(0, 12).join(", ")})`);
    meta.vatCount = cur.size;
    // 2) história zrušení: včera v zozname, dnes nie
    const prev = await loadSet(KEY_SET);
    let goneAdded = 0;
    if (prev && prev.length > 100_000 && prevMeta?.date && prevMeta.date < today) {
      const prevCur = await kv().hgetall(KEY_CUR).catch(() => ({}) as Record<string, string>);
      const gone: [string, string][] = [];
      for (const ico of prev) {
        if (cur.has(ico)) continue;
        const [icdph = "", , kind = ""] = (prevCur[ico] || "").split("|");
        gone.push([ico, [prevMeta.date, today, icdph, kind].join("|")]);
      }
      if (gone.length) await hsetChunked(KEY_GONE, gone);
      goneAdded = gone.length;
      // subjekt, ktorý sa do zoznamu vrátil (nová registrácia), z histórie zrušení nemažeme – ostáva záznam o prerušení
    }
    meta.goneAdded = goneAdded;
    meta.goneTotal = (prevMeta?.goneTotal || 0) + goneAdded;
    // 3) prepis aktuálneho indexu (nový kľúč, potom prepnutie)
    const tmp = `${KEY_CUR}:${Date.now()}`;
    await hsetChunked(tmp, [...cur.entries()]);
    await kv().rename(tmp, KEY_CUR);
    await saveSet(KEY_SET, [...cur.keys()]);
    // 4) spotrebné dane
    try {
      const ex = await downloadExport(FS_EXPORT.excise);
      const p2 = parseXmlRows(ex.text);
      meta.exciseFields = p2.fields.slice(0, 20);
      const byIco = new Map<string, string[]>();
      for (const r of p2.rows) {
        const ico = icoOf(r);
        if (!ico) continue;
        const kind = pick(r, /^druh_?dane$|druh dane|^dan$/) || pick(r, /druh_?dan/) || "";
        const type = pick(r, /druh_?danov\w*_?subj|typ_?subj|druh_?subj|^typ$/) || "";
        const since = isoDate(pick(r, /^datum/));
        const line = [kind, type, since ? `od ${since.split("-").reverse().join(".")}` : ""].filter(Boolean).join(" – ");
        byIco.set(ico, [...(byIco.get(ico) || []), line]);
      }
      const tmpE = `${KEY_EXCISE}:${Date.now()}`;
      await hsetChunked(tmpE, [...byIco.entries()].map(([k, v]) => [k, [...new Set(v)].join("; ")]));
      if (byIco.size) {
        await kv().rename(tmpE, KEY_EXCISE);
        meta.exciseCount = byIco.size;
      }
    } catch (e) {
      meta.error = `spotrebné dane: ${(e as Error).message.slice(0, 200)}`;
    }
    await kv().set(KEY_META, meta);
    return meta;
  } finally {
    await kv().del("fsx:lock");
  }
}

export async function fsExportsMeta(): Promise<FsxMeta | null> {
  return kv().get<FsxMeta>(KEY_META).catch(() => null);
}

/** Platiteľ DPH podľa denného indexu + história zrušenia (okno dní), ak subjekt zo zoznamu vypadol. */
export async function vatHistory(ico: string): Promise<{ meta: FsxMeta | null; current?: { icDph: string; registeredFrom: string; kind: string }; gone?: { lastSeen: string; firstMissing: string; icDph: string; kind: string } }> {
  const meta = await fsExportsMeta();
  if (!meta) return { meta: null };
  const [c, g] = await Promise.all([kv().hget(KEY_CUR, ico).catch(() => null), kv().hget(KEY_GONE, ico).catch(() => null)]);
  const out: Awaited<ReturnType<typeof vatHistory>> = { meta };
  if (c) {
    const [icDph = "", registeredFrom = "", kind = ""] = c.split("|");
    out.current = { icDph, registeredFrom, kind };
  }
  if (g) {
    const [lastSeen = "", firstMissing = "", icDph = "", kind = ""] = g.split("|");
    out.gone = { lastSeen, firstMissing, icDph, kind };
  }
  return out;
}

/** Registrácie pre spotrebné dane podľa denného indexu; null = index ešte nie je. */
export async function exciseByIco(ico: string): Promise<{ meta: FsxMeta; lines: string[] } | null> {
  const meta = await fsExportsMeta();
  if (!meta?.exciseCount) return null;
  const v = await kv().hget(KEY_EXCISE, ico).catch(() => null);
  return { meta, lines: v ? v.split("; ").filter(Boolean) : [] };
}
