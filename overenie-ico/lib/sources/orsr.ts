import { fetchWithTimeout, fold } from "../http";

/**
 * Záložná identifikácia z Obchodného registra SR (www.orsr.sk), keď API Registra právnických osôb (ŠÚ SR) neodpovie včas.
 * ORSR nemá API – načíta sa vyhľadávanie podľa IČO a aktuálny výpis (HTML v kódovaní windows-1250) a vytiahnu sa základné údaje:
 * obchodné meno, sídlo, právna forma, deň zápisu, štatutárny orgán, spoločníci / akcionár, prípadný výmaz alebo likvidácia.
 * Pokrýva len subjekty zapísané v obchodnom registri (nie živnostníkov, združenia …) – pre tie ostáva RPO jediným zdrojom.
 */
export interface OrsrResult {
  name: string;
  address?: string;
  legalForm?: string;
  established?: string; // YYYY-MM-DD
  terminated?: string;
  inLiquidation: boolean;
  statutory: { name: string; role: string; since?: string }[];
  owners: { name: string; role: string; since?: string }[];
  registrationNumber?: string;
  url: string;
}

const BASE = "https://www.orsr.sk";

const toIso = (d?: string) => {
  const m = d?.match(/(\d{1,2})\.\s*(\d{1,2})\.\s*(\d{4})/);
  return m ? `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}` : undefined;
};

async function getCp1250(url: string, timeoutMs: number): Promise<string> {
  const r = await fetchWithTimeout(url, { timeoutMs, headers: { Accept: "text/html" } });
  if (!r.ok) throw new Error(`HTTP ${r.status} z www.orsr.sk`);
  const buf = await r.arrayBuffer();
  const ct = r.headers.get("content-type") || "";
  const enc = /utf-?8/i.test(ct) ? "utf-8" : "windows-1250";
  return new TextDecoder(enc).decode(buf);
}

/** HTML → riadky textu (bunky a zalomenia ako nové riadky), bez značiek a entít. */
export function orsrLines(html: string): string[] {
  return html
    .replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<(br|\/tr|\/td|\/p|\/div|\/li|\/h\d)\b[^>]*>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .split("\n")
    .map((l) => l.replace(/\s+/g, " ").trim())
    .filter(Boolean);
}

const LABELS = [
  "Oddiel",
  "Vložka číslo",
  "Vložka",
  "Obchodné meno",
  "Sídlo",
  "IČO",
  "Deň zápisu",
  "Deň výmazu",
  "Dôvod výmazu",
  "Právna forma",
  "Predmet činnosti",
  "Predmet podnikania",
  "Spoločníci",
  "Akcionár",
  "Výška vkladu každého spoločníka",
  "Štatutárny orgán",
  "Konanie menom spoločnosti",
  "Konanie",
  "Prokúra",
  "Základné imanie",
  "Akcie",
  "Dozorná rada",
  "Likvidátor",
  "Likvidácia",
  "Ďalšie právne skutočnosti",
  "Právny nástupca",
  "Zlúčenie, splynutie",
  "Dátum aktualizácie údajov",
  "Dátum výpisu",
];
const labelRe = new RegExp(`^(${LABELS.map((l) => l.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})\\s*:\\s*(.*)$`, "i");

/** Rozdelí výpis na sekcie podľa označení („Obchodné meno:“, „Štatutárny orgán:“ …). */
export function orsrSections(lines: string[]): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  let cur = "";
  for (const l of lines) {
    const m = l.match(labelRe);
    if (m) {
      cur = LABELS.find((x) => fold(x) === fold(m[1])) || m[1];
      out[cur] = out[cur] || [];
      if (m[2]) out[cur].push(m[2]);
    } else if (cur) out[cur].push(l);
  }
  return out;
}

const OD = /\(od:\s*(\d{1,2}\.\d{1,2}\.\d{4})\)/i;
const ROLE = /^(predstavenstvo|konate[ľl]\S*|predseda\S*( predstavenstva)?|podpredseda\S*( predstavenstva)?|[čc]len\S*( predstavenstva)?|riadite[ľl]\S*|komplement[áa]r|prokurista|likvid[áa]tor|spr[áa]vna rada|štatutárny orgán)\s*:?\s*/i;
const looksLikeName = (s: string) => /^(?:(?:Ing|Mgr|JUDr|MUDr|PhDr|RNDr|Bc|doc|prof|PaedDr|MVDr|PharmDr|Dr|DiS|MBA|PhD|CSc)\.?,?\s+)*[A-ZÁČĎÉÍĽĹŇÓÔŔŠŤÚÝŽ][\p{L}'’.-]+(\s+[\p{L}'’.,-]+){1,5}$/u.test(s) && !/\d/.test(s);

