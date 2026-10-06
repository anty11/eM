import type { Browser, BrowserContext, Page } from "playwright-core";

/**
 * Headless prehliadač na serveri – nástroj pre AI agenta aj pre skriptované dopyty do registrov, ktoré sú len za formulárom
 * alebo za aplikáciou v prehliadači (Union, Obchodný vestník, ÚVO …).
 *
 * Kde beží Chromium (v tomto poradí):
 *  1. BROWSER_WS_ENDPOINT – vzdialený prehliadač cez CDP (napr. Browserbase / Browserless; vhodné aj so slovenskou IP adresou,
 *     keď register blokuje adresy dátových centier – justice.gov.sk).
 *  2. CHROMIUM_PATH – lokálne spustiteľné Chromium (vývoj, vlastný server).
 *  3. Vercel / AWS Lambda – balík @sparticuz/chromium (rozbalí sa do /tmp pri prvom použití).
 *  4. inak Chromium nainštalované Playwrightom.
 *
 * Stránka sa modelu podáva ako kompaktná „snímka“: adresa, titulok, viditeľný text, tabuľky a očíslované interaktívne prvky
 * (polia, tlačidlá, výbery, odkazy), na ktoré sa odkazuje značkou e1, e2 … – model teda vypĺňa a kliká bez selektorov.
 */
export interface Snapshot {
  url: string;
  title: string;
  text: string;
  tables: string[][][];
  elements: { ref: string; kind: "input" | "button" | "select" | "link" | "checkbox" | "radio"; label: string; name?: string; value?: string; placeholder?: string; options?: string[]; href?: string; disabled?: boolean; readonly?: boolean }[];
  truncated: boolean;
}

/** Udalosť pre živý priebeh v rozhraní: act = čo sa práve robí, see = čo je na stránke, think = AI uvažuje, info/warn = poznámky. */
export interface LiveEvent {
  kind: "act" | "see" | "think" | "info" | "warn" | "ok";
  text: string;
  at: number;
}

const short = (s: string, n = 60) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
const hostPath = (u: string) => {
  try {
    const x = new URL(u);
    return short(`${x.hostname.replace(/^www\./, "")}${x.pathname === "/" ? "" : x.pathname}`, 70);
  } catch {
    return short(u, 70);
  }
};

/** Krátky ľudský popis snímky: titulok, tabuľky, hlásenie o výsledku hľadania. */
export function describeSnapshot(s: Snapshot): string {
  const parts: string[] = [short(s.title || hostPath(s.url), 50)];
  const empty = s.text.match(/(nena[šs]li sa [žz]iadne z[áa]znamy|zadan[ýy] v[ýy]raz nebol n[áa]jden[ýy]|neboli n[áa]jden[ée][^.]*|[žz]iadne z[áa]znamy|0 z[áa]znamov)/i)?.[0];
  const count = s.text.match(/\d+\s*[–-]\s*\d+\s*z\s*\d[\d\s]*/)?.[0] || s.text.match(/\b\d+\s+z[áa]znam(ov|y)?\b/i)?.[0];
  const data = s.tables.filter((t) => t.length > 1);
  if (data.length) parts.push(`tabuľka s ${data[0].length - 1} ${data[0].length - 1 === 1 ? "riadkom" : "riadkami"}`);
  if (count) parts.push(count.replace(/\s+/g, " ").trim());
  if (empty) parts.push(`hlásenie „${empty}“`);
  if (!data.length && !empty) {
    const inputs = s.elements.filter((e) => e.kind === "input").length;
    if (inputs) parts.push(`${inputs} ${inputs === 1 ? "pole" : inputs < 5 ? "polia" : "polí"} formulára`);
  }
  return parts.join(" · ");
}

export interface SessionLog {
  at: string;
  action: string;
  url?: string;
  ok: boolean;
  note?: string;
  /** Stabilný popis prvku (name / popis / druh) – z neho sa dá postup zopakovať bez AI */
  target?: { kind?: string; name?: string; label?: string; placeholder?: string };
  value?: string;
}

export { describeStep } from "./steps";

