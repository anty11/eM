import { runCheck, statusFromFindings } from "../check";
import { fold, getJson } from "../http";
import { kv } from "../auth/kv";
import { isLegalEntity } from "../names";
import { sq } from "../searchlog";
import { classifyLegalFact, personIdent, RPO_BASE } from "./rpo";
import { spDebtorByIco } from "./socpoist";
import { taxDebtorQuick } from "./fs";
import { vatHistory } from "./fsexports";
import type { CheckResult, Ctx, Finding, Person, SearchLog, SearchQuery } from "../types";

/**
 * Prepojenia osôb – ďalšie firmy štatutárov a spoločníkov (fyzických osôb) preverovaného subjektu.
 *
 * Zdroj: API Registra právnických osôb (ŠÚ SR) – vyhľadávanie podľa mena a priezviska osoby v štatutárnom orgáne
 * (`statutoryBodyGivenName` / `statutoryBodyFamilyName`) a medzi spoločníkmi (`stakeholderPersonGivenName` / `…FamilyName`);
 * dokumentácia https://rpo.minv.sk/rpo-api-doc.html (fulltext bez diakritiky, najviac 500 záznamov). Pri každej nájdenej firme sa
 * načíta výpis s históriou a overí sa, že je v nej zapísaná TÁ ISTÁ osoba: meno + priezvisko a bydlisko (obec) zhodné so zápisom
 * v preverovanom subjekte – menovci s iným bydliskom sa vylúčia. Ak register bydlisko neuvádza, firma sa uvedie len ako
 * „zhoda podľa mena“ bez vplyvu na skóre.
 *
 * Hodnotí sa pri každej prepojenej firme: zánik / výmaz, likvidácia, konkurz či reštrukturalizácia (obchodné meno, „ďalšie právne
 * skutočnosti“), dlh voči Sociálnej poisťovni (uložený index SP), zrušená registrácia DPH (denný index exportov FS) a zoznam daňových
 * dlžníkov (OpenData FS, jeden dopyt podľa názvu). Konkurz, likvidácia a dlhy v iných firmách osoby sú upozornenie – nie nález
 * o samotnom subjekte, ale indikátor rizika (osoba za sebou necháva firmy s dlhmi / v konkurze). Viac zaniknutých firiem za 5 rokov
 * je upozornenie na „sériové“ zakladanie a rušenie.
 */

const MAX_PERSONS = 6;
const MAX_DETAILS_PER_PERSON = 8;
const MAX_DETAILS_TOTAL = 16;
/** rozpočet času na vyhľadávanie a výpisy (limit zdroja v preverení je 45 s, RPO naň čaká až 25 s) */
const BUDGET_MS = 17000;

export interface LinkedCompany {
  ico: string;
  name: string;
  /** funkcia osoby v tejto firme (konateľ, spoločník…) a obdobie */
  role: string;
  since?: string;
  until?: string;
  /** osoba je v tejto firme zapísaná aktuálne (nie historicky) */
  currentRole: boolean;
  established?: string;
  terminated?: string;
  /** zhoda osoby overená aj podľa bydliska (inak len podľa mena) */
  verified: boolean;
  /** zistenia o tejto firme (konkurz, likvidácia, dlh SP, zrušená DPH, daňový dlžník, zánik) */
  flags: string[];
  /** rizikové zistenie (vstupuje do hodnotenia) */
  risky: boolean;
}

export interface PersonLink {
  name: string;
  role: string;
  /** počet záznamov, ktoré RPO na meno vrátilo (vrátane menovcov a samotného subjektu) */
  returned: number;
  /** koľko výpisov sa načítalo (ostatné sa pre limit nepreverili) */
  examined: number;
  /** vylúčení menovci (iné bydlisko) */
  excluded: number;
  companies: LinkedCompany[];
  error?: string;
}

const TITLE_RE = /^(ing|mgr|judr|mudr|phdr|rndr|bc|doc|prof|paeddr|mvdr|pharmdr|dr|dis|mba|phd|csc|llm|msc|arch|akad|art|ba|ma|drsc|thdr|rsdr|dipl)\.?,?$/i;