/** Osoby zo sekcie (štatutárny orgán, spoločníci): meno = prvý „menný“ riadok záznamu; záznam končí značkou (od: …). */
export function orsrPersons(rows: string[] | undefined, defaultRole: string): { name: string; role: string; since?: string }[] {
  if (!rows?.length) return [];
  const out: { name: string; role: string; since?: string }[] = [];
  let role = defaultRole;
  let buf: string[] = [];
  const flush = (since?: string) => {
    const name = buf.map((x) => x.replace(ROLE, "").trim()).find((x) => x && (looksLikeName(x) || /\b(a\.\s?s\.|s\.\s?r\.\s?o\.|spol\.|N\.V\.|S\.A\.|Ltd|GmbH|Kft|Zrt|Nyrt|AG|B\.V\.)/i.test(x)));
    if (name && !/^(vznik|skon[čc]enie|bydlisko|s[íi]dlo)\b/i.test(name)) out.push({ name: name.replace(/,\s*$/, ""), role, since: since ? toIso(since) : undefined });
    buf = [];
  };
  for (const raw of rows) {
    const r = raw.trim();
    const rm = r.match(ROLE);
    if (rm && r.replace(ROLE, "").trim() === "") {
      role = rm[1].toLowerCase();
      continue;
    }
    if (/^vznik funkcie|^skon[čc]enie funkcie/i.test(r)) continue;
    const od = r.match(OD);
    const text = r.replace(OD, "").trim();
    if (rm) role = rm[1].toLowerCase();
    if (text) buf.push(text);
    if (od) flush(od[1]);
  }
  if (buf.length) flush();
  // rovnaká osoba môže byť uvedená viackrát (zmena adresy)
  return out.filter((p, i) => out.findIndex((q) => fold(q.name) === fold(p.name)) === i);
}

const first = (rows?: string[]) => (rows || []).map((r) => r.replace(OD, "").trim()).find(Boolean);
const firstOd = (rows?: string[]) => (rows || []).map((r) => r.match(OD)?.[1]).find(Boolean);

export function parseOrsrExtract(html: string, url: string): OrsrResult | null {
  const sec = orsrSections(orsrLines(html));
  const name = first(sec["Obchodné meno"]);
  if (!name) return null;
  const address = (sec["Sídlo"] || [])
    .map((r) => r.replace(OD, "").trim())
    .filter(Boolean)
    .slice(0, 2)
    .join(", ");
  const legal = `${(sec["Likvidátor"] || []).join(" ")} ${(sec["Likvidácia"] || []).join(" ")} ${name}`;
  return {
    name,
    address: address || undefined,
    legalForm: first(sec["Právna forma"]),
    established: toIso(first(sec["Deň zápisu"])) || toIso(firstOd(sec["Obchodné meno"])),
    terminated: toIso(first(sec["Deň výmazu"])),
    inLiquidation: /v likvid[áa]cii|likvid[áa]tor/i.test(legal) || Boolean(sec["Likvidátor"]?.length),
    statutory: orsrPersons(sec["Štatutárny orgán"], "štatutár"),
    owners: orsrPersons(sec["Spoločníci"] || sec["Akcionár"], sec["Akcionár"] ? "akcionár" : "spoločník"),
    registrationNumber: [first(sec["Oddiel"]), first(sec["Vložka číslo"] || sec["Vložka"])].filter(Boolean).join(", vložka ") || undefined,
    url,
  };
}

/** Odkazy na aktuálny výpis (P=0) zo stránky vyhľadávania podľa IČO. */
export function orsrExtractLinks(html: string): string[] {
  const links = [...html.matchAll(/href=["']?([^"'\s>]*vypis\.asp\?ID=\d+[^"'\s>]*)/gi)].map((m) => m[1].replace(/&amp;/g, "&"));
  const current = links.filter((l) => /[?&]P=0\b/.test(l));
  return [...new Set((current.length ? current : links).map((l) => new URL(l, `${BASE}/`).toString()))];
}

export async function orsrIdentify(ico: string, timeoutMs = 8000): Promise<OrsrResult | null> {
  const searchUrl = `${BASE}/hladaj_ico.asp?ICO=${ico}&SID=0`;
  const html = await getCp1250(searchUrl, timeoutMs);
  const links = orsrExtractLinks(html);
  if (!links.length) return null;
  const url = links[0];
  return parseOrsrExtract(await getCp1250(url, timeoutMs), url);
}