/** Záznam stránky počas sedenia (na diagnostiku AI overení a prevod na automatický dopyt). */
export interface PageTrace {
  url: string;
  title: string;
  elements: string[];
  tables: string[][][];
  text: string;
}

const MAX_TEXT = 7000;
const MAX_ELEMENTS = 80;
const NAV_TIMEOUT = 25000;

/**
 * Spustenie prehliadača. Každé sedenie má vlastnú inštanciu: Chromium pre serverless (@sparticuz, režim --single-process) po zavretí
 * kontextu padá („Target page, context or browser has been closed“, ERR_INSUFFICIENT_RESOURCES), takže zdieľanie medzi sedeniami nie je bezpečné.
 * Binárka sa rozbalí do /tmp len raz, ďalšie spustenia trvajú ~1 s.
 */
/**
 * Rozbalenie Chromia (@sparticuz) len raz na inštanciu: pri súbežných volaniach v jednej inštancii (Fluid compute) sa inak
 * rozbaľoval naraz viackrát a spustenie padalo na „spawn ETXTBSY“ (súbor sa ešte zapisoval). Záťažová skúška 6. 10. 2026.
 */
let sparticuz: Promise<{ executablePath: string; args: string[] }> | null = null;
function sparticuzChromium() {
  sparticuz ??= (async () => {
    const chromium = (await import("@sparticuz/chromium")).default;
    return { executablePath: await chromium.executablePath(), args: chromium.args };
  })().catch((e) => {
    sparticuz = null;
    throw e;
  });
  return sparticuz;
}

/** Najviac BROWSER_MAX_PER_INSTANCE prehliadačov naraz v jednej inštancii (predvolene 3) – ďalšie čakajú, aby si nekonkurovali o CPU a pamäť. */
let running = 0;
const waiting: (() => void)[] = [];
const maxPerInstance = () => Number(process.env.BROWSER_MAX_PER_INSTANCE) || 3;
async function slot(): Promise<() => void> {
  if (running >= maxPerInstance()) await new Promise<void>((r) => waiting.push(r));
  running++;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    running--;
    waiting.shift()?.();
  };
}

async function launchRaw(): Promise<Browser> {
  const pw = await import("playwright-core");
  if (process.env.BROWSER_WS_ENDPOINT) return pw.chromium.connectOverCDP(process.env.BROWSER_WS_ENDPOINT, { timeout: 20000 });
  if (process.env.CHROMIUM_PATH) return pw.chromium.launch({ executablePath: process.env.CHROMIUM_PATH, headless: true, args: ["--no-sandbox", "--disable-dev-shm-usage"] });
  if (process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME) {
    const { executablePath, args } = await sparticuzChromium();
    try {
      return await pw.chromium.launch({ executablePath, headless: true, args: [...args, "--lang=sk-SK"] });
    } catch (e) {
      // binárka sa ešte dopisuje (iná inštancia procesu) – jeden opakovaný pokus
      if (!/ETXTBSY/.test((e as Error).message)) throw e;
      await new Promise((r) => setTimeout(r, 400));
      return pw.chromium.launch({ executablePath, headless: true, args: [...args, "--lang=sk-SK"] });
    }
  }
  return pw.chromium.launch({ headless: true });
}

/** Spustenie prehliadača so slotom – slot sa uvoľní pri zatvorení prehliadača. */
async function launch(): Promise<Browser> {
  const release = await slot();
  try {
    const b = await launchRaw();
    b.on("disconnected", release);
    const close = b.close.bind(b);
    b.close = async (...a: Parameters<Browser["close"]>) => {
      release();
      return close(...a);
    };
    return b;
  } catch (e) {
    release();
    throw e;
  }
}

