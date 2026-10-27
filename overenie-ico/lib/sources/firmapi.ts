import { fetchWithTimeout } from "../http";
import { getFirmapiKey } from "../access";
import type { CheckResult, Ctx, Finding, SearchLog } from "../types";
import { sq } from "../searchlog";
import { MANUAL } from "./manual";

/**
 * FirmAPI.sk – licencovaný agregátor slovenských registrov (https://www.firmapi.sk/dokumentacia). Používa sa tam, kde priamy zdroj
 * automatizáciu zakazuje alebo nemá API: zoznam dlžníkov zdravotnej poisťovne Dôvera (`scope=debtor_status`, zdroj „dovera“).
 * Dáta berie FirmAPI na základe vlastných dohôd a zverejnení poisťovní (Dôvera aktualizuje mesačne okolo 25.), preto každý výsledok
 * uvádza poskytovateľa, stav dát (`listed_since`, `enriched_at`) a odkaz na overenie priamo v zozname Dôvery.
 *
 * Autentifikácia: hlavička `X-API-Key` (kľúč z Administrácie → Prístupy, alebo FIRMAPI_KEY). Chyby: 401 neplatný kľúč, 402 vyčerpané
 * kredity, 403 funkcia mimo plánu, 404 firma sa nenašla, 429 limit požiadaviek – vždy sa zapíšu do záznamu vyhľadávania.
 */
export const FIRMAPI_BASE = process.env.FIRMAPI_BASE_URL || "https://firmapi.sk/v1";

export interface DebtorSource {
  source: string;
  debtor_name?: string;
  debt_amount?: string | number;
  listed_since?: string;
  [k: string]: unknown;
}

export interface FirmapiCompany {
  ico?: string;
  name?: string;
  debtor_status?: { is_debtor?: boolean; sources?: DebtorSource[] };
  meta?: { enriched_at?: string; rpo_updated_at?: string; orsr_synced_at?: string; stale?: boolean; stale_reason?: string };
  [k: string]: unknown;
}

const ERR: Record<number, string> = {
  401: "neplatný alebo chýbajúci kľúč API",
  402: "vyčerpané kredity FirmAPI",
  403: "funkcia nie je v pláne FirmAPI",
  404: "FirmAPI firmu s týmto IČO neeviduje",
  429: "limit požiadaviek FirmAPI",
  503: "FirmAPI dočasne nedostupné",
};

export async function firmapiCompany(ico: string, scope: string): Promise<{ data: FirmapiCompany | null; status: number; url: string; error?: string }> {
  const k = await getFirmapiKey();
  const url = `${FIRMAPI_BASE}/company/ico/${ico}?scope=${encodeURIComponent(scope)}`;
  if (!k) return { data: null, status: 0, url, error: "kľúč FirmAPI nie je nastavený" };
  const r = await fetchWithTimeout(url, { headers: { "X-API-Key": k.key, Accept: "application/json" }, timeoutMs: 12000 });
  const txt = await r.text();
  let j: any = null;
  try {
    j = JSON.parse(txt);
  } catch {
    /* nie je JSON */
  }
  if (!r.ok) return { data: null, status: r.status, url, error: `${ERR[r.status] || `HTTP ${r.status}`}${j?.message ? ` (${j.message})` : ""}` };
  if (!j || typeof j !== "object") return { data: null, status: r.status, url, error: "odpoveď nie je JSON" };
  return { data: (j.data && typeof j.data === "object" ? { ...j.data, meta: j.meta || j.data.meta } : j) as FirmapiCompany, status: r.status, url };
}

/** Záznamy dlžníka pre daný zdroj (podľa názvu zdroja v odpovedi – „dovera“, „vszp“, „union“, „socpoist“, „fs“…). */
export function debtorRows(c: FirmapiCompany | null, re: RegExp): DebtorSource[] {
  return (c?.debtor_status?.sources || []).filter((s) => re.test(String(s.source || "").toLowerCase()));
}

