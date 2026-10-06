/** Časti pečate, ktoré používa aj prehliadač (bez node:crypto / node:zlib / databázy). */

/** Skrátený zápis odtlačku do protokolu: 4 skupiny po 4 znaky z prvých 16 + … + posledné 4 */
export function shortHash(h: string) {
  return `${h.slice(0, 4)} ${h.slice(4, 8)} ${h.slice(8, 12)} ${h.slice(12, 16)} … ${h.slice(-4)}`.toUpperCase();
}
