import type { Metadata } from "next";
import { headers } from "next/headers";
import { DOMAIN, PRODUCT, SiteFooter, SiteHeader } from "../../../components/site/SiteShell";
import { listSeals, normalizeCode, SCAN_ID_RE, shortHash, verifyRateLimited } from "@/lib/seal";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Overenie protokolu", robots: { index: false, follow: false } };

const VERDICT: Record<string, string> = {
  recommended: "ODPORÚČAME – bezpečný obchodný partner",
  caution: "S VÝHRADOU – zvýšená opatrnosť",
  not_recommended: "NEODPORÚČAME – rizikový subjekt",
};
const fmt = (iso: string) => new Date(iso).toLocaleString("sk-SK", { dateStyle: "long", timeStyle: "medium", timeZone: "Europe/Bratislava" });

/**
 * Verejná overovacia stránka protokolu (číslo + overovací kód z PDF): kedy preverenie prebehlo, kedy bol protokol zapečatený, odtlačky.
 * Bez správneho kódu sa nezobrazí nič – ani existencia protokolu. Bez osobných údajov.
 */
export default async function VerifyPage({ params }: { params: Promise<{ scanId: string; code: string }> }) {
  const { scanId, code: rawCode } = await params;
  const code = normalizeCode(decodeURIComponent(rawCode));
  const ip = ((await headers()).get("x-forwarded-for") || "").split(",")[0].trim() || "neznáma";
  const limited = await verifyRateLimited(ip);
  const seals = !limited && SCAN_ID_RE.test(scanId) ? await listSeals(scanId, code) : [];
  const first = seals[0];
  return (
    <div className="site">
      <SiteHeader />
      <section className="s-band">
        <div className="s-wrap">
          <div className="s-article">
            <span className="s-eyebrow">Overenie protokolu</span>
            <h1 style={{ fontSize: "clamp(26px, 3.4vw, 38px)" }}>Protokol č. {scanId}</h1>
            {!first ? (
              <div className="s-form" style={{ marginTop: 24 }}>
                <div className="s-err">
                  {limited
                    ? "Príliš veľa pokusov z tejto adresy. Skúste to o hodinu."
                    : "Protokol s týmto číslom a overovacím kódom sa nenašiel. Skontrolujte číslo aj kód z riadku „Pečať protokolu“ v PDF. Protokoly vytlačené pred zavedením pečatí sa dajú overiť len v audite aplikácie."}
                </div>
                <div><a className="s-btn ghost" href={`/overit/${encodeURIComponent(scanId)}`}>Zadať kód znova</a></div>
              </div>
            ) : (
              <>
                <p className="s-lead" style={{ marginTop: 14 }}>
                  Preverenie spoločnosti <b>{first.company || "–"}</b> (IČO {first.ico}) prebehlo v aplikácii {PRODUCT} <b>{fmt(first.scannedAt)}</b>{first.orgName ? <> – vykonala ho spoločnosť <b>{first.orgName}</b></> : null}.
                  {first.asOf && <> Ide o <b>spätné preverenie</b> k rozhodnému dátumu začiatku spolupráce {new Date(first.asOf).toLocaleDateString("sk-SK")} – protokol bol vyhotovený až v uvedenom čase preverenia.</>}
                  {" "}Protokol bol zapečatený {seals.length === 1 ? "raz" : `${seals.length}×`}; porovnajte odtlačok vytlačený v PDF s odtlačkom nižšie –
                  zhoda potvrdzuje, že obsah protokolu je od času pečate nezmenený.
                </p>
                <div className="s-compare-wrap" style={{ marginTop: 24 }}>
                  <table className="s-compare" style={{ minWidth: 0 }}>
                    <thead>
                      <tr><th className="feat"><span>Pečať</span></th><th className="feat"><span>Zapečatené</span></th><th className="feat"><span>Výsledok</span></th><th className="feat"><span>Odtlačok SHA-256</span></th></tr>
                    </thead>
                    <tbody>
                      {seals.map((s) => (
                        <tr key={s.seq}>
                          <td className="feat">#{s.seq}</td>
                          <td className="feat">{fmt(s.sealedAt)}</td>
                          <td className="feat">{VERDICT[s.verdict] || s.verdict} · {s.score}/100</td>
                          <td className="feat"><code style={{ fontSize: 12, wordBreak: "break-all" }}>{s.hash}</code><small>v protokole: {shortHash(s.hash)}</small></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <p style={{ fontSize: 13, color: "var(--s-muted)", marginTop: 20 }}>
                  Odtlačok je SHA-256 z úplného obsahu protokolu (výsledky registrov, kľúčové otázky, údaje o obchode, karta kontaktu, poznámka, meno vypracovateľa) a je zapísaný
                  v systéme {PRODUCT} v okamihu uloženia PDF. Čas je serverový čas prevádzkovateľa; {first.tsa ? `kvalifikovaná časová pečiatka: ${first.tsa.provider}, ${fmt(first.tsa.time)}, č. ${first.tsa.serial}.` : "kvalifikovaná časová pečiatka tretej strany nie je k tomuto protokolu pripojená."}
                  {" "}Osobné údaje sa na tejto stránke neuvádzajú. Adresa na overenie: {DOMAIN}/overit/{scanId}/{code}
                </p>
              </>
            )}
          </div>
        </div>
      </section>
      <SiteFooter />
    </div>
  );
}