/** Meno a priezvisko na dopyt: z RPO (givenNames / familyNames), inak z celého mena bez titulov (prvé slovo = meno, posledné = priezvisko). */
export function nameParts(p: Person): { given: string; family: string } | null {
  if (p.given && p.family) return { given: p.given.split(/\s+/)[0], family: p.family.split(/\s+/).pop()! };
  const words = (p.name || "").replace(/,.*$/, "").split(/\s+/).filter((w) => w && !TITLE_RE.test(w));
  if (words.length < 2) return null;
  return { given: words[0], family: words[words.length - 1] };
}

/** Obec z bydliska („Hlavná 1, Bratislava - mestská časť Ružinov“ → „bratislava“) – na porovnanie zápisov tej istej osoby. */
const town = (residence?: string) => {
  if (!residence) return "";
  const last = residence.split(",").pop() || residence;
  return fold(last).replace(/\s*-\s*mestsk[aá] [cč]as[tť].*$/, "").replace(/\s+\d+.*$/, "").trim();
};

const hasToken = (hay: string | undefined, needle: string) => fold(hay || "").split(/[\s,.-]+/).includes(fold(needle));

/** Zápisy osoby s daným menom vo výpise inej firmy (štatutárny orgán aj spoločníci), s funkciou a obdobím. */
function matchesIn(entity: any, given: string, family: string) {
  const rows: { role: string; since?: string; until?: string; residence?: string }[] = [];
  for (const s of entity.statutoryBodies || []) {
    const pn = s.personName;
    if (!pn) continue;
    const name = pn.formatedName || [pn.givenNames, pn.familyNames].flat().filter(Boolean).join(" ");
    if ((hasToken((pn.familyNames || []).join(" "), family) || hasToken(name, family)) && (hasToken((pn.givenNames || []).join(" "), given) || hasToken(name, given)))
      rows.push({ role: s.statutoryBodyMember?.value || s.stakeholderType?.value || "štatutár", since: s.validFrom, until: s.validTo, residence: personIdent(s).residence });
  }
  for (const s of entity.stakeholders || []) {
    const pn = s.personName;
    if (!pn) continue;
    const t = fold(s.stakeholderType?.value || "");
    if (/dozor|kontrol/.test(t)) continue;
    const name = pn.formatedName || [pn.givenNames, pn.familyNames].flat().filter(Boolean).join(" ");
    if ((hasToken((pn.familyNames || []).join(" "), family) || hasToken(name, family)) && (hasToken((pn.givenNames || []).join(" "), given) || hasToken(name, given)))
      rows.push({ role: s.stakeholderType?.value || "spoločník", since: s.validFrom, until: s.validTo, residence: personIdent(s).residence });
  }
  return rows;
}

type Slim = { id: number; ico?: string; name?: string; establishment?: string; termination?: string; facts: string[]; statutoryBodies: any[]; stakeholders: any[] };

/** Výpis firmy z RPO (s históriou), odľahčený a uložený na deň – opakované preverenia tej istej osoby register nezaťažujú. */
async function entityDetail(id: number, timeoutMs: number): Promise<Slim> {
  const key = `rpo:slim:${id}`;
  const hit = await kv().get<Slim>(key).catch(() => null);
  if (hit) return hit;
  const e: any = await getJson(`${RPO_BASE}/entity/${id}?showHistoricalData=true&showOrganizationUnits=false`, { timeoutMs });
  const cur = (a?: any[]): any[] => (a || []).filter((x) => !x?.validTo);
  const names = e.fullNames || [];
  const slim: Slim = {
    id,
    ico: (cur(e.identifiers)[0] || e.identifiers?.[0])?.value,
    name: cur(names)[0]?.value || names[names.length - 1]?.value,
    establishment: e.establishment,
    termination: e.termination,
    facts: cur(e.otherLegalFacts).map((x: any) => String(x.value || "")).slice(0, 20),
    statutoryBodies: (e.statutoryBodies || []).map((s: any) => ({ personName: s.personName, statutoryBodyMember: s.statutoryBodyMember, stakeholderType: s.stakeholderType, validFrom: s.validFrom, validTo: s.validTo, address: s.address })),
    stakeholders: (e.stakeholders || []).map((s: any) => ({ personName: s.personName, stakeholderType: s.stakeholderType, validFrom: s.validFrom, validTo: s.validTo, address: s.address })),
  };
  await kv().set(key, slim, 86400).catch(() => undefined);
  return slim;
}

