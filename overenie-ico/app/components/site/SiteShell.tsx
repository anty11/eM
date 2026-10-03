import "../../site.css";

/** Údaje kancelárií zastrešujúcich projekt – jediné miesto na úpravu kontaktov. */
export const FIRMS = {
  urban: {
    name: "URBAN & PARTNERS s.r.o., advokátska kancelária",
    short: "URBAN & PARTNERS",
    tagline: "Právo v spoľahlivých rukách",
    since: 2013,
    address: "Červeňova 15, 811 03 Bratislava – Staré Mesto",
    email: "office@urbanpartners.sk",
    phone: "+421 910 557 280",
    web: "https://www.urbanpartners.sk",
    about:
      "Advokátska kancelária s tímom právnikov pre sporovú agendu, daňové, správne a trestné právo. Daňové právo a zastupovanie klientov v daňových konaniach patria medzi jej hlavné oblasti.",
  },
  lexnera: {
    name: "LEXNERA Legal, advokátska kancelária",
    short: "LEXNERA Legal",
    tagline: "Advokátska kancelária",
    address: "",
    email: "",
    phone: "",
    web: "https://www.lexnera.eu",
    about:
      "Advokátska kancelária so zameraním na daňové právo a právo obchodných spoločností. Pomáha podnikateľom nastaviť procesy tak, aby obstáli pri daňovej kontrole aj pred súdom.",
  },
} as const;

export const PRODUCT = "Preverenie partnera";

export function SiteHeader({ active }: { active?: "home" | "law" | "order" }) {
  return (
    <header className="s-top">
      {/* Písma podľa webov kancelárií: Montserrat (URBAN & PARTNERS), Playfair Display (LEXNERA) */}
      <link rel="preconnect" href="https://fonts.googleapis.com" />
      <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
      <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Montserrat:wght@400;500;600;700&family=Playfair+Display:wght@400;600;700&display=swap" />
      <div className="s-wrap">
        <a className="s-brand" href="/">
          <span className="mark">§</span>
          <span>
            {PRODUCT}
            <small>overenie dodávateľa a odberateľa</small>
          </span>
        </a>
        <nav className="s-nav">
          <a href="/#preco" style={{ fontWeight: active === "home" ? 600 : 400 }}>Prečo overovať</a>
          <a href="/#co" className="sec">Čo overujeme</a>
          <a href="/pravny-zaklad" style={{ fontWeight: active === "law" ? 600 : 400 }}>Právny základ</a>
          <a href="/#kancelarie" className="sec">Kancelárie</a>
          <a href="/objednavka" className="s-btn gold" style={{ fontWeight: 700 }}>Objednať</a>
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
              Projekt zastrešujú advokátske kancelárie {u.short} a {l.short}.
            </p>
            <p style={{ margin: "10px 0 0" }}>
              <a href="/objednavka">Objednať</a> · <a href="/pravny-zaklad">Právny základ</a> · <a href="/login">Klientska sekcia</a>
            </p>
          </div>
          <div>
            <h4>{u.short}</h4>
            <div>{u.name}</div>
            <div>{u.address}</div>
            <div><a href={`mailto:${u.email}`}>{u.email}</a> · {u.phone}</div>
            <div><a href={u.web} target="_blank" rel="noreferrer">www.urbanpartners.sk</a></div>
          </div>
          <div>
            <h4>{l.short}</h4>
            <div>{l.name}</div>
            {l.address && <div>{l.address}</div>}
            {l.email && <div><a href={`mailto:${l.email}`}>{l.email}</a>{l.phone ? ` · ${l.phone}` : ""}</div>}
            <div><a href={l.web} target="_blank" rel="noreferrer">www.lexnera.eu</a></div>
          </div>
        </div>
        <div className="legal">
          © {new Date().getFullYear()} {u.short} · {l.short}. Výstup aplikácie je automatizovaný súhrn údajov z verejných registrov k času preverenia
          a nie je právnou službou ani právnym stanoviskom; nenahrádza individuálne posúdenie konkrétneho obchodného prípadu advokátom alebo daňovým poradcom.
        </div>
      </div>
    </footer>
  );
}
