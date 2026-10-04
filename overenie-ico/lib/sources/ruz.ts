import { runCheck, statusFromFindings } from "../check";
import { cached, fold, getJson } from "../http";
import type { CheckResult, Ctx, Finding } from "../types";

const BASE = "https://www.registeruz.sk/cruz-public/api";

interface Metrics {
  period: string;
  totalAssets?: number;
  equity?: number;
  liabilities?: number;
  revenue?: number;
  profit?: number;
}

const txt = (v: any): string => (typeof v === "string" ? v : v?.sk || v?.text || "");
const num = (v: any): number | undefined => {
  if (v === "" || v === null || v === undefined) return undefined;
  const n = Number(String(v).replace(/\s/g, "").replace(",", "."));
  return Number.isFinite(n) ? n : undefined;
};

async function template(id: number) {
  return cached(`ruz-sablona-${id}`, 24 * 3600e3, () => getJson(`${BASE}/sablona?id=${id}`));
}

/** Vytiahne kľúčové ukazovatele z výkazu podľa textu riadkov šablóny (bez natvrdo zadaných čísel riadkov). */
async function extract(vykaz: any): Promise<{ cur: Partial<Metrics>; prev: Partial<Metrics> } | null> {
  const tabs = vykaz?.obsah?.tabulky;
  if (!Array.isArray(tabs) || tabs.length === 0 || !vykaz.idSablony) return null;
  const tpl = await template(vykaz.idSablony);
  const cur: Partial<Metrics> = {};
  const prev: Partial<Metrics> = {};

  tabs.forEach((tab: any, ti: number) => {
    const tt = tpl?.tabulky?.[ti];
    const rows: any[] = tt?.riadky || [];
    const data: any[] = tab?.data || [];
    if (!rows.length || !data.length) return;
    const cols = Number(tt?.pocetDatovychStlpcov) || Math.round(data.length / rows.length);
    if (cols < 1) return;
    const ci = cols >= 4 ? 2 : 0; // Aktíva: Brutto | Korekcia | Netto bežné | Netto predch.
    const pi = cols >= 4 ? 3 : 1;
    const tname = fold(txt(tab.nazov) || txt(tt?.nazov));
    const val = (ri: number, c: number) => num(data[ri * cols + c]);
    const find = (re: RegExp) => rows.findIndex((r) => re.test(fold(txt(r.text))));
    const put = (key: keyof Metrics, ri: number) => {
      if (ri < 0) return;
      const a = val(ri, ci), b = val(ri, pi);
      if (a !== undefined && cur[key] === undefined) (cur as any)[key] = a;
      if (b !== undefined && prev[key] === undefined) (prev as any)[key] = b;
    };

    if (tname.includes("aktiv")) put("totalAssets", find(/^spolu majetok/));
    if (tname.includes("pasiv")) {
      put("equity", find(/^vlastne imanie/));
      put("liabilities", find(/^zavazky/));
      put("profit", find(/^vysledok hospodarenia za uctovne obdobie/));
    }
    if (tname.includes("ziskov") || tname.includes("vysledovk")) {
      let ri = find(/^cisty obrat/);
      if (ri < 0) ri = find(/^trzby/);
      put("revenue", ri);
      // posledný riadok „Výsledok hospodárenia za účtovné obdobie (po zdanení)“
      let pr = -1;
      rows.forEach((r, i) => {
        if (/vysledok hospodarenia za uctovne obdobie/.test(fold(txt(r.text)))) pr = i;
      });
      put("profit", pr);
    }
  });
  return { cur, prev };
}

async function pool<T, R>(items: T[], n: number, fn: (x: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(n, items.length) }, async () => {
      while (i < items.length) {
        const k = i++;
        out[k] = await fn(items[k]);
      }
    }),
  );
  return out;
}

const eur = (n?: number) => (n === undefined ? "–" : `${Math.round(n).toLocaleString("sk-SK")} €`);

