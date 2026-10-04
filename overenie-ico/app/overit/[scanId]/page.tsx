import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { PRODUCT, SiteFooter, SiteHeader } from "../../components/site/SiteShell";
import { normalizeCode, SCAN_ID_RE } from "@/lib/seal";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Overenie protokolu", robots: { index: false, follow: false } };

/** Zadanie overovacieho kódu z PDF – bez neho sa o protokole nič nezobrazí (číslo protokolu je uhádnuteľné, kód nie). */
export default async function VerifyEntry({ params, searchParams }: { params: Promise<{ scanId: string }>; searchParams: Promise<{ code?: string }> }) {
  const { scanId } = await params;
  const { code } = await searchParams;
  const valid = SCAN_ID_RE.test(scanId);
  if (valid && code) redirect(`/overit/${encodeURIComponent(scanId)}/${encodeURIComponent(normalizeCode(code) || "X")}`);
  return (
    <div className="site">
      <SiteHeader active="verify" />
      <section className="s-band">
        <div className="s-wrap">
          <div className="s-article">
            <span className="s-eyebrow">Overenie protokolu</span>
            <h1 style={{ fontSize: "clamp(26px, 3.4vw, 38px)" }}>Protokol č. {scanId}</h1>
            {!valid ? (
              <div className="s-form" style={{ marginTop: 24 }}><div className="s-err">Číslo protokolu má tvar SK-IČO-RRRRMMDDHHMMSS.</div><p style={{ margin: 0 }}><a href="/overit">Zadať číslo protokolu znova →</a></p></div>
            ) : (
              <form className="s-form" style={{ marginTop: 24 }} method="get">
                <p style={{ margin: 0, color: "var(--s-muted)" }}>
                  Zadajte overovací kód vytlačený v protokole v riadku „Pečať protokolu“ (10 znakov). Bez kódu sa o protokole nič nezobrazuje –
                  chráni to informácie o obchodných vzťahoch klientov {PRODUCT}.
                </p>
                <label>Overovací kód<input name="code" required autoComplete="off" placeholder="napr. K7MQ2RT9WX" style={{ letterSpacing: "0.12em", textTransform: "uppercase", fontVariantNumeric: "tabular-nums" }} /></label>
                <div className="s-actions"><button className="s-btn">Overiť protokol</button></div>
              </form>
            )}
          </div>
        </div>
      </section>
      <SiteFooter />
    </div>
  );
}