/** Osoby na preverenie: aktuálni štatutári, spoločníci – fyzické osoby, potom bývalí štatutári (≤ 3 roky); bez duplicít, najviac 6. */
export function personsToCheck(ctx: Ctx): (Person & { kind: string })[] {
  const p = ctx.profile;
  const out: (Person & { kind: string })[] = [];
  const seen = new Set<string>();
  const add = (x: Person | undefined, kind: string) => {
    if (!x?.name || x.entity || isLegalEntity(x.name) || !nameParts(x)) return;
    const k = fold(x.name).replace(/[^a-z ]/g, "").trim();
    if (seen.has(k)) return;
    seen.add(k);
    out.push({ ...x, kind });
  };
  for (const s of p.statutory || []) add(s, "štatutár");
  for (const o of p.owners || []) add(o, "spoločník");
  for (const f of p.formerStatutory || []) add(f, "bývalý štatutár");
  return out.slice(0, MAX_PERSONS);
}

const yearsAgo = (d?: string) => (d ? (Date.now() - +new Date(d)) / (365.25 * 864e5) : NaN);
const fmtD = (iso?: string) => (iso ? new Date(iso).toLocaleDateString("sk-SK", { day: "numeric", month: "numeric", year: "numeric" }) : "");

/** Zistenia o jednej prepojenej firme z jej výpisu a rýchlych indexov. */
async function flagsFor(c: Slim, timeLeft: number): Promise<{ flags: string[]; risky: boolean; kinds: Set<string> }> {
  const flags: string[] = [];
  const kinds = new Set<string>();
  const lname = fold(c.name || "");
  if (c.termination) {
    flags.push(`zanikla ${fmtD(c.termination)}`);
    kinds.add("terminated");
  }
  if (lname.includes("v konkurze") || c.facts.some((t) => /konkurz/i.test(t) && classifyLegalFact(t) === "proceeding")) {
    flags.push("konkurz");
    kinds.add("insolvency");
  }
  if (lname.includes("v restrukturalizacii") || c.facts.some((t) => /re[sš]truktur/i.test(t) && classifyLegalFact(t) === "proceeding")) {
    flags.push("reštrukturalizácia");
    kinds.add("insolvency");
  }
  // likvidácia / konanie o zrušení je riziko len pri existujúcej firme; firma zrušená likvidáciou a vymazaná je riadne ukončená
  if (!c.termination && (lname.includes("v likvidacii") || c.facts.some((t) => classifyLegalFact(t) === "dissolution"))) {
    flags.push("v likvidácii alebo v konaní o zrušení");
    kinds.add("dissolution");
  }
  if (c.facts.some((t) => /exek/i.test(t) && classifyLegalFact(t) === "proceeding")) {
    flags.push("exekúcia v zápise registra");
    kinds.add("execution");
  }
  // rýchle indexy (Redis) a jeden dopyt FS – len pri existujúcich firmách a ak je čas
  if (c.ico && !c.termination && timeLeft > 1500) {
    const withTimeout = <T>(p: Promise<T>, ms: number): Promise<T | undefined> => Promise.race([p, new Promise<undefined>((r) => setTimeout(() => r(undefined), ms))]);
    const ms = Math.min(8000, timeLeft - 500);
    const [sp, vat, tax] = await Promise.all([
      withTimeout(spDebtorByIco(c.ico).catch(() => undefined), ms),
      withTimeout(vatHistory(c.ico).catch((): Awaited<ReturnType<typeof vatHistory>> => ({ meta: null })), ms),
      withTimeout(taxDebtorQuick(c.ico, c.name || "").catch(() => undefined), ms),
    ]);
    if (sp) {
      flags.push(`dlžník Sociálnej poisťovne${sp.amount ? ` (${/€/.test(sp.amount) ? sp.amount : `${sp.amount} €`})` : ""}`);
      kinds.add("debt");
    }
    if (vat?.gone && !vat.current) {
      flags.push(`zrušená registrácia DPH (${vat.gone.firstMissing ? `od ${fmtD(vat.gone.firstMissing)}` : "podľa denného indexu FS"})`);
      kinds.add("vat");
    }
    if (tax) {
      flags.push(`daňový dlžník${tax.amount ? ` (${tax.amount} €)` : ""}`);
      kinds.add("debt");
    }
  }
  return { flags, risky: kinds.size > 0 && !(kinds.size === 1 && kinds.has("terminated")), kinds };
}

