import type { Metadata } from "next";
import { PRODUCT, SiteFooter, SiteHeader } from "../components/site/SiteShell";
import { REGISTERS } from "../components/site/content";

export const metadata: Metadata = {
  title: "Čo overujeme",
  description: "Sedemnásť registrov a zdrojov, ktoré aplikácia Obozretne preverí pri jednom zadaní IČO: obchodný register, Finančná správa, Sociálna poisťovňa, závierky, konkurzy, RPVS, médiá, bankové účty.",
};

export default function WhatPage() {
  return (
    <div className="site">
      <SiteHeader active="what" />
      <section className="s-band">
        <div className="s-wrap">
          <div className="s-head">
            <span className="s-eyebrow">Čo overujeme</span>
            <h1 style={{ fontSize: "clamp(28px, 3.6vw, 40px)" }}>Sedemnásť registrov a zdrojov, jeden prehľadný výsledok.</h1>
            <p>Všetky údaje pochádzajú z oficiálnych verejných registrov Slovenskej republiky a EÚ. Každý nález má v protokole odkaz na zdroj, kde si ho môžete overiť. Prioritou je priamy dodávateľ a odberateľ.</p>
          </div>
          <ul className="s-regs">
            {REGISTERS.map((r) => (
              <li key={r.name}><span>{r.name}<small>{r.src}</small></span></li>
            ))}
          </ul>
        </div>
      </section>
      <section className="s-band alt">
        <div className="s-wrap">
          <div className="s-grid">
            <div className="s-card">
              <h3>Výsledok a skóre</h3>
              <p>Každý nález má bodovú váhu; výsledok je <b>Odporúčame</b> (85 a viac), <b>S výhradou</b> (60 – 84) alebo <b>Neodporúčame</b>. Kritický nález – daňový dlh, konkurz, záporné imanie, chýbajúce závierky za dve a viac období – znamená Neodporúčame bez ohľadu na body. Neoverené a neposúdené položky nikdy nejdú v neprospech partnera.</p>
            </div>
            <div className="s-card">
              <h3>Deväť kľúčových otázok</h3>
              <p>Podala závierku a daňové priznanie? Je vedené konanie o zrušení či likvidácii? Typ a vek spoločnosti, predmet podnikania, posledná zmena vlastníka a štatutára, spoľahlivý platiteľ DPH, nedoplatky na daniach a odvodoch – odpovede sú na začiatku protokolu.</p>
            </div>
            <div className="s-card">
              <h3>Indikátory rizika obchodu</h3>
              <p>Podľa Bulletinu Slovenskej komory daňových poradcov 03/2024: predmet obchodu oproti predmetu podnikania, účet partnera v zozname Finančnej správy, cena, platby v hotovosti, preprava, sprostredkovatelia, tlak na čas. Čo z registrov zistiť nemožno, posúdi poverený zamestnanec a zapíše sa do protokolu.</p>
            </div>
          </div>
          <p style={{ color: "var(--s-muted)", marginTop: 24, fontSize: 15 }}>
            Ak IČO v Registri právnických osôb neexistuje, aplikácia {PRODUCT} preverenie zastaví – bez identifikácie subjektu sa v ďalších kontrolách nepokračuje a nič sa nezapíše do databázy preverení.
            Neverejné registre (exekúcie, zdravotné poisťovne, Obchodný vestník, diskvalifikácie, verejné obstarávanie) sú vo verzii Rozšírené ako kontrolný zoznam s odkazmi; výsledok manuálneho overenia sa premietne do skóre.
          </p>
          <div className="s-actions" style={{ marginTop: 24 }}>
            <a className="s-btn gold" href="/objednavka">Objednať pre našu firmu</a>
            <a className="s-btn ghost" href="/ako-to-funguje">Ako to funguje →</a>
          </div>
        </div>
      </section>
      <SiteFooter />
    </div>
  );
}
