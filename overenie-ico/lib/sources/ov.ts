import { kv } from "../auth/kv";
import { getOvAccess } from "../access";
import { fetchWithTimeout, fold } from "../http";
import { sq } from "../searchlog";
import type { CheckResult, Ctx, Finding } from "../types";
import { MANUAL } from "./manual";

/**
 * Obchodný vestník (MS SR) – oznámenia o likvidácii, konkurze, reštrukturalizácii, znížení imania, výzvach veriteľom, dražbách, zlúčeniach.
 * Ministerstvo poskytuje registrovaným používateľom štruktúrované údaje vo formáte XML (bez poplatku; sťahovanie v pracovné dni 19:00 – 7:00).
 * Aplikácia ich importuje (cron alebo ručné nahratie v administrácii), indexuje podľa IČO a kontrola „ov“ sa vyhodnocuje z indexu.
 *
 * Index: `ov:ico:<IČO>` → zoznam oznámení; `ov:meta` → stav importu (počet, rozsah dátumov, čas). Kým index neexistuje, kontrola ostáva manuálna.
 */
export interface OvNotice {
  /** Dátum zverejnenia (YYYY-MM-DD) */
  date: string;
  /** Číslo vydania OV, napr. 190/2026 */
  issue?: string;
  /** Druh oznámenia / formulár (napr. „Konkurzy a reštrukturalizácie“, „Oznámenie o vstupe do likvidácie“) */
  kind: string;
  /** Značka / identifikátor oznámenia v OV */
  ref?: string;
  /** Názov dotknutého subjektu */
  name?: string;
  /** Krátky text */
  text?: string;
}
export interface OvMeta {
  count: number;
  icos: number;
  from?: string;
  to?: string;
  updatedAt: string;
  files: number;
  source: string;
}

const icoKey = (ico: string) => `ov:ico:${ico}`;
const META_KEY = "ov:meta";
const MAX_PER_ICO = 50;

export async function ovMeta(): Promise<OvMeta | null> {
  return kv().get<OvMeta>(META_KEY);
}

/** Zaradenie oznámenia podľa závažnosti pre hodnotenie partnera. */
export function classifyNotice(kind: string, text = ""): { severity: Finding["severity"]; penalty: number; label: string } {
  const t = fold(`${kind} ${text}`);
  if (/konkurz|restruktur|upad|oddlz/.test(t)) return { severity: "critical", penalty: 40, label: "konkurz / reštrukturalizácia" };
  if (/likvid/.test(t)) return { severity: "critical", penalty: 35, label: "likvidácia" };
  if (/zrusen|vymaz/.test(t)) return { severity: "critical", penalty: 35, label: "zrušenie / výmaz" };
  if (/drazb/.test(t)) return { severity: "warning", penalty: 15, label: "dražba" };
  if (/znizen.*imani|znizenie zakladneho/.test(t)) return { severity: "warning", penalty: 10, label: "zníženie základného imania" };
  if (/vyzv.*veritel|veritel/.test(t)) return { severity: "warning", penalty: 10, label: "výzva veriteľom" };
  if (/zluc|splynut|rozdelen|premen/.test(t)) return { severity: "info", penalty: 0, label: "zlúčenie / premena" };
  if (/zavierk|vyrocn/.test(t)) return { severity: "info", penalty: 0, label: "účtovná závierka / výročná správa" };
  return { severity: "info", penalty: 0, label: kind || "oznámenie" };
}

// --- Import XML ---------------------------------------------------------------------------------------------------

