import { kv } from "./auth/kv";

/**
 * Záznam chýb zdrojov (Administrácia → Chyby zdrojov). Každé zlyhanie kontroly – aj to, ktoré sa pri „Skúsiť znova“ alebo
 * pri ďalšom preverení samo „opraví“ – ostane zapísané: zdroj, IČO, presná správa, trvanie, kde vzniklo (preverenie, opakovanie,
 * limit). Opakovaný pokus, ktorý uspeje, sa zapíše ako `retry-ok` s odkazom na predchádzajúcu chybu – vidno, ktoré zdroje
 * padajú prechodne (studený štart, limit, pomalý register) a ktoré trvalo. Uchováva sa posledných 300 záznamov.
 */
export interface ErrRecord {
  id: string;
  at: string;
  kind: "error" | "deadline" | "retry-ok" | "retry-fail";
  source: string;
  ico: string;
  message: string;
  ms?: number;
  /** kde vzniklo: scan (preverenie), retry (Skúsiť znova), manual (register bez API), flow (prehliadač) */
  where?: string;
  /** studený štart funkcie (prvá chyba po štarte inštancie) */
  cold?: boolean;
}

const KEY = "errlog";
const MAX = 300;
let instanceStarted = Date.now();
let firstInInstance = true;

export async function logError(r: Omit<ErrRecord, "id" | "at" | "cold">) {
  const rec: ErrRecord = { id: Math.random().toString(36).slice(2, 10), at: new Date().toISOString(), cold: firstInInstance || Date.now() - instanceStarted < 15000, ...r, message: r.message.slice(0, 400) };
  firstInInstance = false;
  await kv().lpush(KEY, rec, MAX).catch(() => undefined);
}

export async function listErrors(limit = MAX): Promise<ErrRecord[]> {
  const all = await kv().lrange<ErrRecord>(KEY, 0, MAX - 1).catch(() => [] as ErrRecord[]);
  return all.filter(Boolean).slice(0, limit);
}

export async function clearErrors() {
  await kv().del(KEY);
}

/** Súhrn: za zdroj počet chýb, koľko z nich sa pri opakovaní opravilo, najčastejšie správy. */
export function summarizeErrors(list: ErrRecord[]) {
  const by = new Map<string, { errors: number; retryOk: number; retryFail: number; deadlines: number; cold: number; messages: Map<string, number> }>();
  for (const r of list) {
    const s = by.get(r.source) || { errors: 0, retryOk: 0, retryFail: 0, deadlines: 0, cold: 0, messages: new Map() };
    if (r.kind === "error") {
      s.errors++;
      if (r.cold) s.cold++;
      const m = r.message.replace(/\d{6,}/g, "#").replace(/\(\d+ ?m?s\)/g, "").slice(0, 120);
      s.messages.set(m, (s.messages.get(m) || 0) + 1);
    } else if (r.kind === "deadline") s.deadlines++;
    else if (r.kind === "retry-ok") s.retryOk++;
    else if (r.kind === "retry-fail") s.retryFail++;
    by.set(r.source, s);
  }
  return [...by.entries()]
    .map(([source, s]) => ({ source, ...s, messages: [...s.messages.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4).map(([m, n]) => `${n}× ${m}`) }))
    .sort((a, b) => b.errors + b.deadlines - (a.errors + a.deadlines));
}
