import type { CheckResult, CompanyProfile } from "./types";

/**
 * Spätné preverenie k rozhodnému dátumu existujúcej spolupráce (len verzia Rozšírené).
 * Protokol je vyhotovený dnes; tento blok hovorí, čo bolo k rozhodnému dátumu zistiteľné z registrov, ktoré históriu
 * poskytujú (obchodný register, závierky, úpadcovia, médiá), a výslovne uvádza, čo k tomu dňu overiť nemožno
 * (zoznamy Finančnej správy a Sociálnej poisťovne nemajú verejnú históriu).
 */
export type RetroTone = "good" | "bad" | "warn" | "neutral" | "unknown";
export interface RetroLine {
  source: string;
  text: string;
  tone: RetroTone;
}

const fmt = (d?: string) => (d ? new Date(d).toLocaleDateString("sk-SK") : "–");

export function retroLines(asOf: string, profile: CompanyProfile, checks: CheckResult[]): RetroLine[] {
  const out: RetroLine[] = [];
  const by = (id: string) => checks.find((c) => c.id === id);
  const rpo = by("rpo")?.data?.asOf as any;
  const ruz = by("ruz")?.data?.asOf as any;
  const ins = by("insolvency")?.data?.asOf as any;
  const news = by("news")?.data?.asOf as any;

  if (rpo) {
    if (!rpo.existed) out.push({ source: "Obchodný register", text: `Spoločnosť k ${fmt(asOf)} ešte neexistovala (vznik ${fmt(profile.established)}).`, tone: "bad" });
    else {
      if (rpo.terminatedBefore) out.push({ source: "Obchodný register", text: `Spoločnosť bola k ${fmt(asOf)} už zaniknutá / vymazaná.`, tone: "bad" });
      out.push({ source: "Obchodný register", text: `Názov k rozhodnému dátumu: ${rpo.name || "–"}; sídlo: ${rpo.address || "–"}.`, tone: "neutral" });
      out.push({ source: "Obchodný register", text: `Štatutárny orgán k rozhodnému dátumu: ${(rpo.statutory as string[]).join(", ") || "–"}; spoločníci: ${(rpo.owners as string[]).join(", ") || "–"}.`, tone: "neutral" });
      if (rpo.dissolutionFacts?.length) out.push({ source: "Obchodný register", text: `K rozhodnému dátumu bol v registri zápis: ${(rpo.dissolutionFacts as string[]).slice(0, 2).join("; ").slice(0, 240)}.`, tone: "bad" });
      if (typeof rpo.ageYearsThen === "number") {
        if (rpo.ageYearsThen < 1) out.push({ source: "Obchodný register", text: `Spoločnosť mala k rozhodnému dátumu menej ako rok (vznik ${fmt(profile.established)}) – indikátor novej spoločnosti.`, tone: "warn" });
        else out.push({ source: "Obchodný register", text: `Vek spoločnosti k rozhodnému dátumu: ${Math.floor(rpo.ageYearsThen)} r.`, tone: rpo.ageYearsThen >= 5 ? "good" : "neutral" });
      }
      const ch = rpo.changesAfter || {};
      if (ch.statutory || ch.owners) out.push({ source: "Obchodný register", text: `Po rozhodnom dátume nastali zmeny: štatutári ${ch.statutory || 0}×, spoločníci ${ch.owners || 0}× – dnešný stav sa od stavu pri začiatku spolupráce líši.`, tone: "warn" });
    }
  } else out.push({ source: "Obchodný register", text: "Historický stav sa nepodarilo načítať.", tone: "unknown" });

  if (ruz) {
    if (ruz.duePeriodsThen === 0) out.push({ source: "Register účtovných závierok", text: `K ${fmt(asOf)} ešte nebola splatná žiadna závierka.`, tone: "neutral" });
    else if (ruz.missingThen >= 2) out.push({ source: "Register účtovných závierok", text: `K rozhodnému dátumu chýbali závierky za ${ruz.missingThen} po sebe idúce obdobia (uložené boli: ${(ruz.filedYears as string[]).join(", ") || "žiadne"}) – vtedy zistiteľný dôvod na zrušenie súdom.`, tone: "bad" });
    else if (ruz.missingThen === 1) out.push({ source: "Register účtovných závierok", text: `K rozhodnému dátumu chýbala závierka za ${ruz.expectedThen} (uložené: ${(ruz.filedYears as string[]).join(", ") || "žiadne"}).`, tone: "warn" });
    else out.push({ source: "Register účtovných závierok", text: `K rozhodnému dátumu boli uložené závierky za ${(ruz.filedYears as string[]).join(", ")} (posledná uložená ${fmt(ruz.lastFiledOn)}) – povinnosť splnená.`, tone: "good" });
  } else out.push({ source: "Register účtovných závierok", text: "Historický stav sa nepodarilo načítať.", tone: "unknown" });

  if (ins) {
    const b = ins.startedBefore as string[], s = ins.startedSameYear as string[], a = ins.startedAfter as string[];
    if (b.length) out.push({ source: "Register úpadcov", text: `Konania začaté pred rokom rozhodného dátumu: ${b.join(", ")} – boli zistiteľné pri začiatku spolupráce.`, tone: "bad" });
    if (s.length) out.push({ source: "Register úpadcov", text: `Konania z roku rozhodného dátumu: ${s.join(", ")} – podľa spisovej značky nemožno určiť, či začali pred alebo po ${fmt(asOf)}; overte dátum začatia v REPLIK.`, tone: "warn" });
    if (a.length) out.push({ source: "Register úpadcov", text: `Konania začaté až po rozhodnom dátume: ${a.join(", ")} – pri začiatku spolupráce neboli zistiteľné.`, tone: "neutral" });
    if (!b.length && !s.length && !a.length) out.push({ source: "Register úpadcov", text: "Žiadne konanie – ani k rozhodnému dátumu, ani dnes.", tone: "good" });
  } else out.push({ source: "Register úpadcov", text: "Historický stav sa nepodarilo načítať.", tone: "unknown" });

  if (news) {
    const n = news.before as any[];
    if (!n.length) out.push({ source: "Médiá", text: `Pred ${fmt(asOf)} sa nenašli relevantné články o spoločnosti ani štatutároch${news.undated ? ` (${news.undated} bez dátumu – nezaradené)` : ""}.`, tone: "neutral" });
    else out.push({ source: "Médiá", text: `Pred rozhodným dátumom vyšlo ${n.length} relevantných článkov, z toho ${news.negativeBefore} s negatívnym obsahom${news.negativeBefore ? ` (napr. „${n.find((x) => x.negative?.length)?.title}“)` : ""}.`, tone: news.negativeBefore ? "warn" : "good" });
  } else out.push({ source: "Médiá", text: "Historický prehľad sa nepodarilo zostaviť.", tone: "unknown" });

  out.push({ source: "Finančná správa, Sociálna poisťovňa", text: `Zoznamy dlžníkov, platiteľov DPH, index spoľahlivosti a bankových účtov nemajú verejnú históriu – stav k ${fmt(asOf)} nie je overiteľný; protokol uvádza dnešný stav.`, tone: "unknown" });
  return out;
}