export async function checkPersons(ctx: Ctx): Promise<CheckResult> {
  return runCheck(
    {
      id: "persons",
      category: "register",
      name: "Prepojenia osôb – ďalšie firmy štatutárov a spoločníkov",
      source: "Štatistický úrad SR – RPO (vyhľadávanie podľa osoby), indexy SP a FS",
      sourceUrl: "https://rpo.statistics.sk",
    },
    async () => {
      await ctx.rpoDone;
      const t0 = Date.now();
      const left = () => BUDGET_MS - (Date.now() - t0);
      const persons = personsToCheck(ctx);
      const first = persons[0] ? nameParts(persons[0]) : null;
      const verifyUrl = first ? `https://www.orsr.sk/hladaj_osoba.asp?PR=${encodeURIComponent(first.family)}&MENO=${encodeURIComponent(first.given)}&SID=0&T=f0&R=on` : "https://www.orsr.sk/hladaj_osoba.asp";
      if (!persons.length) {
        return {
          status: "info",
          summary: ctx.profile.name
            ? "V registri nie je zapísaná žiadna fyzická osoba (štatutár ani spoločník), ktorej ďalšie firmy by sa dali preveriť."
            : "Identifikácia subjektu neprebehla – osoby na preverenie nie sú známe.",
          findings: [],
          verifyUrl,
          search: [{ dataset: "Register právnických osôb (API RPO) – vyhľadávanie podľa osoby", queries: [], rule: "firmy, v ktorých je zapísaná tá istá osoba (meno, priezvisko a bydlisko)" }],
          data: { persons: [], definitive: Boolean(ctx.profile.name) },
        };
      }

      const links: PersonLink[] = [];
      const queries: SearchQuery[] = [];
      let detailsUsed = 0;
      // Vyhľadávania (2 na osobu) súbežne
      const searched = await Promise.all(
        persons.map(async (p) => {
          const np = nameParts(p)!;
          const q = (what: string) => `${RPO_BASE}/search?${what}GivenName=${encodeURIComponent(np.given)}&${what}FamilyName=${encodeURIComponent(np.family)}`;
          const urls = [q("statutoryBody"), q("stakeholderPerson")];
          const res = await Promise.all(urls.map((u) => getJson<{ results?: any[] }>(u, { timeoutMs: Math.max(3000, Math.min(12000, left())) }).then((r) => ({ u, rows: r.results || [] }), (e: Error) => ({ u, rows: null as any[] | null, error: e.message }))));
          const byId = new Map<number, any>();
          for (const r of res) for (const row of r.rows || []) if (row?.id) byId.set(row.id, row);
          for (const r of res)
            queries.push(sq(`${p.kind} – meno a priezvisko`, `${np.given} ${np.family}`, r.rows ? r.rows.length : null, 0, r.u, r.rows ? (/statutoryBody/.test(r.u) ? "v štatutárnom orgáne" : "medzi spoločníkmi") : `chyba: ${(r as any).error}`));
          return { p, np, rows: [...byId.values()], error: res.every((r) => !r.rows) ? (res[0] as any).error : undefined };
        }),
      );

      // Výpisy – najprv existujúce firmy, potom zaniknuté (najnovšie), v rámci limitu počtu a času; súbežne po 4
      for (const s of searched) {
        const link: PersonLink = { name: s.p.name, role: s.p.kind, returned: s.rows.length, examined: 0, excluded: 0, companies: [], error: s.error };
        links.push(link);
        const own = (row: any) => (row.identifiers || []).some((i: any) => String(i.value) === ctx.ico);
        const candidates = s.rows
          .filter((r) => !own(r))
          .sort((a, b) => (a.termination ? 1 : 0) - (b.termination ? 1 : 0) || String(b.establishment || "").localeCompare(String(a.establishment || "")))
          .slice(0, Math.min(MAX_DETAILS_PER_PERSON, Math.max(0, MAX_DETAILS_TOTAL - detailsUsed)));
        const myTown = town(s.p.residence);
        const queue = [...candidates];
        const worker = async () => {
          while (queue.length && left() > 2500) {
            const row = queue.shift()!;
            detailsUsed++;
            let d: Slim;
            try {
              d = await entityDetail(row.id, Math.max(2000, Math.min(10000, left() - 500)));
            } catch {
              continue;
            }
            link.examined++;
            const rows = matchesIn(d, s.np.given, s.np.family);
            if (!rows.length) continue; // meno sa zhodovalo len čiastočne (fulltext)
            const theirTowns = rows.map((r) => town(r.residence)).filter(Boolean);
            const verified = Boolean(myTown) && theirTowns.length > 0 && theirTowns.some((t) => t === myTown);
            if (myTown && theirTowns.length && !verified) {
              link.excluded++;
              continue; // menovec s iným bydliskom
            }
            const current = rows.find((r) => !r.until) || rows[0];
            const { flags, risky } = await flagsFor(d, left());
            link.companies.push({
              ico: d.ico || "",
              name: d.name || `RPO ${d.id}`,
              role: current.role,
              since: current.since,
              until: current.until,
              currentRole: rows.some((r) => !r.until),
              established: d.establishment,
              terminated: d.termination,
              verified,
              flags,
              risky: risky && verified,
            });
          }
        };
        await Promise.all([worker(), worker(), worker(), worker()]);
        link.companies.sort((a, b) => Number(b.risky) - Number(a.risky) || Number(b.currentRole) - Number(a.currentRole));
        for (const q of queries) if (q.value === `${s.np.given} ${s.np.family}`) q.matched = link.companies.length;
      }

      // Hodnotenie
      const f: Finding[] = [];
      const all = links.flatMap((l) => l.companies.map((c) => ({ ...c, person: l.name })));
      const uniq = all.filter((c, i, arr) => arr.findIndex((x) => x.ico === c.ico) === i);
      const verified = uniq.filter((c) => c.verified);
      const unverified = uniq.filter((c) => !c.verified);
      const risky = verified.filter((c) => c.risky);
      const ins = risky.filter((c) => c.flags.some((x) => /konkurz|re[sš]truktur/.test(x)));
      const diss = risky.filter((c) => c.flags.some((x) => /likvid|zru[sš]en/.test(x)) && !ins.includes(c));
      const debt = risky.filter((c) => c.flags.some((x) => /dl[zž]n[ií]k/.test(x)));
      const vat = risky.filter((c) => c.flags.some((x) => /DPH/.test(x)));
      const who = (c: LinkedCompany & { person: string }) => `${c.name}${c.ico ? ` (IČO ${c.ico})` : ""} – ${c.person}, ${c.role}${c.until ? ` do ${fmtD(c.until)}` : ""}`;
      ins.slice(0, 3).forEach((c, i) => f.push({ severity: "warning", text: `Iná firma osoby v konkurze / reštrukturalizácii: ${who(c)}${c.terminated ? `, zanikla ${fmtD(c.terminated)}` : ""}`, penalty: i === 0 ? 12 : 5 }));
      diss.slice(0, 3).forEach((c, i) => f.push({ severity: "warning", text: `Iná firma osoby v likvidácii / konaní o zrušení: ${who(c)}`, penalty: i === 0 ? 8 : 3 }));
      debt.slice(0, 3).forEach((c, i) => f.push({ severity: "warning", text: `Iná firma osoby s dlhom: ${who(c)} – ${c.flags.filter((x) => /dl[zž]n[ií]k/.test(x)).join(", ")}`, penalty: i === 0 ? 10 : 4 }));
      vat.filter((c) => !debt.includes(c)).slice(0, 2).forEach((c, i) => f.push({ severity: "warning", text: `Inej firme osoby bola zrušená registrácia DPH: ${who(c)} – ${c.flags.find((x) => /DPH/.test(x))}`, penalty: i === 0 ? 8 : 3 }));
      risky.filter((c) => c.flags.some((x) => /exek/.test(x)) && !ins.includes(c) && !debt.includes(c)).slice(0, 2).forEach((c, i) => f.push({ severity: "warning", text: `Iná firma osoby s exekúciou v zápise registra: ${who(c)}`, penalty: i === 0 ? 6 : 2 }));
      const terminated5y = verified.filter((c) => c.terminated && yearsAgo(c.terminated) < 5);
      if (terminated5y.length >= 3)
        f.push({ severity: "warning", text: `Osoby za sebou nechávajú firmy: ${terminated5y.length} firmy štatutárov / spoločníkov zanikli za posledných 5 rokov (${terminated5y.slice(0, 4).map((c) => c.name).join(", ")}) – indikátor „sériového“ zakladania a rušenia spoločností`, penalty: 8 });
      else if (terminated5y.length) f.push({ severity: "info", text: `Zaniknuté firmy osôb za posledných 5 rokov: ${terminated5y.map((c) => `${c.name} (${fmtD(c.terminated)})`).join(", ")}`, penalty: 0 });
      const active = verified.filter((c) => !c.terminated && c.currentRole);
      if (active.length >= 5) f.push({ severity: "info", text: `Osoby figurujú aktuálne v ${active.length} ďalších firmách – overte kapacitu a prepojenia (spoločné sídlo, vzájomné obchody)`, penalty: 0 });
      for (const c of unverified.filter((x) => x.flags.length && !(x.flags.length === 1 && x.terminated)).slice(0, 4))
        f.push({ severity: "info", text: `Zhoda len podľa mena (bydlisko sa nedalo porovnať): ${who(c)} – ${c.flags.join(", ")}; overte, či ide o tú istú osobu`, penalty: 0 });
      const overflow = links.filter((l) => l.returned - 1 > l.examined + l.excluded && l.returned > MAX_DETAILS_PER_PERSON);
      if (overflow.length) f.push({ severity: "info", text: `Pri ${overflow.map((l) => l.name).join(", ")} register vrátil viac záznamov (${overflow.map((l) => l.returned).join(", ")}), než sa stihlo preveriť – bežné meno; ďalšie firmy overte v Obchodnom registri (hľadanie podľa osoby)`, penalty: 0 });
      if (ctx.asOf) f.push({ severity: "info", text: `Spätné preverenie: prepojenia osôb sú podľa dnešného stavu registrov (k ${ctx.asOf} sa história zápisov iných firiem nerekonštruuje)`, penalty: 0 });
      const failed = links.filter((l) => l.error);
      if (failed.length) f.push({ severity: "info", text: `Vyhľadávanie v RPO zlyhalo pri: ${failed.map((l) => `${l.name} (${l.error})`).join("; ")}`, penalty: 0 });

      const search: SearchLog[] = [
        {
          dataset: "Register právnických osôb (Štatistický úrad SR, API RPO) – vyhľadávanie podľa osoby",
          queries,
          rule: "firma, v ktorej je zapísaná tá istá osoba: meno a priezvisko vo výpise a rovnaká obec bydliska ako v zápise preverovaného subjektu (menovci s iným bydliskom vylúčení); zisťuje sa zánik, likvidácia, konkurz, exekúcia v zápise, dlh SP, daňový dlh a zrušená DPH",
        },
      ];
      if (failed.length === links.length) throw Object.assign(new Error(`vyhľadávanie osôb v RPO zlyhalo (${failed[0].error})`), { search });
      const status = statusFromFindings(f);
      const n = uniq.length;
      const firmy = (x: number) => (x === 1 ? "firma" : x >= 2 && x <= 4 ? "firmy" : "firiem");
      const summary = `${persons.length} ${persons.length === 1 ? "osoba" : persons.length <= 4 ? "osoby" : "osôb"} (${persons.map((p) => p.name).join(", ")}): ${n ? `${n} ${firmy(n)} mimo preverovaného subjektu` : "žiadna ďalšia firma"}${n ? ` – ${active.length} s aktuálnou funkciou, ${uniq.filter((c) => c.terminated).length} zaniknutých` : ""}${risky.length ? `; rizikové: ${risky.length} (${[...new Set(risky.flatMap((c) => c.flags))].slice(0, 5).join(", ")})` : n ? "; bez negatívneho záznamu v sledovaných registroch" : ""}${unverified.length ? `; ${unverified.length} len podľa mena` : ""}.`;
      return {
        status,
        summary,
        findings: f,
        verifyUrl,
        search,
        data: { persons: links, definitive: true, examined: detailsUsed },
      };
    },
  );
}
