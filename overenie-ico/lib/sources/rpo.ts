import { runCheck, statusFromFindings } from "../check";
import { riskJurisdiction } from "../deal";
import { fold, getJson } from "../http";
import { orsrIdentify, type OrsrResult } from "./orsr";
import type { CheckResult, Ctx, Finding } from "../types";

const BASE = "https://api.statistics.sk/rpo/v1";

type Valid = { validFrom?: string; validTo?: string; [k: string]: any };
const current = <T extends Valid>(arr?: T[]): T[] => (arr || []).filter((x) => !x.validTo);
/** Položky platné k danému dňu (validFrom ≤ deň < validTo). */
const validAt = <T extends Valid>(arr: T[] | undefined, day: string): T[] => (arr || []).filter((x) => (!x.validFrom || x.validFrom <= day) && (!x.validTo || x.validTo > day));
/**
 * Vyhľadanie v RPO so „zabezpečeným“ (hedged) opakovaním: ak prvá požiadavka neodpovie do 5 s, pošle sa druhá súbežne a použije sa
 * tá, ktorá odpovie skôr (API ŠÚ SR občas jednotlivé požiadavky zdrží). Celkový limit 18 s – predtým 2× 11 s za sebou.
 */
async function hedgedSearch(url: string): Promise<{ results?: any[] }> {
  const one = () => getJson<{ results?: any[] }>(url, { timeoutMs: 18000 });
  return new Promise((resolve, reject) => {
    let pending = 1;
    let done = false;
    let lastErr: unknown;
    const settle = (p: Promise<{ results?: any[] }>) =>
      p.then(
        (v) => {
          if (!done) {
            done = true;
            resolve(v);
          }
        },
        (e) => {
          lastErr = e;
          if (--pending === 0 && !done) reject(lastErr);
        },
      );
    settle(one());
    setTimeout(() => {
      if (done) return;
      pending++;
      settle(one());
    }, 5000);
  });
}

/** Výsledok kontroly z Obchodného registra (orsr.sk), keď RPO neodpovedalo – základná identifikácia bez histórie zmien. */
function fromOrsr(ctx: Ctx, o: OrsrResult, rpoError: string) {
  Object.assign(ctx.profile, {
    name: o.name,
    address: o.address,
    legalForm: o.legalForm,
    established: o.established,
    terminated: o.terminated,
    registrationNumber: o.registrationNumber,
    statutory: o.statutory,
    owners: o.owners,
  });
  const f: Finding[] = [];
  if (o.terminated) f.push({ severity: "critical", text: `Subjekt bol vymazaný z obchodného registra (${o.terminated})`, penalty: 100 });
  if (o.inLiquidation) f.push({ severity: "critical", text: "Spoločnosť je v likvidácii (obchodný register)", penalty: 70 });
  if (/v konkurze/i.test(o.name)) f.push({ severity: "critical", text: "Spoločnosť je v konkurze", penalty: 90 });
  const age = yearsSince(o.established);
  if (age < 1) f.push({ severity: "warning", text: `Veľmi krátka história – subjekt vznikol ${o.established} (menej ako 1 rok)`, penalty: 15 });
  else if (age < 2) f.push({ severity: "warning", text: `Krátka história – subjekt vznikol ${o.established} (menej ako 2 roky)`, penalty: 6 });
  else if (age >= 5) f.push({ severity: "positive", text: `Stabilná história – na trhu od ${o.established?.slice(0, 4)}`, penalty: -3 });
  f.push({ severity: "info", text: `Údaje z Obchodného registra SR (orsr.sk) – Register právnických osôb neodpovedal (${rpoError}); história zmien štatutárov a vlastníkov sa nehodnotila`, penalty: 0 });
  return {
    status: statusFromFindings(f),
    summary: `${o.name}${o.legalForm ? `, ${o.legalForm}` : ""}, zápis ${o.established || "?"}${o.registrationNumber ? `, ${o.registrationNumber}` : ""} – podľa Obchodného registra SR (RPO neodpovedalo včas).`,
    findings: f,
    verifyUrl: o.url,
    data: { via: "orsr", dissolution: Boolean(o.terminated || o.inLiquidation) },
  };
}

