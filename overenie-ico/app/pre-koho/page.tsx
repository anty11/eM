import type { Metadata } from "next";
import { SiteFooter, SiteHeader } from "../components/site/SiteShell";
import { AUDIENCES } from "../components/site/content";

export const metadata: Metadata = {
  title: "Pre koho",
  description: "Pre každú firmu, ktorá nakupuje alebo predáva: nový dodávateľ, odberateľ na faktúru, pravidelná kontrola stálych partnerov, daňová kontrola.",
};

export default function WhoPage() {
  return (
    <div className="site">
      <SiteHeader active="who" />
      <section className="s-band">
        <div className="s-wrap">
          <div className="s-head">
            <span className="s-eyebrow">Pre koho</span>
            <h1 style={{ fontSize: "clamp(28px, 3.6vw, 40px)" }}>Pre každú firmu, ktorá nakupuje alebo predáva.</h1>
            <p>Od prvej objednávky u nového dodávateľa po pravidelnú kontrolu stálych partnerov – a pre deň, keď príde správca dane s otázkou, čo ste o partnerovi vedeli.</p>
          </div>
          <div className="s-grid two">
            {AUDIENCES.map((a, i) => (
              <div className="s-card" key={a.title}>
                <div className="num">{i + 1}</div>
                <h3>{a.title}</h3>
                <p><b style={{ color: "var(--s-ink)" }}>{a.text}</b></p>
                <p style={{ marginTop: 10 }}>{a.more}</p>
              </div>
            ))}
          </div>
          <p style={{ color: "var(--s-muted)", marginTop: 24, fontSize: 15 }}>
            Overenie vykonáva vaša spoločnosť sama prostredníctvom poverených zamestnancov – tak, ako to judikatúra predpokladá: náležitá starostlivosť je vaša vlastná a nemožno ju delegovať. Pri rizikovom náleze alebo významnom obchode je vo verzii Rozšírené k dispozícii komunikácia s advokátom obratom (právne služby sa účtujú osobitne).
          </p>
          <div className="s-actions" style={{ marginTop: 24 }}>
            <a className="s-btn gold" href="/objednavka">Objednať pre našu firmu</a>
            <a className="s-btn ghost" href="/pravny-zaklad">Právny základ →</a>
          </div>
        </div>
      </section>
      <SiteFooter />
    </div>
  );
}