/** Je prehliadač k dispozícii? (vyskúša spustenie; výsledok sa použije v nastavení AI a diagnostike) */
export async function browserAvailable(): Promise<{ ok: boolean; mode: string; error?: string; version?: string }> {
  const mode = process.env.BROWSER_WS_ENDPOINT ? "vzdialený (CDP)" : process.env.CHROMIUM_PATH ? "lokálny (CHROMIUM_PATH)" : process.env.VERCEL ? "Vercel (@sparticuz/chromium)" : "Playwright";
  if (process.env.BROWSER_DISABLED === "1") return { ok: false, mode, error: "vypnuté (BROWSER_DISABLED=1)" };
  try {
    const b = await launch();
    const version = b.version();
    await b.close().catch(() => {});
    return { ok: true, mode, version };
  } catch (e) {
    return { ok: false, mode, error: (e as Error).message.split("\n")[0].slice(0, 300) };
  }
}

/**
 * Skript snímky bežiaci v stránke – ako reťazec, aby ho bundler/transpiler neupravoval (esbuild vkladá pomocné __name,
 * ktoré v prehliadači neexistuje).
 */
const SNAPSHOT_BODY = `
  const maxEl = args.maxEl;
  const visible = (el) => {
    const r = el.getBoundingClientRect();
    const st = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && st.visibility !== "hidden" && st.display !== "none";
  };
  const clean = (s) => (s || "").replace(/\\s+/g, " ").trim();
  const labelFor = (el) => {
    const id = el.getAttribute("id");
    const byFor = id ? document.querySelector('label[for="' + CSS.escape(id) + '"]') : null;
    const lb = el.getAttribute("aria-labelledby");
    const aria = el.getAttribute("aria-label") || (lb && document.getElementById(lb) ? clean(document.getElementById(lb).textContent) : "");
    const wrap = el.closest("label");
    const prev = el.previousElementSibling;
    const prevText = prev && /^(label|span|b|strong|td|th|div)$/i.test(prev.tagName) && (prev.textContent || "").length < 80 ? prev.textContent : "";
    // tabuľkový formulár (ASP.NET a pod.): popis je v predchádzajúcej bunke riadku
    const td = el.closest("td, th");
    const prevCell = td && td.previousElementSibling && (td.previousElementSibling.textContent || "").trim().length < 80 ? td.previousElementSibling.textContent : "";
    // text tesne pred poľom v tom istom rodičovi (napr. „IČO: <input>“)
    let before = "";
    for (let n = el.previousSibling; n && !before; n = n.previousSibling) if (n.nodeType === 3 && (n.textContent || "").trim()) before = n.textContent;
    return clean((byFor && byFor.textContent) || aria || (wrap && wrap.textContent) || el.getAttribute("title") || prevText || prevCell || (before.length < 80 ? before : "")).slice(0, 80);
  };
  document.querySelectorAll("[data-oi-ref]").forEach((e) => e.removeAttribute("data-oi-ref"));
  const els = [];
  let n = 0;
  const nodes = Array.from(document.querySelectorAll("input, textarea, select, button, [role=button], a[href], [role=link], [onclick]"));
  for (const el of nodes) {
    if (els.length >= maxEl) break;
    if (!visible(el)) continue;
    const tag = el.tagName.toLowerCase();
    const type = (el.getAttribute("type") || "").toLowerCase();
    if (tag === "input" && type === "hidden") continue;
    const ref = "e" + (++n);
    el.setAttribute("data-oi-ref", ref);
    const name = el.getAttribute("name") || el.getAttribute("id") || undefined;
    if (tag === "input" && (type === "checkbox" || type === "radio")) {
      els.push({ ref, kind: type, label: labelFor(el) || name || "", name, value: el.checked ? "zaškrtnuté" : "nezaškrtnuté", disabled: el.disabled || undefined });
    } else if (tag === "input" || tag === "textarea") {
      if (type === "submit" || type === "button" || type === "image") els.push({ ref, kind: "button", label: clean(el.value || el.getAttribute("title")) || name || "odoslať", name });
      else els.push({ ref, kind: "input", label: labelFor(el), name, placeholder: el.getAttribute("placeholder") || undefined, value: clean(el.value).slice(0, 80) || undefined, disabled: el.disabled || undefined, readonly: el.readOnly || undefined });
    } else if (tag === "select") {
      els.push({ ref, kind: "select", label: labelFor(el), name, value: clean(el.selectedOptions[0] ? el.selectedOptions[0].textContent : ""), options: Array.from(el.options).slice(0, 30).map((o) => clean(o.textContent)) });
    } else if (tag === "button" || el.getAttribute("role") === "button" || el.hasAttribute("onclick")) {
      const label = clean(el.textContent || el.getAttribute("aria-label") || el.getAttribute("title")).slice(0, 80);
      if (!label && !el.querySelector("svg, img, i")) continue;
      els.push({ ref, kind: "button", label: label || "(ikona)", name });
    } else {
      const label = clean(el.textContent || el.getAttribute("aria-label") || el.getAttribute("title")).slice(0, 80);
      if (!label) continue;
      els.push({ ref, kind: "link", label, href: el.href });
    }
  }
  const tables = Array.from(document.querySelectorAll("table"))
    .filter(visible)
    .slice(0, 6)
    .map((t) => Array.from(t.querySelectorAll("tr")).slice(0, 40).map((tr) => Array.from(tr.querySelectorAll("th, td")).slice(0, 8).map((c) => clean(c.textContent).slice(0, 120))))
    .filter((rows) => rows.length);
  const main = document.querySelector("main, [role=main], #content, .content, #main") || document.body;
  const text = clean(main.innerText || main.textContent || "");
  return { title: document.title, text, tables, els };
`;
// eslint-disable-next-line @typescript-eslint/no-implied-eval
const SNAPSHOT_FN = new Function("args", SNAPSHOT_BODY) as (args: { maxEl: number }) => unknown;

