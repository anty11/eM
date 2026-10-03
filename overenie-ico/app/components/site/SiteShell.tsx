import "../../site.css";

export const PRODUCT = "Preverto";
export const DOMAIN = "preverto.sk";

/**
 * Prevádzkovateľ produktu – samostatná spoločnosť (nie advokátska kancelária).
 * Názov, IČO a kontakt doplňte po založení / rozhodnutí; zobrazujú sa v päte, na stránke objednávky a v súhlase so spracovaním údajov.
 */
export const OPERATOR = {
  name: "Preverto s.r.o.",
  nameNote: "pracovný názov – doplní sa po zápise spoločnosti",
  email: "info@preverto.sk",
  phone: "",
  address: "",
};

/** Advokátske kancelárie poskytujúce odbornú záštitu – na webe len popis a odkaz na ich stránky. */
export const FIRMS = {
  urban: {
    short: "URBAN & PARTNERS",
    tagline: "Advokátska kancelária · Bratislava",
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

export function SiteHeader({ active }: { active?: "home" | "law" | "order" }) {
  return (
    <header className="s-top">
      {/* Písma: Montserrat (text), Playfair Display (nadpisy) */}
      <link rel="preconnect" href="https://fonts.googleapis.com" />
      <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
      <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Montserrat:wght@400;500;600;700&family=Playfair+Display:wght@400;600;700&display=swap" />
      <div className="s-wrap">
        <a className="s-brand" href="/">
          <span className="mark">§</span>
          <span>
            {PRODUCT}
            <small>prever to · overenie obchodného partnera</small>
          </span>
        </a>
        <nav className="s-nav">
          <a href="/#preco" style={{ fontWeight: active === "home" ? 600 : 500 }}>Prečo overovať</a>
          <a href="/#co" className="sec">Čo overujeme</a>
          <a href="/pravny-zaklad" style={{ fontWeight: active === "law" ? 600 : 500 }}>Právny základ</a>
          <a href="/#zastita" className="sec">O projekte</a>
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
            <h4>{PRODUCT}</h4>
            <p style={{ margin: 0 }}>
              Nástroj na overenie dodávateľa a odberateľa vo verejných registroch Slovenskej republiky s protokolom o preverení.
            </p>
            <p style={{ margin: "10px 0 0" }}>
              <a href="/objednavka">Objednať</a> · <a href="/pravny-zaklad">Právny základ</a> · <a href="/login">Klientska sekcia</a>
            </p>
          </div>
          <div>
            <h4>Prevádzkovateľ</h4>
            <div>{OPERATOR.name}</div>
            {OPERATOR.address && <div>{OPERATOR.address}</div>}
            <div><a href={`mailto:${OPERATOR.email}`}>{OPERATOR.email}</a>{OPERATOR.phone ? ` · ${OPERATOR.phone}` : ""}</div>
          </div>
          <div>
            <h4>Odborná záštita</h4>
            <div><a href={u.web} target="_blank" rel="noreferrer">{u.short}</a> – {u.webLabel}</div>
            <div><a href={l.web} target="_blank" rel="noreferrer">{l.short}</a> – {l.webLabel}</div>
          </div>
        </div>
        <div className="legal">
          © {new Date().getFullYear()} {OPERATOR.name}. Odbornú záštitu nad obsahom overenia poskytujú advokátske kancelárie {u.short} a {l.short}; prevádzkovateľ je
          samostatná spoločnosť a nie je advokátskou kanceláriou. Výstup aplikácie je automatizovaný súhrn údajov z verejných registrov k času preverenia
          a nie je právnou službou ani právnym stanoviskom; nenahrádza posúdenie konkrétneho obchodného prípadu advokátom alebo daňovým poradcom.
        </div>
      </div>
    </footer>
  );
}
