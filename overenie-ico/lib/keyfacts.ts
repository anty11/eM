import type { CheckResult, CompanyProfile, KeyFact } from "./types";

const d = (iso?: string) => (iso ? new Date(iso).toLocaleDateString("sk-SK", { day: "numeric", month: "numeric", year: "numeric" }) : "");
const monthsSince = (iso?: string) => (iso ? (Date.now() - +new Date(iso)) / (30.44 * 864e5) : NaN);

function ageText(iso?: string): string {
  if (!iso) return "";
  const from = new Date(iso);
  const now = new Date();
  let m = (now.getFullYear() - from.getFullYear()) * 12 + (now.getMonth() - from.getMonth());
  if (now.getDate() < from.getDate()) m--;
  const y = Math.floor(m / 12);
  const mm = m % 12;
  const yw = y === 1 ? "rok" : y >= 2 && y <= 4 ? "roky" : "rokov";
  const mw = mm === 1 ? "mesiac" : mm >= 2 && mm <= 4 ? "mesiace" : "mesiacov";
  return [y ? `${y} ${yw}` : "", mm ? `${mm} ${mw}` : ""].filter(Boolean).join(" ") || "menej ako mesiac";
}

const unavailable = (c?: CheckResult) => !c || c.status === "error" || (c.status === "manual" && c.automated === false && c.id.startsWith("fs-"));

