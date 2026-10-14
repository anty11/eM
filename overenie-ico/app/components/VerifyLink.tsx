"use client";

import { useEffect, useState } from "react";
import type { CheckResult } from "@/lib/types";

/**
 * „Overiť v zdroji“: otvorí register a zároveň skopíruje do schránky presne ten výraz, ktorý treba do vyhľadávania vložiť
 * (IČO, celé obchodné meno pri zoznamoch FS, priezvisko pri registri diskvalifikácií). Stránky s formulárom POST alebo
 * aplikácie (FS, VšZP, Dôvera, Union, OV, diskvalifikácie) sa z odkazu predvyplniť nedajú – prehliadač to cudzej stránke nedovolí,
 * preto schránka + pokyn, kam výraz vložiť. Kde register prijíma výraz v adrese (ORSR, RÚZ, REPLIK, ÚVO, SP, Google), je už v odkaze.
 */
export function verifyTerm(c: CheckResult, ico: string, name?: string): { term: string; where: string } | null {
  const byPrefix = (p: string) => c.search?.flatMap((s) => s.queries).filter((q) => q.by.startsWith(p)).map((q) => q.value) || [];
  switch (c.id) {
    case "fs-debtors":
      return { term: name || ico, where: name ? "Finančná správa – Zoznam daňových dlžníkov: pole „Názov subjektu“ (zoznam nemá IČO)" : "Finančná správa – zoznamy: vyhľadávanie" };
    case "fs-vat":
    case "fs-ids":
    case "fs-dppo":
    case "fs-excise":
      return { term: ico, where: "Finančná správa – príslušný zoznam: pole „IČO“" };
    case "diskv": {
      const surnames = Array.from(new Set(byPrefix("priezvisk")));
      return surnames.length ? { term: surnames[0], where: `Register diskvalifikácií: pole „Meno“ – priezvisko${surnames.length > 1 ? ` (postupne: ${surnames.join(", ")})` : ""}` } : { term: ico, where: "Register diskvalifikácií: vyhľadávanie" };
    }
    case "vszp":
      return { term: ico, where: "VšZP – zoznam dlžníkov: záložka „Zamestnávatelia a SZČO“, pole „IČO“" };
    case "dovera":
      return { term: ico, where: "Dôvera – zoznam dlžníkov (IČO je v odkaze, výsledok sa zobrazí hneď)" };
    case "union":
      return { term: ico, where: "Union – zoznam dlžníkov: pole „Priezvisko, meno / názov alebo IČO“" };
    case "ov":
      return { term: ico, where: "Obchodný vestník – Zverejnené formuláre: pole „IČO“, dátum od (3 roky), „Vyhľadať podania“" };
    case "cre":
      return { term: ico, where: "CRE – po prihlásení: vyhľadávanie podľa IČO" };
    case "uvo":
      return { term: ico, where: "ÚVO – globálne vyhľadávanie (IČO je v odkaze)" };
    case "news":
      return null;
    default:
      return { term: ico, where: "vyhľadávanie podľa IČO (IČO je v odkaze)" };
  }
}

export default function VerifyLink({ check, ico, name }: { check: CheckResult; ico: string; name?: string }) {
  const [copied, setCopied] = useState<string | null>(null);
  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(null), 6000);
    return () => clearTimeout(t);
  }, [copied]);
  if (!check.verifyUrl) return null;
  const hint = verifyTerm(check, ico, name);
  const onClick = () => {
    if (!hint) return;
    try {
      void navigator.clipboard?.writeText(hint.term).then(
        () => setCopied(hint.term),
        () => setCopied(null),
      );
    } catch {
      /* schránka nie je dostupná (http, staré prehliadače) – pokyn sa zobrazí aj tak */
    }
  };
  return (
    <span className="verify-wrap no-print">
      <a className="verify" href={check.verifyUrl} target="_blank" rel="noreferrer" onClick={onClick} title={hint ? `Do schránky sa skopíruje „${hint.term}“ – ${hint.where}` : undefined}>
        Overiť v zdroji ↗
      </a>
      {hint && copied && (
        <span className="verify-hint" role="status">
          Skopírované „{copied}“ – vložte (Ctrl+V) do: {hint.where}
        </span>
      )}
    </span>
  );
}
