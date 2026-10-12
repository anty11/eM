/**
 * Je zápis menom právnickej osoby (s.r.o., a.s., družstvo, GmbH…)? Používa sa pri štatutároch a vlastníkoch z RPO:
 * register diskvalifikácií a hľadanie osôb v médiách sa týkajú len ľudí; materská firma sa hľadá ako firma.
 * Skratky sa uznávajú len ako samostatné slovo (za nimi medzera, čiarka alebo koniec) – „Novák“ nie je „n. o.“.
 */
const ENTITY_RE = /(^|[\s,(])(s\.? ?r\.? ?o\.?|spol\.? ?s ?r\.? ?o\.?|a\.? ?s\.?|k\.? ?s\.?|v\.? ?o\.? ?s\.?|n\.? ?o\.?|s\.? ?e\.?|družstvo|holding|group|limited|ltd\.?|gmbh|inc\.?|plc|llc|b\.? ?v\.?|sp\.? ?z ?o\.? ?o\.?|z\.? ?s\.?|o\.? ?z\.?)(?=[\s,.)]|$)/i;

export function isLegalEntity(name: string | undefined): boolean {
  return Boolean(name) && ENTITY_RE.test(String(name).trim());
}