/** Prehľad odpovedí na kľúčové otázky – zobrazuje sa na začiatku výsledku a v PDF. */
export function keyFacts(p: CompanyProfile, checks: CheckResult[]): KeyFact[] {
  const c = (id: string) => checks.find((x) => x.id === id);
  const rpo = c("rpo"), ruz = c("ruz"), vat = c("fs-vat"), ids = c("fs-ids"), dppo = c("fs-dppo");
  const debt = c("fs-debtors"), soc = c("socpoist"), ins = c("insolvency");
  const rd = (ruz?.data || {}) as any;
  const facts: KeyFact[] = [];

  // 1. Účtovná závierka / daňové priznanie
  {
    const dp = (dppo?.data || {}) as any;
    const taxPart = dp.filed ? ` Daňové priznanie${dp.year ? ` za ${dp.year}` : ""} podané${dp.tax !== undefined && dp.tax !== null && dp.tax !== "" ? ` (daň ${dp.tax} €)` : ""}.` : "";
    let f: KeyFact;
    if (!ruz || ruz.status === "error") f = { id: "filed", question: "Podala účtovnú závierku / daňové priznanie?", answer: "Nepodarilo sa overiť – skontrolujte v RÚZ.", tone: "unknown" };
    else if (!rd.lastFiledYear) {
      const young = monthsSince(p.established) < 24;
      f = {
        id: "filed",
        question: "Podala účtovnú závierku / daňové priznanie?",
        answer: young ? `Zatiaľ nie – spoločnosť vznikla ${d(p.established)}, prvá závierka ešte nemusela byť povinná.` : "NIE – v Registri účtovných závierok nie je žiadna závierka.",
        tone: young ? "neutral" : "bad",
      };
    } else
      f = {
        id: "filed",
        question: "Podala účtovnú závierku / daňové priznanie?",
        answer: `${rd.filedExpected ? "Áno" : "Oneskorene"} – posledná závierka za rok ${rd.lastFiledYear}${rd.lastFiledOn ? `, uložená ${d(rd.lastFiledOn)}` : ""}.${taxPart}`,
        tone: rd.filedExpected ? "good" : "warn",
      };
    f.source = "Register účtovných závierok" + (dp.filed ? ", Finančná správa" : "");
    facts.push(f);
  }

  // 2. Konanie o zrušení / výmaze / likvidácii
  {
    const hit = (rpo?.data as any)?.dissolution || (ins?.data as any)?.dissolution;
    const text = (rpo?.data as any)?.dissolutionText || (ins?.data as any)?.dissolutionText;
    const pending = !ins || ins.status === "manual" || ins.status === "error";
    const insolvent = !hit && ins?.status === "critical" && (ins?.data as any)?.insolvent !== false;
    facts.push({
      id: "dissolution",
      question: "Je vedené konanie o zrušení, výmaze alebo likvidácii?",
      answer: hit
        ? `ÁNO – ${text || "zápis v registri úpadcov a likvidácií"}.`
        : insolvent
          ? "Konanie o zrušení nie je, ale je vedené INSOLVENČNÉ konanie (konkurz / reštrukturalizácia)."
          : pending
            ? "V obchodnom registri bez záznamu; register likvidácií treba potvrdiť manuálne."
            : "Nie – bez záznamu v obchodnom registri ani v registri likvidácií.",
      tone: hit || insolvent ? "bad" : pending ? "unknown" : "good",
      source: "Obchodný register (RPO), REPLIK",
    });
  }

  // 3. Typ a vek spoločnosti
  facts.push({ id: "form", question: "Typ spoločnosti", answer: p.legalForm || "–", tone: "neutral", source: "Obchodný register" });
  {
    const m = monthsSince(p.established);
    facts.push({
      id: "age",
      question: "Vek spoločnosti",
      answer: p.terminated ? `Zanikla ${d(p.terminated)}` : p.established ? `${ageText(p.established)} (vznik ${d(p.established)})` : "–",
      tone: p.terminated ? "bad" : m < 12 ? "warn" : m < 24 ? "neutral" : "good",
      source: "Obchodný register",
    });
  }

  // 4. Predmet činnosti
  {
    const acts = p.activities || [];
    facts.push({
      id: "activity",
      question: "Predmet obchodnej činnosti",
      answer: [p.mainActivity ? `Hlavná činnosť: ${p.mainActivity}` : "", acts.length ? `${acts.length} ${acts.length === 1 ? "predmet" : acts.length < 5 ? "predmety" : "predmetov"} podnikania v registri (zoznam nižšie)` : ""].filter(Boolean).join(". ") || "–",
      tone: "neutral",
      source: "Obchodný register, ŠÚ SR",
    });
  }

  // 5. Posledná zmena vlastníctva
  {
    const owners = p.owners || [];
    const isAs = /akciov/i.test(p.legalForm || "");
    const m = monthsSince(p.lastOwnershipChange);
    facts.push({
      id: "ownership",
      question: "Dátum poslednej zmeny vlastníctva",
      answer: p.lastOwnershipChange
        ? `${d(p.lastOwnershipChange)}${owners.length ? ` – súčasní vlastníci: ${owners.map((o) => o.name).join(", ")}` : ""}`
        : isAs
          ? "Akcionári akciovej spoločnosti sa v obchodnom registri nezverejňujú (okrem jediného akcionára)."
          : "V registri nie sú údaje o spoločníkoch.",
      tone: p.lastOwnershipChange ? (m < 6 ? "warn" : "neutral") : "unknown",
      source: "Obchodný register",
    });
  }

  // 6. Posledná zmena štatutárneho orgánu
  {
    const m = monthsSince(p.lastStatutoryChange);
    facts.push({
      id: "statutory",
      question: "Dátum poslednej zmeny štatutárneho orgánu",
      answer: p.lastStatutoryChange
        ? `${d(p.lastStatutoryChange)}${p.statutory?.length ? ` – súčasný štatutár: ${p.statutory.map((s) => s.name).join(", ")}` : ""}`
        : "–",
      tone: p.lastStatutoryChange ? (m < 6 ? "warn" : "neutral") : "unknown",
      source: "Obchodný register",
    });
  }

  // 7. Spoľahlivý platiteľ DPH
  {
    let f: KeyFact;
    const idsVal = String(((ids?.data as any)?.row && Object.values((ids!.data as any).row).find((v) => /spo[lľ]ahliv/i.test(String(v)))) || "");
    if (unavailable(vat)) f = { id: "vat", question: "Je spoľahlivý platiteľ DPH?", answer: "Automaticky neoverené – skontrolujte v zoznamoch Finančnej správy.", tone: "unknown" };
    else if (vat!.status === "critical") f = { id: "vat", question: "Je spoľahlivý platiteľ DPH?", answer: "NIE – u platiteľa nastali dôvody na zrušenie registrácie DPH (riziko ručenia za DPH).", tone: "bad" };
    else if (!p.icDph) f = { id: "vat", question: "Je spoľahlivý platiteľ DPH?", answer: "Nie je platiteľom DPH.", tone: "neutral" };
    else if (/menej/i.test(idsVal)) f = { id: "vat", question: "Je spoľahlivý platiteľ DPH?", answer: `Registrovaný platiteľ ${p.icDph}, ale index daňovej spoľahlivosti: ${idsVal}.`, tone: "warn" };
    else f = { id: "vat", question: "Je spoľahlivý platiteľ DPH?", answer: `Áno – registrovaný platiteľ DPH ${p.icDph} bez dôvodov na zrušenie registrácie${idsVal ? `, index daňovej spoľahlivosti: ${idsVal}` : ""}.`, tone: "good" };
    f.source = "Finančná správa";
    facts.push(f);
  }

  // 8. Nedoplatky
  {
    const bad = [debt?.status === "critical" ? "daňový dlžník" : "", soc?.status === "critical" ? "dlžník Sociálnej poisťovne" : ""].filter(Boolean);
    const unknown = unavailable(debt) || !soc || soc.status === "manual" || soc.status === "error";
    facts.push({
      id: "arrears",
      question: "Má nedoplatky na daniach alebo v Sociálnej poisťovni?",
      answer: bad.length ? `ÁNO – ${bad.join(", ")}.` : unknown ? "V dostupných zoznamoch bez záznamu; niektorý zdroj treba overiť manuálne." : "Nie – nie je v zozname daňových dlžníkov ani dlžníkov Sociálnej poisťovne.",
      tone: bad.length ? "bad" : unknown ? "unknown" : "good",
      source: "Finančná správa, Sociálna poisťovňa",
    });
  }
  return facts;
}
