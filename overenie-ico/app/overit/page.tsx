import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { DOMAIN, PRODUCT, SiteFooter, SiteHeader } from "../components/site/SiteShell";
import { normalizeCode, SCAN_ID_RE } from "@/lib/seal";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Overenie protokolu",
  description: "Verejné overenie pravosti protokolu o preverení obchodného partnera: zadajte číslo protokolu a overovací kód z riadku „Pečať protokolu“.",
};

const normalizeId = (s: string) => (s || "").trim().toUpperCase().replace(/\s+/g, "").replace(/^Č\.?/, "");

/**
 * Verejný vstup na overenie protokolu – pre správcu dane, audítora či obchodného partnera, ktorý má protokol v ruke.
 * Číslo protokolu a overovací kód sú vytlačené v PDF; bez správnej dvojice sa o protokole nič nezobrazí.
 */
export default async function VerifyIndex({ searchParams }: { searchParams: Promise<{ id?: string; code?: string }> }) {
  const { id, code } = await searchParams;
  const scanId = normalizeId(id || "");
  const bad = !!id && !SCAN_ID_RE.test(scanId);
  if (scanId && SCAN_ID_RE.test(scanId) && code) redirect(`/overit/${encodeURIComponent(scanId)}/${encodeURIComponent(normalizeCode(code) || "X")}`);
  if (scanId && SCAN_ID_RE.test(scanId)) redirect(`/overit/${encodeURIComponent(scanId)}`);
  return (
    <div className="site">
      <SiteHeader />
      <section className="s-band">
        <div className="s-wrap">
          <div className="s-article">
            <span className="s-eyebrow">Overenie protokolu</span>
            <h1 style={{ fontSize: "clamp(26px, 3.4vw, 38px)" }}>Overte pravosť protokolu o preverení</h1>
            <p className="s-lead" style={{ marginTop: 14 }}>
              Každý protokol z aplikácie {PRODUCT} je pri uložení zapečatený: server vypočíta odtlačok jeho obsahu (SHA-256) a zapíše ho spolu s presným časom.
              Tu si ktokoľvek – správca dane, audítor či obchodný partner – overí, že protokol s daným číslom v systéme vznikol, kedy prebehlo preverenie,
              kedy bol zapečatený a že jeho obsah nebol odvtedy zmenený.
            </p>
            <form className="s-form" style={{ marginTop: 24 }} method="get">
              <div className="row">
                <label>
                  Číslo protokolu
                  <input name="id" required autoComplete="off" defaultValue={id || ""} placeholder="SK-12345678-20261004093015" style={{ fontVariantNumeric: "tabular-nums" }} />
                </label>
                <label>
                  Overovací kód
                  <input name="code" required autoComplete="off" placeholder="napr. K7MQ2RT9WX" style={{ letterSpacing: "0.12em", textTransform: "uppercase" }} />
                </label>
              </div>
              {bad && <div className="s-err">Číslo protokolu má tvar SK-IČO-RRRRMMDDHHMMSS, napríklad SK-12345678-20261004093015.</div>}
              <p style={{ margin: 0, color: "var(--s-muted)", fontSize: 14 }}>
                Obidva údaje sú vytlačené v protokole: číslo v hlavičke, overovací kód (10 znakov) v riadku „Pečať protokolu“ spolu s adresou {DOMAIN}/overit/…
                Bez správneho kódu sa o protokole nič nezobrazuje – ani to, či existuje; chráni to informácie o obchodných vzťahoch klientov.
              </p>
              <div className="s-actions"><button className="s-btn gold">Overiť protokol</button></div>
            </form>
            <h2 style={{ marginTop: 40 }}>Čo overenie ukáže</h2>
            <ul>
              <li><b>Čas preverenia</b> – kedy poverený zamestnanec partnera v registroch preveril (čas servera, nie čas z počítača používateľa).</li>
              <li><b>Čas zapečatenia</b> – kedy bol protokol uložený do PDF; ak sa obsah neskôr zmenil a protokol vytlačil znova, pribudla ďalšia pečať s vlastným časom a odtlačkom.</li>
              <li><b>Odtlačok SHA-256</b> – porovnajte ho s odtlačkom vytlačeným v PDF. Zhoda znamená, že obsah protokolu je presne ten, ktorý bol zapečatený.</li>
              <li><b>Výsledok a skóre</b> k času preverenia; pri spätnom preverení aj rozhodný dátum začiatku spolupráce. Osobné údaje sa nezobrazujú.</li>
            </ul>
            <p style={{ fontSize: 13, color: "var(--s-muted)" }}>
              Pečať je časová stopa prvej úrovne (odtlačok + čas servera). Pripravené je doplnenie kvalifikovanej elektronickej časovej pečiatky podľa eIDAS od certifikovaného poskytovateľa.
            </p>
          </div>
        </div>
      </section>
      <SiteFooter />
    </div>
  );
}
