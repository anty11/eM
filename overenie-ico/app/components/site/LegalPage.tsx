import type { Metadata } from "next";
import { LEGAL_DOCS, OPERATOR, SiteFooter, SiteHeader } from "./SiteShell";

/** Spoločná šablóna právnych dokumentov v päte – zatiaľ bez obsahu, s informáciou, že sa dokument pripravuje. */
export function legalMetadata(href: string): Metadata {
  const d = LEGAL_DOCS.find((x) => x.href === href);
  return { title: d?.title || "Právne dokumenty", robots: { index: false, follow: true } };
}

export function LegalPage({ href }: { href: string }) {
  const d = LEGAL_DOCS.find((x) => x.href === href);
  return (
    <div className="site">
      <SiteHeader />
      <section className="s-band">
        <div className="s-wrap">
          <article className="s-article">
            <span className="s-eyebrow">Právne dokumenty</span>
            <h1 style={{ fontSize: "clamp(26px, 3.4vw, 38px)" }}>{d?.title || "Právny dokument"}</h1>
            <div className="s-form" style={{ marginTop: 24 }}>
              <p style={{ margin: 0, color: "var(--s-ink-2)" }}>
                Dokument sa pripravuje a bude zverejnený pred spustením služby. Do jeho zverejnenia sa vzťahy medzi {OPERATOR.name} a objednávateľom riadia zmluvou
                uzavretou na základe objednávky.
              </p>
              <p style={{ margin: 0, color: "var(--s-muted)", fontSize: 14 }}>
                Otázky k dokumentu: <a href={`mailto:${OPERATOR.email}`}>{OPERATOR.email}</a>
              </p>
            </div>
            <h2 style={{ marginTop: 36 }}>Ďalšie dokumenty</h2>
            <ul>
              {LEGAL_DOCS.filter((x) => x.href !== href).map((x) => <li key={x.href}><a href={x.href}>{x.title}</a></li>)}
            </ul>
          </article>
        </div>
      </section>
      <SiteFooter />
    </div>
  );
}