const ICO_RE = /\b\d{8}\b/g;
const tag = (xml: string, names: string[]): string | undefined => {
  for (const n of names) {
    const m = xml.match(new RegExp(`<${n}(?:\\s[^>]*)?>([\\s\\S]*?)</${n}>`, "i"));
    if (m) return m[1].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  }
  return undefined;
};
const dateOf = (s?: string): string | undefined => {
  if (!s) return undefined;
  const m = s.match(/(\d{4})-(\d{2})-(\d{2})/) || s.match(/(\d{1,2})\.\s*(\d{1,2})\.\s*(\d{4})/);
  if (!m) return undefined;
  return m[1].length === 4 ? `${m[1]}-${m[2]}-${m[3]}` : `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
};

/**
 * Z XML vydania OV vyberie oznámenia a IČO v nich. Parser je zámerne tolerantný k názvom prvkov (presná schéma sa doladí podľa prvého
 * reálneho súboru): oznámenie = prvok, ktorý obsahuje aspoň jedno IČO; druh = názov prvku alebo pole typu/formulára.
 */
export function parseOvXml(xml: string, fallbackDate?: string): { ico: string; notice: OvNotice }[] {
  const out: { ico: string; notice: OvNotice }[] = [];
  const issue = tag(xml, ["cisloVydania", "CisloVydania", "vydanie", "Vydanie", "issue"]);
  const issueDate = dateOf(tag(xml, ["datumVydania", "DatumVydania", "datum", "Datum", "date"])) || fallbackDate;
  // kandidáti na oznámenie: najmenšie prvky obsahujúce IČO
  const items = xml.match(/<(oznamenie|Oznamenie|zaznam|Zaznam|podanie|Podanie|item|Item|record|Record|formular|Formular|dokument|Dokument|notice)\b[^>]*>[\s\S]*?<\/\1>/g) || [];
  const chunks = items.length ? items : xml.split(/(?=<[A-Za-z][\w]*\b[^>]*>)/).filter((c) => ICO_RE.test(c));
  for (const chunk of chunks) {
    // 8-miestne čísla, ktoré vyzerajú ako dátum (RRRRMMDD), nie sú IČO
    const icos = [...new Set((chunk.match(ICO_RE) || []).filter((x) => !/^(19|20)\d{2}(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])$/.test(x)))];
    if (!icos.length) continue;
    const kind = tag(chunk, ["typ", "Typ", "druh", "Druh", "typFormulara", "TypFormulara", "nazovFormulara", "NazovFormulara", "kategoria", "Kategoria", "kapitola", "Kapitola"]) || (chunk.match(/^<([A-Za-z][\w]*)/)?.[1] ?? "oznámenie");
    const notice: OvNotice = {
      date: dateOf(tag(chunk, ["datumZverejnenia", "DatumZverejnenia", "datum", "Datum", "date"])) || issueDate || new Date().toISOString().slice(0, 10),
      issue: tag(chunk, ["cisloVydania", "CisloVydania"]) || issue,
      kind,
      ref: tag(chunk, ["znacka", "Znacka", "spisovaZnacka", "SpisovaZnacka", "cislo", "Cislo", "id", "Id", "identifikator"]),
      name: tag(chunk, ["obchodneMeno", "ObchodneMeno", "nazov", "Nazov", "nazovSubjektu", "meno", "Meno", "dlznik", "Dlznik", "upadca", "Upadca"]),
      text: tag(chunk, ["text", "Text", "obsah", "Obsah", "popis", "Popis", "predmet", "Predmet"])?.slice(0, 400),
    };
    for (const ico of icos.slice(0, 5)) out.push({ ico, notice });
  }
  return out;
}

/** Uloží oznámenia do indexu (idempotentné podľa dátum+druh+značka). */
export async function indexNotices(entries: { ico: string; notice: OvNotice }[], source: string): Promise<{ added: number; icos: number }> {
  const byIco = new Map<string, OvNotice[]>();
  for (const e of entries) byIco.set(e.ico, [...(byIco.get(e.ico) || []), e.notice]);
  let added = 0;
  for (const [ico, list] of byIco) {
    const cur = (await kv().get<OvNotice[]>(icoKey(ico))) || [];
    const seen = new Set(cur.map((n) => `${n.date}|${n.kind}|${n.ref || ""}`));
    const fresh = list.filter((n) => !seen.has(`${n.date}|${n.kind}|${n.ref || ""}`));
    if (!fresh.length) continue;
    added += fresh.length;
    const merged = [...fresh, ...cur].sort((a, b) => (a.date < b.date ? 1 : -1)).slice(0, MAX_PER_ICO);
    await kv().set(icoKey(ico), merged);
  }
  const meta = (await ovMeta()) || { count: 0, icos: 0, updatedAt: "", files: 0, source };
  const dates = entries.map((e) => e.notice.date).filter(Boolean).sort();
  const next: OvMeta = {
    count: meta.count + added,
    icos: meta.icos + [...byIco.keys()].length,
    from: [meta.from, dates[0]].filter(Boolean).sort()[0],
    to: [meta.to, dates[dates.length - 1]].filter(Boolean).sort().reverse()[0],
    updatedAt: new Date().toISOString(),
    files: meta.files + 1,
    source,
  };
  await kv().set(META_KEY, next);
  return { added, icos: byIco.size };
}

/** Import z XML textu (ručné nahratie v administrácii alebo cron). */
export async function importOvXml(xml: string, source: string, fallbackDate?: string) {
  const entries = parseOvXml(xml, fallbackDate);
  const r = await indexNotices(entries, source);
  return { parsed: entries.length, ...r };
}

/**
 * Cron: stiahne export z adresy OV_EXPORT_URL (s {date} = YYYY-MM-DD, prihlásenie OV_USER / OV_PASSWORD – HTTP Basic) za posledné dni.
 * Presný tvar adresy dá ministerstvo po registrácii; do nastavenia sa nič nesťahuje.
 */
export async function importOvFromMinistry(days = 3): Promise<{ ok: boolean; files: number; added: number; error?: string }> {
  const acc = await getOvAccess();
  const tpl = acc?.exportUrl;
  if (!tpl) return { ok: false, files: 0, added: 0, error: "Prístup k exportu Obchodného vestníka nie je nastavený (Administrácia → Prístupy k registrom, alebo OV_EXPORT_URL) – import nie je zapnutý." };
  const auth: Record<string, string> = acc?.user ? { Authorization: `Basic ${Buffer.from(`${acc.user}:${acc.password || ""}`).toString("base64")}` } : {};
  let files = 0, added = 0;
  for (let i = 0; i < days; i++) {
    const d = new Date(Date.now() - i * 864e5).toISOString().slice(0, 10);
    const url = tpl.replace("{date}", d).replace("{yyyymmdd}", d.replace(/-/g, ""));
    try {
      const r = await fetchWithTimeout(url, { headers: auth, timeoutMs: 60000 });
      if (r.status === 404) continue;
      if (!r.ok) return { ok: false, files, added, error: `HTTP ${r.status} pri ${url}` };
      const xml = await r.text();
      const res = await importOvXml(xml, "ministerstvo", d);
      files++;
      added += res.added;
    } catch (e) {
      return { ok: false, files, added, error: (e as Error).message };
    }
  }
  return { ok: true, files, added };
}

// --- Kontrola ---------------------------------------------------------------------------------------------------

export async function checkOv(ctx: Ctx): Promise<CheckResult | null> {
  const def = MANUAL.find((m) => m.id === "ov")!;
  const t0 = Date.now();
  const meta = await ovMeta().catch(() => null);
  if (!meta || !meta.count) return null; // index neexistuje → manuálna kontrola
  const list = (await kv().get<OvNotice[]>(icoKey(ctx.ico))) || [];
  const stale = Date.now() - +new Date(meta.updatedAt) > 10 * 864e5;
  const f: Finding[] = [];
  const recent = list.filter((n) => Date.now() - +new Date(n.date) < 3 * 365.25 * 864e5);
  let worst: Finding["severity"] = "info";
  const seenLabels = new Set<string>();
  for (const n of recent) {
    const c = classifyNotice(n.kind, n.text);
    const key = c.label;
    const penalty = seenLabels.has(key) ? 0 : c.penalty; // rovnaký druh oznámenia sa počíta raz
    seenLabels.add(key);
    f.push({ severity: c.severity, text: `Obchodný vestník ${n.date}${n.issue ? ` (OV ${n.issue})` : ""}: ${c.label}${n.name ? ` – ${n.name}` : ""}${n.text ? `: ${n.text.slice(0, 160)}` : ""}`, penalty });
    if (c.severity === "critical" || (c.severity === "warning" && worst !== "critical")) worst = c.severity;
  }
  const coverage = meta.from && meta.to ? ` Index pokrýva vydania ${meta.from} – ${meta.to}.` : "";
  return {
    id: def.id,
    category: def.category,
    name: def.name,
    source: def.source,
    sourceUrl: def.sourceUrl,
    verifyUrl: def.verifyUrl(ctx.ico, ctx.profile.name),
    status: !recent.length ? "ok" : worst === "critical" ? "critical" : worst === "warning" ? "warning" : "ok",
    summary: recent.length
      ? `${recent.length} ${recent.length === 1 ? "oznámenie" : recent.length < 5 ? "oznámenia" : "oznámení"} za posledné 3 roky (${[...seenLabels].join(", ")}).${coverage}`
      : `Bez oznámenia o subjekte v importovaných vydaniach.${coverage}${stale ? " Upozornenie: import je starší ako 10 dní." : ""}`,
    findings: stale && !recent.length ? [{ severity: "warning", text: "Import Obchodného vestníka je starší ako 10 dní – posledné vydania nemusia byť zahrnuté", penalty: 0 }] : f,
    data: { penaltyIfFound: def.penaltyIfFound, severityIfFound: def.severityIfFound, notices: recent.slice(0, 20), older: list.length - recent.length, index: meta },
    search: [
      {
        dataset: `Obchodný vestník – index importovaných vydaní (export MS SR${meta.from && meta.to ? `, vydania ${meta.from} – ${meta.to}` : ""})`,
        total: meta.count,
        asOf: meta.updatedAt ? new Date(meta.updatedAt).toLocaleDateString("sk-SK") : undefined,
        queries: [sq("IČO", ctx.ico, list.length, recent.length, undefined, `${list.length} oznámení k IČO v indexe, z toho ${recent.length} za 3 roky`)],
        rule: "oznámenia s IČO subjektu za 3 roky, triedené podľa druhu",
      },
    ],
    checkedAt: new Date().toISOString(),
    durationMs: Date.now() - t0,
    automated: true,
  };
}
