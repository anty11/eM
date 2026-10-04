import "../../site.css";
import { Wordmark } from "../Logo";

export const PRODUCT = "Obozretne";
export const DOMAIN = "obozretne.sk";

/**
 * Prevádzkovateľ produktu – samostatná spoločnosť (nie advokátska kancelária).
 * Názov, IČO a kontakt doplňte po založení / rozhodnutí; zobrazujú sa v päte, na stránke objednávky a v súhlase so spracovaním údajov.
 */
export const OPERATOR = {
  name: "Obozretne s.r.o.",
  nameNote: "pracovný názov – doplní sa po zápise spoločnosti",
  email: "info@obozretne.sk",
  phone: "",
  address: "",
};

/** Advokátske kancelárie poskytujúce odbornú záštitu – na webe len popis a odkaz na ich stránky. */
export const FIRMS = {
  urban: {
    short: "URBAN & PARTNERS",
    tagline: "Advokátska kancelária",
    web: "https://www.urbanpartners.sk",
    webLabel: "www.urbanpartners.sk",
    about:
      "Advokátska kancelária so skúsenosťami zo sporovej agendy, daňového, správneho a trestného práva. Zastupuje klientov v daňových konaniach a pred súdmi – práve tam, kde sa rozhoduje o tom, či si podnikateľ svojho partnera preveril.",
  },
  lexnera: {
    short: "LEXNERA Legal",
    tagline: "Advokátska kancelária",
    web: "https://www.lexnera.eu",
    webLabel: "www.lexnera.eu",
    about:
      "Advokátska kancelária so zameraním na daňové právo a právo obchodných spoločností. Pomáha podnikateľom nastaviť interné procesy tak, aby obstáli pri daňovej kontrole aj v prípadnom súdnom konaní.",
  },
} as const;

export type NavKey = "home" | "law" | "order" | "what" | "how" | "who";

const NAV: { key: NavKey; href: string; label: string; sec?: boolean }[] = [
  { key: "home", href: "/#preco", label: "Prečo overovať" },
  { key: "what", href: "/co-overujeme", label: "Čo overujeme" },
  { key: "how", href: "/ako-to-funguje", label: "Ako to funguje", sec: true },
  { key: "who", href: "/pre-koho", label: "Pre koho", sec: true },
  { key: "law", href: "/pravny-zaklad", label: "Právny základ" },
];

/** Právne dokumenty v päte – obsah sa doplní; zatiaľ stránky s informáciou, že sa pripravujú. */
export const LEGAL_DOCS: { href: string; label: string; title: string }[] = [
  { href: "/obchodne-podmienky", label: "Obchodné podmienky", title: "Všeobecné obchodné podmienky" },
  { href: "/ochrana-osobnych-udajov", label: "Ochrana osobných údajov", title: "Zásady ochrany osobných údajov" },
  { href: "/spracovanie-udajov", label: "Zmluva o spracúvaní údajov", title: "Zmluva o spracúvaní osobných údajov (sprostredkovateľ)" },
  { href: "/cookies", label: "Cookies", title: "Informácie o súboroch cookie" },
  { href: "/pravne-upozornenie", label: "Právne upozornenie", title: "Právne upozornenie a vylúčenie zodpovednosti" },
];

export function SiteHeader({ active }: { active?: NavKey }) {
  return (
    <header className="s-top">
      {/* Písma: Montserrat (text), Playfair Display (nadpisy) */}
      <link rel="preconnect" href="https://fonts.googleapis.com" />
      <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
      <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Montserrat:wght@400;500;600;700&family=Playfair+Display:wght@400;600;700&display=swap" />
      <div className="s-wrap">
        <a className="s-brand" href="/" aria-label="Obozretne – úvod">
          <Wordmark size={26} sub="overenie obchodného partnera" />
        </a>
        <nav className="s-nav">
          {NAV.map((n) => (
            <a key={n.key} href={n.href} className={n.sec ? "sec" : undefined} aria-current={active === n.key ? "page" : undefined} style={{ fontWeight: active === n.key ? 600 : 500 }}>{n.label}</a>
          ))}
          {/* Na užších obrazovkách: skryté položky v rozbaľovacom menu */}
          <details className="s-more">
            <summary>Viac</summary>
            <div className="s-more-menu">
              {NAV.map((n) => <a key={n.key} href={n.href}>{n.label}</a>)}
            </div>
          </details>
          <a href="/objednavka" className="s-btn gold">Objednať</a>
          <a href="/login" className="s-btn ghost">Klientska sekcia</a>
        </nav>
      </div>
    </header>
  );
}

export function SiteFooter() {
  const u = FIRMS.urban;
  const l = FIRMS.lexnera;
  return (
    <footer className="s-foot">
      <div className="s-wrap">
        <div className="cols">
          <div>
            <div style={{ marginBottom: 10 }}><Wordmark size={22} onDark /></div>
            <p style={{ margin: 0 }}>
              Nástroj na overenie dodávateľa a odberateľa vo verejných registroch Slovenskej republiky s protokolom o preverení.
            </p>
            <p style={{ margin: "10px 0 0" }}>
              <a href="/objednavka">Objednať</a> · <a href="/pravny-zaklad">Právny základ</a> · <a href="/login">Klientska sekcia</a>
            </p>
          </div>
          <div>
            <h4>Kontakt</h4>
            <div><a href={`mailto:${OPERATOR.email}`}>{OPERATOR.email}</a>{OPERATOR.phone ? ` · ${OPERATOR.phone}` : ""}</div>
            <div><a href="/objednavka">Objednávka a cenová ponuka</a></div>
          </div>
          <div>
            <h4>Odborná záštita</h4>
            <div><a href={u.web} target="_blank" rel="noreferrer">{u.short}</a> – {u.webLabel}</div>
            <div><a href={l.web} target="_blank" rel="noreferrer">{l.short}</a> – {l.webLabel}</div>
          </div>
          <div>
            <h4>Právne dokumenty</h4>
            {LEGAL_DOCS.map((d) => <div key={d.href}><a href={d.href}>{d.label}</a></div>)}
          </div>
        </div>
        <div className="legal">
          © {new Date().getFullYear()} {OPERATOR.name}. Odbornú záštitu nad obsahom overenia poskytujú advokátske kancelárie {u.short} a {l.short}.
          Výstup aplikácie je automatizovaný súhrn údajov z verejných registrov k času preverenia a nie je právnou službou ani právnym stanoviskom;
          nenahrádza posúdenie konkrétneho obchodného prípadu advokátom alebo daňovým poradcom.
        </div>
      </div>
    </footer>
  );
}
