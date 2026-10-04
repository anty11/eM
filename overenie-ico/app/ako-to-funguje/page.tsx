import type { Metadata } from "next";
import { PRODUCT, SiteFooter, SiteHeader } from "../components/site/SiteShell";
import { STEPS } from "../components/site/content";

export const metadata: Metadata = {
  title: "Ako to funguje",
  description: "Zadáte IČO, registre odpovedajú priebežne, dostanete výsledok a uložíte zapečatený protokol. Overenie vykonáva vaša spoločnosť sama prostredníctvom poverených zamestnancov.",
};

export default function HowPage() {
  return (
    <div className="site">
      <SiteHeader active="how" />
      <section className="s-band">
        <div className="s-wrap">
          <div className="s-head">
            <span className="s-eyebrow">Ako to funguje</span>
            <h1 style={{ fontSize: "clamp(28px, 3.6vw, 40px)" }}>Overenie vykoná vaša spoločnosť sama. Trvá pol minúty.</h1>
            <p>Nie je potrebný externý poradca – overenie vykonajú vaši poverení zamestnanci priamo v klientskej sekcii. Každé preverenie je zaznamenané: kto, kedy a s akým výsledkom.</p>
          </div>
          <div className="s-steps">
            {STEPS.map((s) => (
              <div className="s-step" key={s.title}><h3>{s.title}</h3><p>{s.text}</p></div>
            ))}
          </div>
        </div>
      </section>
      <section className="s-band alt">
        <div className="s-wrap">
          <div className="s-grid">
            <div className="s-card">
              <h3>Poverení zamestnanci</h3>
              <p>Administrátor vo vašej firme pridá zamestnancov podľa e-mailu; každý dostane jednorazový kód a nastaví si heslo. Protokol nesie meno zamestnanca, ktorý preverenie vykonal – e-maily sa vo výstupoch neuvádzajú.</p>
            </div>
            <div className="s-card">
              <h3>Pečať a overenie protokolu</h3>
              <p>Pri uložení PDF sa z obsahu protokolu vypočíta odtlačok SHA-256 a zapíše sa s presným časom. V protokole je odtlačok, overovací kód a adresa, kde si ktokoľvek – aj správca dane – overí, že protokol s týmto obsahom v danom čase vznikol. Bez kódu z protokolu sa nič nezobrazí.</p>
            </div>
            <div className="s-card">
              <h3>Databáza preverení</h3>
              <p>Každá preverená spoločnosť sa uloží do zoznamu spoločného pre celú firmu: kto, kedy, s akým výsledkom. Po 180 dňoch od posledného preverenia zoznam upozorní a jedným klikom preveríte znova.</p>
            </div>
            <div className="s-card">
              <h3>Existujúca spolupráca (Rozšírené)</h3>
              <p>Pri partneroch, s ktorými spolupracujete dlhšie, zadáte dátum začiatku spolupráce. Protokol doplní, čo bolo k tomu dňu zistiteľné z obchodného registra, závierok, registra úpadcov a médií – a výslovne uvedie, čo k tomu dňu overiť nemožno. Dátum vyhotovenia je vždy skutočný.</p>
            </div>
            <div className="s-card">
              <h3>Neverejné registre (Rozšírené)</h3>
              <p>Exekúcie, zdravotné poisťovne, Obchodný vestník, diskvalifikácie a verejné obstarávanie nemajú verejné rozhranie. Aplikácia pripraví presný odkaz, poverený zamestnanec výsledok označí a verdikt sa prepočíta.</p>
            </div>
            <div className="s-card">
              <h3>Údaje a bezpečnosť</h3>
              <p>Aplikácia {PRODUCT} pracuje s údajmi o právnických osobách a podnikateľoch z verejných registrov. Osobné údaje spracúva len v rozsahu prihlásenia zamestnancov a kontaktov, ktoré si k partnerovi sami zapíšete. Dáta sú uložené v EÚ.</p>
            </div>
          </div>
          <div className="s-actions" style={{ marginTop: 24 }}>
            <a className="s-btn gold" href="/objednavka">Objednať pre našu firmu</a>
            <a className="s-btn ghost" href="/pre-koho">Pre koho →</a>
          </div>
        </div>
      </section>
      <SiteFooter />
    </div>
  );
}