/**
 * Povinnosť uložiť závierku sa posudzuje len za obdobia, ktorých lehota už uplynula („splatné obdobia“).
 * - Závierka za rok N sa ukladá do 30. 6. roku N+1, pri predĺženej lehote na daňové priznanie do 30. 9. – preto sa
 *   do septembra vrátane očakáva závierka až za rok N-2, od októbra za rok N-1 (`expected`).
 * - Prvé účtovné obdobie: rok vzniku; ak spoločnosť vznikla v októbri až decembri, môže ho predĺžiť do konca
 *   nasledujúceho roka (§ 3 ods. 4 zákona o účtovníctve) – v prospech spoločnosti sa preto prvé obdobie posúva o rok.
 * Mladá spoločnosť, ktorá ešte nemusela podať žiadnu závierku, nedostane za chýbajúce závierky žiadnu zrážku
 * (odpočíta sa len vek v kontrole obchodného registra).
 */
export function filingStatus(o: { expected: number; latest: number; established?: string }): { duePeriods: number; firstDue?: number; missing: number } {
  if (!o.established) return { duePeriods: o.latest ? Math.max(1, o.expected - o.latest + 1) : 0, missing: o.latest ? Math.max(0, o.expected - o.latest) : 0 };
  const y = Number(o.established.slice(0, 4));
  const m = Number(o.established.slice(5, 7) || "1");
  const firstDue = m >= 10 ? y + 1 : y;
  const duePeriods = Math.max(0, o.expected - firstDue + 1);
  if (!duePeriods) return { duePeriods: 0, firstDue, missing: 0 };
  const missing = o.latest ? Math.min(duePeriods, Math.max(0, o.expected - o.latest)) : duePeriods;
  return { duePeriods, firstDue, missing };
}

