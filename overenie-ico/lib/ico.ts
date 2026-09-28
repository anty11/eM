/** Normalizuje IČO (odstráni medzery, doplní nuly na 8 číslic). */
export function normalizeIco(input: string): string | null {
  const digits = (input || "").replace(/\s+/g, "");
  if (!/^\d{6,8}$/.test(digits)) return null;
  return digits.padStart(8, "0");
}

/**
 * Kontrolný súčet IČO (modulo 11, váhy 8..2).
 * Niektoré historické IČO kontrolu nespĺňajú, preto slúži len ako upozornenie.
 */
export function icoChecksumValid(ico: string): boolean {
  if (!/^\d{8}$/.test(ico)) return false;
  let sum = 0;
  for (let i = 0; i < 7; i++) sum += Number(ico[i]) * (8 - i);
  const r = sum % 11;
  const check = r === 0 ? 1 : r === 1 ? 0 : 11 - r;
  return check === Number(ico[7]);
}