const yearsSince = (d?: string) => (d ? (Date.now() - new Date(d).getTime()) / (365.25 * 864e5) : NaN);

/**
 * Zaradenie právnej skutočnosti z registra.
 *  - dissolution: zrušenie / výmaz / likvidácia samotnej spoločnosti (kritické)
 *  - merger: zlúčenie, splynutie, rozdelenie – spoločnosť je právny nástupca; zápis spomína zrušenie ZANIKAJÚCEJ spoločnosti bez likvidácie,
 *    čo pre nástupcu nie je riziko (bežné pri veľkých a. s.) – len informácia
 *  - proceeding: konkurz, exekúcia, reštrukturalizácia v zápise (upozornenie)
 *  - pledge: záložné právo na podiel / akcie – bežný spôsob financovania, len informácia
 */
export function classifyLegalFact(text: string): "dissolution" | "merger" | "proceeding" | "pledge" | null {
  const t = fold(text);
  if (/zrusuje sa .*(prokur|konate)|zanik .*(prokur|funkci)/.test(t)) return null;
  const merger = /zluc|splynut|rozdelen|nastupnic|preber[aá] .*iman|prevzat.* iman|zanikajuc|zmluv[ay] o zluceni|projekt zlucenia|projekt rozdelenia/.test(t);
  const selfDissolution = /spolocnost (sa )?zrusuje|zrusen[ia]e? spolocnosti|rozhodnut\S* o zruseni|vstup\S* do likvidacie|v likvidacii|vstupuje do likvidacie|likvidator|likvidacia spolocnosti|sud .*zrus|konani\S* o zruseni|zacat\S* konani\S* o zruseni|vymaz\S* (z obchodneho registra|spolocnosti)|navrh na vymaz|zrusena bez pravneho nastupcu/.test(t);
  if (selfDissolution && !merger) return "dissolution";
  if (merger) {
    // zlúčenie, pri ktorom je táto spoločnosť zanikajúca: „spoločnosť zaniká zlúčením“ / „bola zrušená ... a zanikla“
    if (/(tato |spolocnost )?zanik[aá] zlucenim|zanikla zlucenim|zanikla splynutim|zanikla rozdelenim|zanikla bez likvidacie/.test(t) && !/nastupnic\S* spolocnost\S* [^.]*(preber|prevz)/.test(t)) return "dissolution";
    return "merger";
  }
  if (selfDissolution) return "dissolution";
  if (/zalozn/.test(t)) return "pledge";
  if (/konkurz|exek[uú]|restrukt/.test(t)) return "proceeding";
  return null;
}

function fmtAddress(a: any): string {
  if (!a) return "";
  const street = [a.street, [a.regNumber || null, a.buildingNumber].filter(Boolean).join("/")].filter(Boolean).join(" ");
  const psc = (a.postalCodes || [])[0] || "";
  return [street, [psc, a.municipality?.value].filter(Boolean).join(" "), a.country?.code !== "703" ? a.country?.value : ""]
    .filter(Boolean)
    .join(", ");
}

/**
 * Register právnických osôb (ŠÚ SR) – preberá údaje z Obchodného registra,
 * Živnostenského registra a ďalších zdrojových registrov.
 */
export async function checkRpo(ctx: Ctx): Promise<CheckResult> {
  const r = await checkRpoInner(ctx);
  // pri chybe odkaz na vyhľadanie podľa IČO v obchodnom registri (úvodná stránka RPO je aplikácia bez predvyplnenia)
  if (r.status === "error") r.verifyUrl = `https://www.orsr.sk/hladaj_ico.asp?ICO=${ctx.ico}&SID=0`;
  return r;
}