const skd = (v?: string) => {
  const m = String(v || "").match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${Number(m[3])}. ${Number(m[2])}. ${m[1]}` : v || "";
};
const eur = (v: unknown) => {
  const n = Number(String(v ?? "").replace(/\s/g, "").replace(",", "."));
  return Number.isFinite(n) ? `${n.toLocaleString("sk-SK", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).replace(/[  ]/g, " ")} €` : String(v ?? "");
};

/** Dlžníci zdravotnej poisťovne Dôvera cez FirmAPI; null = kľúč nie je nastavený (ostáva manuálne). */
export async function checkDoveraViaFirmapi(ctx: Ctx): Promise<CheckResult | null> {
  const def = MANUAL.find((m) => m.id === "dovera")!;
  const t0 = Date.now();
  const base = { id: def.id, category: def.category, name: def.name, source: "Dôvera – zoznam dlžníkov (cez FirmAPI.sk)", sourceUrl: def.sourceUrl, verifyUrl: def.verifyUrl(ctx.ico, ctx.profile.name), checkedAt: new Date().toISOString() };
  const dataset = "FirmAPI.sk – stav dlžníka (debtor_status), zdroj Dôvera (zoznam dlžníkov zverejňovaný Dôverou, mesačne)";
  let r: Awaited<ReturnType<typeof firmapiCompany>>;
  try {
    r = await firmapiCompany(ctx.ico, "debtor_status");
  } catch (e) {
    r = { data: null, status: 0, url: `${FIRMAPI_BASE}/company/ico/${ctx.ico}?scope=debtor_status`, error: (e as Error).message.slice(0, 160) };
  }
  if (!r.data && r.status === 0 && /kľúč FirmAPI nie je nastavený/.test(r.error || "")) return null;
  const asOf = r.data?.meta?.enriched_at ? skd(r.data.meta.enriched_at) : undefined;
  const all = r.data?.debtor_status?.sources || [];
  const rows = debtorRows(r.data, /dovera|dôvera/);
  const search: SearchLog[] = [
    {
      dataset,
      asOf,
      queries: [sq("IČO", ctx.ico, r.data ? all.length : null, rows.length, r.url.replace(/\?.*$/, "?scope=debtor_status"), r.error ? `chyba: ${r.error}` : `odpoveď FirmAPI: is_debtor = ${String(r.data?.debtor_status?.is_debtor)}, zdroje: ${all.map((s) => s.source).join(", ") || "žiadne"}${r.data?.meta?.stale ? "; dáta označené ako staršie" : ""}`)],
      rule: "záznam so zdrojom „dovera“ v stave dlžníka; bez záznamu = Dôvera subjekt v zozname dlžníkov neuvádza (podľa posledného zverejnenia)",
      sample: all.filter((s) => !rows.includes(s)).slice(0, 4).map((s) => `${s.source}: ${s.debtor_name || ""} ${s.debt_amount ? eur(s.debt_amount) : ""}`.trim()),
    },
  ];
  if (!r.data) {
    // chyba poskytovateľa → manuálne, s dôvodom
    return { ...base, status: "manual", summary: `${def.note} (FirmAPI: ${r.error})`, findings: [], search, data: { penaltyIfFound: def.penaltyIfFound, severityIfFound: def.severityIfFound, autoError: r.error }, durationMs: Date.now() - t0, automated: false };
  }
  if (rows.length) {
    const d = rows[0];
    const text = `Dlh voči zdravotnej poisťovni Dôvera${d.debt_amount ? ` – ${eur(d.debt_amount)}` : ""}${d.listed_since ? ` (v zozname od ${skd(d.listed_since)})` : ""}${d.debtor_name ? ` – ${d.debtor_name}` : ""}`;
    const f: Finding[] = [{ severity: def.severityIfFound, text, penalty: def.penaltyIfFound }];
    return { ...base, status: def.severityIfFound === "critical" ? "critical" : "warning", summary: `Subjekt JE v zozname dlžníkov Dôvery${d.debt_amount ? ` – ${eur(d.debt_amount)}` : ""}${d.listed_since ? `, v zozname od ${skd(d.listed_since)}` : ""} (podľa FirmAPI.sk${asOf ? `, stav k ${asOf}` : ""}).`, findings: f, search, data: { penaltyIfFound: def.penaltyIfFound, severityIfFound: def.severityIfFound, rows: rows.map((x) => `${x.debtor_name || ""} · ${eur(x.debt_amount)} · od ${skd(x.listed_since)}`), via: "firmapi", provider: "firmapi" }, durationMs: Date.now() - t0, automated: true };
  }
  return {
    ...base,
    status: "ok",
    summary: `Subjekt NIE JE v zozname dlžníkov Dôvery (podľa FirmAPI.sk${asOf ? `, stav k ${asOf}` : ""}; Dôvera zoznam aktualizuje mesačne).`,
    findings: [],
    search,
    data: { penaltyIfFound: def.penaltyIfFound, severityIfFound: def.severityIfFound, via: "firmapi", provider: "firmapi", definitive: true },
    durationMs: Date.now() - t0,
    automated: true,
  };
}