export class BrowserSession {
  private ctx!: BrowserContext;
  page!: Page;
  readonly log: SessionLog[] = [];
  /** Živý priebeh pre rozhranie (nastaví volajúci) */
  onEvent?: (e: LiveEvent) => void;
  private lastSnap?: Snapshot;
  private lastSeen = "";
  readonly visited = new Set<string>();
  /** Texty všetkých zobrazených snímok – server podľa nich nezávisle kontroluje tvrdenia modelu. */
  readonly texts: { url: string; text: string }[] = [];
  /** Stručné snímky navštívených stránok (max. 15) */
  readonly pages: PageTrace[] = [];
  /** Vyplnil a odoslal sa formulár? (podmienka pre „bez záznamu“) */
  searched = false;
  private filled = false;

  constructor(private allowedHosts: string[]) {}

  private browser!: Browser;
  /** Adresa proxy, ak kontext ide cez ňu (register blokuje dátové centrá) */
  proxied?: string;

  /**
   * @param startUrl prvá stránka – o proxy rozhoduje jej hostiteľ (napr. OV na obchodnyvestnik.justice.gov.sk ide priamo, aj keď
   * agent smie aj na justice.gov.sk); bez nej rozhodujú povolené domény.
   */
  static async open(allowedHosts: string[], startUrl?: string): Promise<BrowserSession> {
    const s = new BrowserSession(allowedHosts);
    const b = await launch();
    s.browser = b;
    // registre blokujúce dátové centrá → kontext prehliadača cez proxy (Administrácia → Prístupy k registrom)
    const { getProxyConfig, needsProxy } = await import("../access");
    const px = await getProxyConfig().catch(() => null);
    let startHost = "";
    try {
      startHost = startUrl ? new URL(startUrl).hostname : "";
    } catch {}
    const useProxy = px && (startHost ? needsProxy(startHost, px.domains) : allowedHosts.some((h) => needsProxy(h, px.domains)));
    if (useProxy) s.proxied = px!.server;
    s.ctx = await b.newContext({
      ...(useProxy ? { proxy: { server: px!.server, username: px!.username, password: px!.password } } : {}),
      locale: "sk-SK",
      timezoneId: "Europe/Bratislava",
      userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36",
      viewport: { width: 1280, height: 900 },
      ignoreHTTPSErrors: true,
    });
    s.ctx.setDefaultTimeout(NAV_TIMEOUT);
    s.page = await s.ctx.newPage();
    // Zbytočné zdroje nenačítavame (rýchlosť, menej blokovania)
    await s.page.route("**/*", (route) => {
      const t = route.request().resourceType();
      if (t === "image" || t === "media" || t === "font") return route.abort();
      return route.continue();
    });
    return s;
  }