async function checkRpoInner(ctx: Ctx): Promise<CheckResult> {
  return runCheck(
    {
      id: "rpo",
      category: "register",
      name: "Obchodný register / Register právnických osôb",
      source: "Štatistický úrad SR – RPO (údaje z ORSR, ŽRSR a i.)",
      sourceUrl: "https://rpo.statistics.sk",
    },
    async () => {
      // RPO občas odpovedá pomaly: zabezpečené opakovanie, a ak do 7 s nič, súbežne záloha z Obchodného registra (orsr.sk)
      const t0 = Date.now();
      let rpoSettled = false;
      let orsrP: Promise<OrsrResult | null> | null = null;
      const startOrsr = () => (orsrP ??= orsrIdentify(ctx.ico, Math.max(4000, Math.min(8000, 22000 - (Date.now() - t0)) / 2)).catch(() => null));
      const searchP = hedgedSearch(`${BASE}/search?identifier=${ctx.ico}`).finally(() => (rpoSettled = true));
      const timer = setTimeout(() => !rpoSettled && startOrsr(), 7000);
      let search: { results?: any[] };
      try {
        // Ak záloha z orsr.sk odpovie a RPO stále mešká, počká sa ešte 3 s (RPO má bohatšie údaje) a potom sa použije záloha
        const ORSR_WON = Symbol("orsr");
        let orsrWon: OrsrResult | null = null;
        const orsrRace = new Promise<typeof ORSR_WON>((resolve) => {
          const poll = setInterval(() => {
            if (rpoSettled) return clearInterval(poll);
            if (!orsrP) return;
            clearInterval(poll);
            orsrP.then((o) => {
              if (!o || rpoSettled) return;
              setTimeout(() => {
                if (!rpoSettled) {
                  orsrWon = o;
                  resolve(ORSR_WON);
                }
              }, 3000);
            });
          }, 250);
        });
        const first = await Promise.race([searchP, orsrRace]);
        clearTimeout(timer);
        if (first === ORSR_WON && orsrWon && !ctx.asOf) {
          searchP.catch(() => undefined);
          return fromOrsr(ctx, orsrWon, "neodpovedal včas");
        }
        search = first as { results?: any[] };
      } catch (err) {
        clearTimeout(timer);
        const o = ctx.asOf ? null : await startOrsr();
        if (o) return fromOrsr(ctx, o, (err as Error).message);
        throw new Error(`${(err as Error).message}${ctx.asOf ? "" : "; záloha z Obchodného registra (orsr.sk) tiež nepomohla"}`);
      }
      const hit = search.results?.[0];
      if (!hit) {
        ctx.profile.notFound = true;
        return {
          status: "critical",
          summary: "Subjekt s týmto IČO sa v Registri právnických osôb nenašiel. Skontrolujte IČO – bez identifikácie subjektu nie je možné pokračovať v ďalších kontrolách.",
          findings: [{ severity: "critical", text: "IČO nie je evidované v Registri právnických osôb", penalty: 100 }],
          verifyUrl: `https://www.orsr.sk/hladaj_ico.asp?ICO=${ctx.ico}&SID=0`,
          data: { notFound: true },
        };
      }
      let e: any = hit;
      try {
        // výpis s históriou – v rámci zvyšku 23 s (limit kontroly je 25 s)
        e = await getJson(`${BASE}/entity/${hit.id}?showHistoricalData=true&showOrganizationUnits=false`, { timeoutMs: Math.max(4000, Math.min(12000, 23000 - (Date.now() - t0))) });
      } catch {
        /* detail nie je nevyhnutný, pokračujeme s výsledkom vyhľadávania */
      }

      const names = e.fullNames || [];
      const name = current(names)[0]?.value || names[names.length - 1]?.value;
      const addr = current(e.addresses)[0] || (e.addresses || [])[0];
      const legalForm = current(e.legalForms)[0]?.value?.value;
      const statutory = current(e.statutoryBodies).map((s: any) => ({
        name: s.personName?.formatedName || s.fullName || s.fullNames?.[0]?.value || [s.personName?.givenNames, s.personName?.familyNames].flat().filter(Boolean).join(" "),
        role: s.statutoryBodyMember?.value || s.stakeholderType?.value || "štatutár",
        since: s.validFrom,
      }));
      const equity = current(e.equities).find((q: any) => typeof q.value === "number")?.value;
      const personName = (s: any) =>
        s.personName?.formatedName || s.fullName || s.fullNames?.[0]?.value || [s.personName?.givenNames, s.personName?.familyNames].flat().filter(Boolean).join(" ");

      // Predmet činnosti (aktuálne položky)
      const activities: string[] = current(e.activities)
        .map((a: any) => String(a.economicActivityDescription || a.value || "").replace(/[,;]\s*$/, "").trim())
        .filter(Boolean);

      // Vlastníci (spoločníci / jediný akcionár / členovia) – bez dozornej rady
      const isOwner = (s: any) => {
        const t = fold(s.stakeholderType?.value || "");
        return /spolocnik|akcionar|clen druzstva|zriadovatel|zakladatel|vlastnik/.test(t) && !/dozor|kontrol/.test(t);
      };
      const ownerRows = (e.stakeholders || []).filter(isOwner);
      const countryOf = (s: any): string | undefined => {
        const a = s.address || (Array.isArray(s.addresses) ? current(s.addresses)[0] || s.addresses[0] : undefined);
        const c = a?.country;
        return c ? String(c.value || c.name || "") : undefined;
      };
      const owners = current(ownerRows).map((s: any) => ({ name: personName(s), role: s.stakeholderType?.value || "spoločník", since: s.validFrom, country: countryOf(s) }));
      /**
       * Skutočné zmeny osôb (nie aktualizácie zápisu): dátum, ku ktorému sa zmenila množina mien.
       * Register zapisuje novú položku aj pri zmene adresy či funkcie tej istej osoby a pri opätovnom zvolení člena orgánu –
       * tie sa ako zmena vlastníka / štatutára nepočítajú.
       */
      const personChanges = (rows: any[]): string[] => {
        const dates = [...new Set(rows.flatMap((x) => [x.validFrom, x.validTo]).filter((d): d is string => Boolean(d) && d !== e.establishment))].sort();
        const setAt = (day: string) => new Set(validAt(rows, day).map((x) => fold(personName(x) || "")).filter(Boolean));
        const out: string[] = [];
        for (const d of dates) {
          const before = setAt(new Date(+new Date(d) - 864e5).toISOString().slice(0, 10));
          const after = setAt(d);
          const changed = [...after].some((n) => !before.has(n)) || [...before].some((n) => !after.has(n));
          if (changed) out.push(d);
        }
        return out;
      };
      const ownerChangeDates = personChanges(ownerRows);
      const statutoryChangeDates = personChanges(e.statutoryBodies || []);
      const lastOwnershipChange = ownerChangeDates[ownerChangeDates.length - 1] || (ownerRows.length ? e.establishment : undefined);
      const lastStatutoryChange = statutoryChangeDates[statutoryChangeDates.length - 1] || ((e.statutoryBodies || []).length ? e.establishment : undefined);

      Object.assign(ctx.profile, {
        name,
        formerNames: names.filter((n: any) => n.validTo).map((n: any) => n.value),
        address: fmtAddress(addr),
        legalForm,
        established: e.establishment,
        terminated: e.termination,
        registrationOffice: current(e.sourceRegister?.registrationOffices)[0]?.value || e.sourceRegister?.registrationOffices?.[0]?.value,
        registrationNumber: current(e.sourceRegister?.registrationNumbers)[0]?.value || e.sourceRegister?.registrationNumbers?.[0]?.value,
        mainActivity: e.statisticalCodes?.mainActivity?.value,
        statutory,
        equity,
        activities,
        owners,
        lastOwnershipChange,
        lastStatutoryChange,
      });

      const f: Finding[] = [];
      const lname = fold(name || "");
      if (e.termination) f.push({ severity: "critical", text: `Subjekt zanikol / bol vymazaný (${e.termination})`, penalty: 100 });
      if (lname.includes("v likvidacii")) f.push({ severity: "critical", text: "Spoločnosť je v likvidácii", penalty: 70 });
      if (lname.includes("v konkurze")) f.push({ severity: "critical", text: "Spoločnosť je v konkurze", penalty: 90 });
      if (lname.includes("v restrukturalizacii")) f.push({ severity: "critical", text: "Spoločnosť je v reštrukturalizácii", penalty: 50 });

      // Právne skutočnosti (zrušenie, výzva súdu, exekúcia na obchodný podiel, zlúčenia, záložné práva)
      const facts: string[] = (e.otherLegalFacts || []).filter((x: any) => !x.validTo).map((x: any) => String(x.value || ""));
      const byKind = (k: ReturnType<typeof classifyLegalFact>) => facts.filter((t) => classifyLegalFact(t) === k);
      const dissolution = byKind("dissolution");
      // kritický postih len raz – ďalšie zápisy o tom istom sa nesčítavajú
      dissolution.slice(0, 2).forEach((t, i) => f.push({ severity: "critical", text: `Konanie o zrušení / výmaze / likvidácii – zápis v registri: ${t.slice(0, 220)}`, penalty: i === 0 ? 60 : 0 }));
      const mergers = byKind("merger");
      if (mergers.length) f.push({ severity: "info", text: `Zlúčenie / splynutie / rozdelenie v registri (${mergers.length}×) – spoločnosť je právnym nástupcom: ${mergers[0].slice(0, 160)}…`, penalty: 0 });
      byKind("proceeding").slice(0, 2).forEach((t, i) => f.push({ severity: "warning", text: `Právna skutočnosť v registri: ${t.slice(0, 220)}`, penalty: i === 0 ? 10 : 5 }));
      const pledges = byKind("pledge");
      if (pledges.length) f.push({ severity: "info", text: `Záložné právo na obchodný podiel / akcie v registri (${pledges.length}×) – bežné pri financovaní, overte pri významnom obchode`, penalty: 0 });

      const age = yearsSince(e.establishment);
      if (age < 1) f.push({ severity: "warning", text: `Veľmi krátka história – subjekt vznikol ${e.establishment} (menej ako 1 rok)`, penalty: 15 });
      else if (age < 2) f.push({ severity: "warning", text: `Krátka história – subjekt vznikol ${e.establishment} (menej ako 2 roky)`, penalty: 6 });
      else if (age >= 5) f.push({ severity: "positive", text: `Stabilná história – na trhu od ${e.establishment?.slice(0, 4)}`, penalty: -3 });

      const recent = (arr: any[] | undefined, years: number) =>
        (arr || []).filter((x) => x.validFrom && yearsSince(x.validFrom) < years && x.validFrom !== e.establishment).length;
      const seatChanges = recent(e.addresses, 3);
      if (seatChanges >= 3) f.push({ severity: "warning", text: `Časté zmeny sídla – ${seatChanges}× za posledné 3 roky`, penalty: 10 });
      const nameChanges = recent(e.fullNames, 3);
      if (nameChanges >= 2) f.push({ severity: "warning", text: `Časté zmeny obchodného mena – ${nameChanges}× za posledné 3 roky`, penalty: 6 });
      // Počítajú sa len skutočné zmeny osôb (nie aktualizácie zápisu či opätovné zvolenie). Pri veľkých orgánoch (predstavenstvo a. s.)
      // sú jednotlivé zmeny členov bežné – hodnotí sa až výmena väčšiny orgánu.
      const within = (dates: string[], years: number) => dates.filter((d) => yearsSince(d) < years).length;
      const statChanges = within(statutoryChangeDates, 2);
      if (statChanges >= Math.max(3, Math.ceil(statutory.length * 0.6))) f.push({ severity: "warning", text: `Časté zmeny štatutárov – ${statChanges} zmien osôb za posledné 2 roky`, penalty: 8 });
      // Indikátor (iv) SKDP 03/2024: časté zmeny vlastníkov a zmena vlastníka alebo štatutára tesne pred obchodom
      const ownerChanges = within(ownerChangeDates, 2);
      if (ownerChanges >= 2) f.push({ severity: "warning", text: `Časté zmeny spoločníkov – ${ownerChanges} zmien za posledné 2 roky (indikátor iv)`, penalty: 8 });
      const daysAgo = (d?: string) => (d ? Math.floor((Date.now() - +new Date(d)) / 86400000) : Infinity);
      const recentOwner = daysAgo(ownerChangeDates[ownerChangeDates.length - 1]);
      const recentStat = daysAgo(statutoryChangeDates[statutoryChangeDates.length - 1]);
      // zmena jedného člena z väčšieho orgánu nie je indikátor – pri orgáne nad 3 členov sa sleduje len zmena vlastníka
      const bigBoard = statutory.length > 3;
      const recentChange = bigBoard ? recentOwner : Math.min(recentOwner, recentStat);
      if (recentChange <= 180 && age >= 1)
        f.push({
          severity: "warning",
          text: `Zmena ${bigBoard || recentOwner <= recentStat ? "vlastníka" : "štatutárneho orgánu"} pred ${recentChange} dňami – zmena tesne pred obchodom je indikátor rizika (iv), overte dôvod a nové osoby`,
          penalty: 10,
        });
      // Indikátor (iii): spoločník so sídlom v jurisdikcii so zvýšeným daňovým rizikom
      for (const o of owners) {
        const j = riskJurisdiction(o.country);
        if (j) f.push({ severity: "warning", text: `Spoločník ${o.name} so sídlom v jurisdikcii so zvýšeným daňovým rizikom (${j}) – indikátor iii`, penalty: 15 });
      }
      if (!e.termination && statutory.length === 0 && /spolo[cč]nos[tť]|dru[zž]stvo/i.test(legalForm || ""))
        f.push({ severity: "warning", text: "V registri nie je uvedený žiadny aktuálny štatutárny orgán", penalty: 8 });

      // Spätné preverenie: čo bolo v registri zistiteľné k rozhodnému dátumu
      let asOf: Record<string, unknown> | undefined;
      if (ctx.asOf) {
        const d = ctx.asOf;
        const existedThen = !e.establishment || e.establishment <= d;
        asOf = {
          date: d,
          existed: existedThen,
          name: validAt(names, d)[0]?.value,
          address: fmtAddress(validAt(e.addresses, d)[0]),
          statutory: validAt(e.statutoryBodies, d).map((s: any) => personName(s)),
          owners: validAt(ownerRows, d).map((s: any) => personName(s)),
          dissolutionFacts: (e.otherLegalFacts || []).filter((x: any) => (!x.validFrom || x.validFrom <= d) && (!x.validTo || x.validTo > d)).map((x: any) => String(x.value || "")).filter((t: string) => /zru[sš]en|v[yý]maz|likvid|konkurz/i.test(t)),
          terminatedBefore: Boolean(e.termination && e.termination <= d),
          ageYearsThen: e.establishment ? Math.max(0, (+new Date(d) - +new Date(e.establishment)) / 31557600000) : undefined,
          changesAfter: {
            statutory: (e.statutoryBodies || []).filter((x: any) => x.validFrom && x.validFrom > d).length,
            owners: ownerRows.filter((x: any) => x.validFrom && x.validFrom > d).length,
          },
        };
      }

      const status = statusFromFindings(f);
      return {
        status,
        summary: e.termination
          ? `${name} – subjekt ZANIKOL ${e.termination}.`
          : `${name}, ${legalForm || ""}, vznik ${e.establishment || "?"}, ${ctx.profile.registrationOffice || e.sourceRegister?.value?.value || ""} ${ctx.profile.registrationNumber || ""}`.trim(),
        findings: f,
        verifyUrl: `https://www.orsr.sk/hladaj_ico.asp?ICO=${ctx.ico}&SID=0`,
        data: {
          asOf,
          rpoId: hit.id,
          seatChanges,
          nameChanges,
          statutoryChanges: statChanges,
          legalFacts: facts.slice(0, 10),
          dissolution: dissolution.length > 0 || lname.includes("v likvidacii") || Boolean(e.termination),
          dissolutionText: dissolution[0] || (lname.includes("v likvidacii") ? "Spoločnosť je v likvidácii" : e.termination ? `Zánik ${e.termination}` : undefined),
        },
      };
    },
  );
}
