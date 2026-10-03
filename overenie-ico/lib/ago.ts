/** Vek preverenia – zdieľané medzi serverom a prehliadačom (bez závislostí na databáze). */

/** Po koľkých dňoch je preverenie zastarané a odporúča sa zopakovať. */
export const STALE_DAYS = 180;

export function daysSince(iso: string, now = Date.now()) {
  return Math.max(0, Math.floor((now - new Date(iso).getTime()) / 86400000));
}

/** „dnes“, „včera“, „pred 5 dňami“ */
export function agoLabel(days: number) {
  if (days <= 0) return "dnes";
  if (days === 1) return "včera";
  return `pred ${days} dňami`;
}