export async function checkRuz(ctx: Ctx): Promise<CheckResult> {
  return runCheck(
    {
      id: "ruz",
      category: "financials",
      name: "Register účtovných závierok",
      source: "Ministerstvo financií SR – registeruz.sk",
      sourceUrl: "https://www.registeruz.sk",
    },
    async () => {
      let list: { id: number[] };
      try {
        list = await getJson<{ id: number[] }>(`${BASE}/uctovne-jednotky?zmenene-od=2000-01-01&ico=${ctx.ico}`);
      } catch (e) {
        ctx.resolveDic?.();
        throw e;
      }
      if (!list.id?.length) ctx.resolveDic?.();
      const verifyUrl = `https://www.registeruz.sk/cruz-public/domain/accountingentity/simplesearch?ico=${ctx.ico}`;
      if (!list.id?.length) {
        const f: Finding[] = [];
        await ctx.rpoDone;
        const age = ctx.profile.established ? (Date.now() - +new Date(ctx.profile.established)) / 31557600000 : 0;
        if (age > 2 && /spolo[cč]nos[tť]|dru[zž]stvo/i.test(ctx.profile.legalForm || ""))
          f.push({ severity: "warning", text: "Obchodná spoločnosť nie je evidovaná v Registri účtovných závierok", penalty: 12 });
        return { status: statusFromFindings(f, "info"), summary: "Subjekt nemá v RÚZ žiadne záznamy.", findings: f, verifyUrl };
      }
      const uj = await getJson<any>(`${BASE}/uctovna-jednotka?id=${list.id[list.id.length - 1]}`).finally(() => ctx.resolveDic?.());
      if (uj.dic && !ctx.profile.dic) ctx.profile.dic = uj.dic;
      ctx.resolveDic?.();
      // stačí posledných ~6 závierok (ID rastú s časom) – rýchlejšie ako sťahovať celú históriu
      uj.idUctovnychZavierok = [...(uj.idUctovnychZavierok || [])].sort((a: number, b: number) => b - a).slice(0, 6);

      const zav = (
        await pool(uj.idUctovnychZavierok || [], 6, (id: number) =>
          getJson<any>(`${BASE}/uctovna-zavierka?id=${id}`).catch(() => null),
        )
      ).filter((z) => z && z.datumZostaveniaK && !z.stav);
      // Len riadne/mimoriadne závierky za celé obdobie (nie priebežné)
      const full = zav.filter((z) => z.typ !== "Priebežná").sort((a, b) => (a.datumZostaveniaK < b.datumZostaveniaK ? 1 : -1));
      const years = [...new Set(full.map((z) => z.datumZostaveniaK.slice(0, 4)))];

      // Posledná závierka so štruktúrovanými dátami
      let metrics: Metrics[] = [];
      let pdfOnly = false;
      for (const z of full.slice(0, 3)) {
        for (const vid of z.idUctovnychVykazov || []) {
          const v = await getJson<any>(`${BASE}/uctovny-vykaz?id=${vid}`).catch(() => null);
          if (!v) continue;
          const m = await extract(v).catch(() => null);
          if (m && Object.keys(m.cur).length) {
            const y = Number(z.datumZostaveniaK.slice(0, 4));
            metrics = [{ period: String(y), ...m.cur }, { period: String(y - 1), ...m.prev }];
            break;
          } else if (v.prilohy?.length) pdfOnly = true;
        }
        if (metrics.length) break;
      }

      const f: Finding[] = [];
      await ctx.rpoDone;
      const now = new Date();
      // Závierka za rok N sa podáva do 30.6. (resp. 30.9. pri predĺžení) roku N+1
      const expected = now.getFullYear() - (now.getMonth() >= 9 ? 1 : 2);
      const latest = Number(years[0] || 0);
      const fs = filingStatus({ expected, latest, established: ctx.profile.established });
      if (fs.missing >= 2)
        f.push({
          severity: "critical",
          text: `Účtovná závierka nie je uložená za ${fs.missing} po sebe idúce účtovné obdobia${latest ? ` (posledná za rok ${latest})` : ` (žiadna závierka od vzniku, prvé splatné obdobie ${fs.firstDue})`} – nesplnenie povinnosti za dve a viac období je dôvodom na zrušenie spoločnosti súdom (§ 68b ods. 1 písm. c) Obchodného zákonníka)`,
          penalty: 40,
        });
      else if (fs.missing === 1)
        f.push({ severity: "warning", text: latest ? `Posledná uložená závierka je za rok ${latest} – chýba závierka za ${expected}` : `Chýba prvá účtovná závierka (za rok ${expected})`, penalty: 12 });
      // fs.missing === 0: buď je všetko uložené, alebo spoločnosť ešte nemusela podať – bez zrážky

      const [c, p] = metrics;
      if (c) {
        if (c.equity !== undefined && c.equity < 0)
          f.push({ severity: "critical", text: `Záporné vlastné imanie ${eur(c.equity)} (${c.period})`, penalty: 30 });
        else if (c.equity !== undefined && c.liabilities && c.liabilities > 0 && c.equity / c.liabilities < 0.08)
          f.push({ severity: "warning", text: `Spoločnosť v kríze podľa § 67a ObZ – pomer VI/záväzky ${(c.equity / c.liabilities).toFixed(3)} < 0,08 (${c.period})`, penalty: 18 });
        if (c.profit !== undefined && c.profit < 0) {
          const two = p?.profit !== undefined && p.profit < 0;
          f.push({ severity: "warning", text: `Strata ${eur(c.profit)} za ${c.period}${two ? " – strata aj v predchádzajúcom roku" : ""}`, penalty: two ? 10 : 5 });
        }
        if (c.revenue !== undefined && p?.revenue && p.revenue > 0 && c.revenue < p.revenue * 0.5)
          f.push({ severity: "warning", text: `Pokles tržieb o ${Math.round((1 - c.revenue / p.revenue) * 100)} % medziročne`, penalty: 6 });
        if ((c.profit ?? 0) > 0 && (c.equity ?? 0) > 0)
          f.push({ severity: "positive", text: `Zisk ${eur(c.profit)} a kladné vlastné imanie ${eur(c.equity)} (${c.period})`, penalty: -4 });
      }

      return {
        status: statusFromFindings(f, "ok"),
        summary: c
          ? `Závierky za roky: ${years.slice(0, 6).join(", ") || "–"}. ${c.period}: tržby ${eur(c.revenue)}, VH ${eur(c.profit)}, VI ${eur(c.equity)}, záväzky ${eur(c.liabilities)}.`
          : `Závierky za roky: ${years.slice(0, 6).join(", ") || "žiadne"}.${pdfOnly ? " Posledná závierka je len v PDF (napr. IFRS) – čísla overte v dokumente." : ""}`,
        findings: f,
        verifyUrl,
        data: {
          years,
          metrics,
          dic: uj.dic,
          skNace: uj.skNace,
          size: uj.velkostOrganizacie,
          pdfOnly,
          expectedYear: expected,
          lastFiledYear: latest || undefined,
          lastFiledOn: full[0]?.datumPodania,
          filedExpected: latest >= expected,
          duePeriods: fs.duePeriods,
          firstDuePeriod: fs.firstDue,
          missingPeriods: fs.missing,
          dissolutionRisk: fs.missing >= 2,
        },
      };
    },
  );
}