  hostAllowed(url: string): boolean {
    try {
      const h = new URL(url).hostname.replace(/^www\./, "");
      return this.allowedHosts.some((a) => {
        const d = a.replace(/^www\./, "");
        return h === d || h.endsWith(`.${d}`);
      });
    } catch {
      return false;
    }
  }

  private record(action: string, ok: boolean, note?: string, extra?: Pick<SessionLog, "target" | "value">) {
    this.log.push({ at: new Date().toISOString(), action, url: this.page.url(), ok, note, ...(extra || {}) });
    if (!ok) this.say("warn", `Nepodarilo sa: ${short(note || action, 120)}`);
  }

  say(kind: LiveEvent["kind"], text: string) {
    try {
      this.onEvent?.({ kind, text, at: Date.now() });
    } catch {
      /* klient sa odpojil */
    }
  }

  private targetOf(ref: string): SessionLog["target"] {
    const e = this.lastSnap?.elements.find((x) => x.ref === ref);
    return e ? { kind: e.kind, name: e.name, label: e.label || undefined, placeholder: e.placeholder } : undefined;
  }

  /** Popis prvku podľa poslednej snímky (pre ľudský text), napr. pole „IČO“. */
  labelOf(ref: string): string {
    const e = this.lastSnap?.elements.find((x) => x.ref === ref);
    if (!e) return ref;
    return short(e.label || e.placeholder || e.name || ref, 50);
  }

  private async settle() {
    await this.page.waitForLoadState("domcontentloaded").catch(() => {});
    await this.page.waitForLoadState("networkidle", { timeout: 8000 }).catch(() => {});
    await this.page.waitForTimeout(400);
  }

  async open(url: string): Promise<Snapshot> {
    if (!this.hostAllowed(url)) {
      this.record(`open ${url}`, false, "doména nie je povolená");
      throw new Error(`Doména nie je povolená: ${url}. Povolené: ${this.allowedHosts.join(", ")}`);
    }
    this.say("act", `Otváram ${hostPath(url)}`);
    try {
      await this.page.goto(url, { waitUntil: "domcontentloaded", timeout: NAV_TIMEOUT });
    } catch (e) {
      this.record(`open ${url}`, false, (e as Error).message.split("\n")[0]);
      throw new Error(`Stránku sa nepodarilo otvoriť: ${(e as Error).message.split("\n")[0]}`);
    }
    await this.settle();
    this.record(`open ${url}`, true);
    return this.snapshot();
  }

  private locator(ref: string) {
    if (!/^e\d{1,3}$/.test(ref)) throw new Error(`Neplatná značka prvku „${ref}“ – použi značky zo snímky (e1, e2 …).`);
    return this.page.locator(`[data-oi-ref="${ref}"]`).first();
  }

  async fill(ref: string, text: string): Promise<Snapshot> {
    const el = this.locator(ref);
    this.say("act", `Vypĺňam pole „${this.labelOf(ref)}“: ${short(text, 40)}`);
    try {
      await el.scrollIntoViewIfNeeded({ timeout: 2000 }).catch(() => {});
      // neaktívne pole sa nevyplní (prehliadač by ho ani neodoslal) – rýchla a zrozumiteľná chyba namiesto 8 s čakania
      const st = await el.evaluate((n: any) => ({ disabled: Boolean(n.disabled), readonly: Boolean(n.readOnly) })).catch(() => ({ disabled: false, readonly: false }));
      if (st.disabled) throw new Error("pole je neaktívne (disabled) – najprv zvoľ prepínač alebo možnosť, ktorá ho povolí");
      try {
        if (st.readonly) throw new Error("readonly");
        await el.fill(text, { timeout: 3000 });
      } catch {
        // pole len na čítanie (výber dátumu) alebo zakryté iným prvkom: hodnota sa nastaví skriptom s udalosťami input/change
        await el.evaluate((n: any, v: string) => {
          n.value = v;
          n.dispatchEvent(new Event("input", { bubbles: true }));
          n.dispatchEvent(new Event("change", { bubbles: true }));
        }, text);
      }
      this.filled = true;
      this.record(`fill ${ref} ← ${text}`, true, undefined, { target: this.targetOf(ref), value: text });
    } catch (e) {
      this.record(`fill ${ref}`, false, (e as Error).message.split("\n")[0], { target: this.targetOf(ref), value: text });
      throw new Error(`Pole ${ref} sa nepodarilo vyplniť: ${(e as Error).message.split("\n")[0]}`);
    }
    await this.page.waitForTimeout(300);
    return this.snapshot();
  }

