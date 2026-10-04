import { runCheck, statusFromFindings } from "../check";
import { riskJurisdiction } from "../deal";
import { fold, getJson } from "../http";
import type { CheckResult, Ctx, Finding } from "../types";

const BASE = "https://api.statistics.sk/rpo/v1";

type Valid = { validFrom?: string; validTo?: string; [k: string]: any };
const current = <T extends Valid>(arr?: T[]): T[] => (arr || []).filter((x) => !x.validTo);
/** Položky platné k danému dňu (validFrom ≤ deň < validTo). */
const validAt = <T extends Valid>(arr: T[] | undefined, day: string): T[] => (arr || []).filter((x) => (!x.validFrom || x.validFrom <= day) && (!x.validTo || x.validTo > day));
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
  return runCheck(
    {
      id: "rpo",
      category: "register",
      name: "Obchodný register / Register právnických osôb",
      source: "Štatistický úrad SR – RPO (údaje z ORSR, ŽRSR a i.)",
      sourceUrl: "https://rpo.statistics.sk",
    },
    async () => {
      // RPO občas odpovedá pomaly – jeden opakovaný pokus s kratším limitom
      const search = await getJson<{ results?: any[] }>(`${BASE}/search?identifier=${ctx.ico}`, { timeoutMs: 11000 }).catch(() =>
        getJson<{ results?: any[] }>(`${BASE}/search?identifier=${ctx.ico}`, { timeoutMs: 11000 }),
      );
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
        e = await getJson(`${BASE}/entity/${hit.id}?showHistoricalData=true&showOrganizationUnits=false`);
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
      const changeDates = (rows: any[]) =>
        rows
          .flatMap((x) => [x.validFrom, x.validTo])
          .filter((d): d is string => Boolean(d) && d !== e.establishment)
          .sort();
      const lastOwnershipChange = changeDates(ownerRows).pop() || (ownerRows.length ? e.establishment : undefined);
      const lastStatutoryChange = changeDates(e.statutoryBodies || []).pop() || ((e.statutoryBodies || []).length ? e.establishment : undefined);

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
      // Pri veľkých orgánoch (predstavenstvo a. s.) sú jednotlivé zmeny členov bežné – hodnotí sa až výmena väčšiny orgánu
      const statChanges = recent(e.statutoryBodies, 2);
      if (statChanges >= Math.max(3, Math.ceil(statutory.length * 0.6))) f.push({ severity: "warning", text: `Časté zmeny štatutárov – ${statChanges} zmien za posledné 2 roky`, penalty: 8 });
      // Indikátor (iv) SKDP 03/2024: časté zmeny vlastníkov a zmena vlastníka alebo štatutára tesne pred obchodom
      const ownerChanges = recent(ownerRows, 2);
      if (ownerChanges >= 2) f.push({ severity: "warning", text: `Časté zmeny spoločníkov – ${ownerChanges} zmien za posledné 2 roky (indikátor iv)`, penalty: 8 });
      const daysAgo = (d?: string) => (d ? Math.floor((Date.now() - +new Date(d)) / 86400000) : Infinity);
      const recentOwner = Math.min(...ownerRows.filter((x: any) => x.validFrom !== e.establishment).flatMap((x: any) => [daysAgo(x.validFrom), daysAgo(x.validTo)]));
      const recentStat = Math.min(...(e.statutoryBodies || []).filter((x: any) => x.validFrom !== e.establishment).flatMap((x: any) => [daysAgo(x.validFrom), daysAgo(x.validTo)]));
      // zmena jedného člena z väčšieho orgánu nie je indikátor – pri orgáne nad 3 členov sa sleduje len zmena vlastníka
      const recentChange = statutory.length > 3 ? recentOwner : Math.min(recentOwner, recentStat);
      if (recentChange <= 180 && age >= 1)
        f.push({
          severity: "warning",
          text: `Zmena ${recentOwner <= recentStat ? "vlastníka" : "štatutárneho orgánu"} pred ${recentChange} dňami – zmena tesne pred obchodom je indikátor rizika (iv), overte dôvod a nových konateľov`,
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