  async click(ref: string): Promise<Snapshot> {
    const el = this.locator(ref);
    this.say("act", `Klikám na „${this.labelOf(ref)}“`);
    try {
      const href = await el.getAttribute("href").catch(() => null);
      if (href) {
        const abs = new URL(href, this.page.url()).toString();
        if (!this.hostAllowed(abs)) throw new Error(`odkaz vedie mimo povolených domén (${abs})`);
      }
      await el.scrollIntoViewIfNeeded({ timeout: 2000 }).catch(() => {});
      try {
        await Promise.all([this.page.waitForLoadState("domcontentloaded", { timeout: 3000 }).catch(() => {}), el.click({ timeout: 4000 })]);
      } catch {
        // prvok zakrytý (lišta cookies, prekrytie) – klik skriptom
        await el.evaluate((n: any) => n.click());
      }
      if (this.filled) this.searched = true;
      this.record(`click ${ref}`, true, undefined, { target: this.targetOf(ref) });
    } catch (e) {
      this.record(`click ${ref}`, false, (e as Error).message.split("\n")[0], { target: this.targetOf(ref) });
      throw new Error(`Na prvok ${ref} sa nepodarilo kliknúť: ${(e as Error).message.split("\n")[0]}`);
    }
    await this.settle();
    return this.snapshot();
  }

  /**
   * Klik na odkaz podľa presného textu (napr. stránkovanie „2“, „100“) – aj keď je mimo prvých prvkov snímky.
   * Pre skriptované dopyty; model používa značky zo snímky.
   */
  async clickLinkText(text: string): Promise<Snapshot> {
    const el = this.page.getByRole("link", { name: text, exact: true }).first();
    this.say("act", `Klikám na „${text}“`);
    try {
      await el.click({ timeout: 4000 });
      this.record(`click „${text}“`, true, undefined, { target: { kind: "link", label: text } });
    } catch (e) {
      this.record(`click „${text}“`, false, (e as Error).message.split("\n")[0], { target: { kind: "link", label: text } });
      throw new Error(`Odkaz „${text}“ sa nepodarilo otvoriť: ${(e as Error).message.split("\n")[0]}`);
    }
    await this.settle();
    return this.snapshot();
  }

  async pressEnter(ref: string): Promise<Snapshot> {
    const el = this.locator(ref);
    this.say("act", `Odosielam formulár (Enter v poli „${this.labelOf(ref)}“)`);
    try {
      await el.press("Enter", { timeout: 8000 });
      if (this.filled) this.searched = true;
      this.record(`enter ${ref}`, true, undefined, { target: this.targetOf(ref) });
    } catch (e) {
      this.record(`enter ${ref}`, false, (e as Error).message.split("\n")[0]);
      throw new Error(`Enter v poli ${ref} zlyhal: ${(e as Error).message.split("\n")[0]}`);
    }
    await this.settle();
    return this.snapshot();
  }

  async select(ref: string, value: string): Promise<Snapshot> {
    const el = this.locator(ref);
    this.say("act", `Vyberám „${short(value, 40)}“ v „${this.labelOf(ref)}“`);
    try {
      await el.selectOption({ label: value }, { timeout: 8000 }).catch(async () => el.selectOption(value, { timeout: 8000 }));
      this.record(`select ${ref} = ${value}`, true, undefined, { target: this.targetOf(ref), value });
    } catch (e) {
      this.record(`select ${ref}`, false, (e as Error).message.split("\n")[0]);
      throw new Error(`Výber v ${ref} zlyhal: ${(e as Error).message.split("\n")[0]}`);
    }
    await this.page.waitForTimeout(300);
    return this.snapshot();
  }

  async wait(ms: number): Promise<Snapshot> {
    this.say("act", "Čakám, kým sa načítajú výsledky…");
    await this.page.waitForTimeout(Math.min(8000, Math.max(200, ms)));
    await this.settle();
    this.record(`wait ${ms}`, true);
    return this.snapshot();
  }

  /** Kompaktná snímka stránky pre model. */
  async snapshot(): Promise<Snapshot> {
    const url = this.page.url();
    this.visited.add(url);
    const raw = (await this.page.evaluate(SNAPSHOT_FN, { maxEl: MAX_ELEMENTS })) as { title: string; text: string; tables: string[][][]; els: Snapshot["elements"] };
    const truncated = raw.text.length > MAX_TEXT;
    const snap: Snapshot = { url, title: raw.title, text: raw.text.slice(0, MAX_TEXT), tables: raw.tables, elements: raw.els, truncated };
    this.texts.push({ url, text: raw.text.slice(0, 60000) });
    const trace: PageTrace = {
      url,
      title: raw.title,
      elements: raw.els.slice(0, 40).map((e) => [e.kind, e.label || "", e.name ? `name=${e.name}` : "", e.placeholder ? `placeholder=${e.placeholder}` : "", e.value ? `=${e.value}` : "", e.disabled ? "disabled" : "", e.readonly ? "readonly" : "", e.options ? `[${e.options.slice(0, 8).join("|")}]` : ""].filter(Boolean).join(" ")),
      tables: raw.tables.slice(0, 3).map((t) => t.slice(0, 12)),
      text: raw.text.slice(0, 2500),
    };
    const prevT = this.pages[this.pages.length - 1];
    if (!prevT || prevT.url !== trace.url || prevT.text !== trace.text) {
      this.pages.push(trace);
      if (this.pages.length > 15) this.pages.splice(1, 1); // prvú (vstupnú) stránku ponecháme
    }
    this.lastSnap = snap;
    const seen = describeSnapshot(snap);
    if (seen !== this.lastSeen) {
      this.lastSeen = seen;
      this.say("see", `Na stránke: ${seen}`);
    }
    return snap;
  }

  async close() {
    await this.ctx?.close().catch(() => {});
    await this.browser?.close().catch(() => {});
  }
}

/** Snímka ako text pre model (úsporne). */
export function renderSnapshot(s: Snapshot): string {
  const lines: string[] = [`ADRESA: ${s.url}`, `TITULOK: ${s.title}`];
  if (s.elements.length) {
    lines.push("PRVKY:");
    for (const e of s.elements) {
      const parts = [`${e.ref} [${e.kind}]`, e.label || "", e.name ? `name=${e.name}` : "", e.placeholder ? `placeholder=„${e.placeholder}“` : "", e.value ? `hodnota=„${e.value}“` : "", e.options ? `možnosti: ${e.options.join(" | ")}` : "", e.href && e.kind === "link" ? `→ ${e.href}` : "", e.disabled ? "NEAKTÍVNE (najprv zvoľ prepínač, ktorý ho povolí)" : "", e.readonly ? "len na čítanie (výber dátumu – vyplní sa skriptom)" : ""];
      lines.push("  " + parts.filter(Boolean).join(" · "));
    }
  }
  if (s.tables.length) {
    lines.push("TABUĽKY:");
    s.tables.forEach((t, i) => {
      lines.push(`  tabuľka ${i + 1} (${t.length} riadkov):`);
      for (const r of t.slice(0, 25)) lines.push("    " + r.join(" | "));
      if (t.length > 25) lines.push(`    … ďalších ${t.length - 25} riadkov`);
    });
  }
  lines.push(`TEXT:${s.truncated ? " (skrátený)" : ""}`);
  lines.push(s.text);
  return lines.join("\n");
}
