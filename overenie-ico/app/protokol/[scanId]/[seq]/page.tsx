"use client";

import { use, useEffect, useState } from "react";
import Header, { useMe } from "../../../components/Header";
import KeyFacts from "../../../components/KeyFacts";
import { withOrg } from "../../../components/org";
import { DOMAIN } from "../../../components/site/SiteShell";
import { shortHash } from "@/lib/seal-shared";
import type { Seal } from "@/lib/seal";
import { CATEGORIES, type CategoryId, type CheckResult } from "@/lib/types";

const STATUS_LABEL: Record<string, string> = {
  ok: "Bez záznamu",
  warning: "Upozornenie",
  critical: "Negatívny záznam",
  info: "Informácia",
  pending: "Overuje sa…",
  manual: "Overiť manuálne",
  error: "Zdroj nedostupný",
};
const fmt = (iso?: string | null, time = true) => (iso ? new Date(iso).toLocaleString("sk-SK", time ? { dateStyle: "long", timeStyle: "medium" } : { dateStyle: "long" }) : "–");

/**
 * Zapečatený protokol z archívu – vykreslený z uloženého obsahu (presne ten JSON, z ktorého sa počítal odtlačok).
 * Server odtlačok prepočíta; „Obsah zhodný s pečaťou“ = od zapečatenia sa nič nezmenilo. Tlač = nové PDF s tou istou pečaťou.
 */
export default function SealedProtocol({ params }: { params: Promise<{ scanId: string; seq: string }> }) {
  const { scanId, seq } = use(params);
  const me = useMe();
  const [data, setData] = useState<{ seal: Seal; doc: any; intact: boolean } | null>(null);
  const [err, setErr] = useState("");

  useEffect(() => {
    fetch(withOrg(`/api/protocol/archive/doc?scanId=${encodeURIComponent(scanId)}&seq=${encodeURIComponent(seq)}`))
      .then(async (r) => {
        const j = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(j.error || `Chyba ${r.status}`);
        setData(j);
      })
      .catch((e) => setErr((e as Error).message));
  }, [scanId, seq]);

  const doc = data?.doc;
  const p = doc?.profile || {};
  const v = doc?.verdict || {};
  const checks: CheckResult[] = doc?.checks || [];
  const grouped = (Object.keys(CATEGORIES) as CategoryId[]).map((c) => [c, checks.filter((x) => x.category === c)] as const).filter(([, l]) => l.length);
  const seal = data?.seal;

  return (
    <>
      <Header me={me} active="account" />
      <main className="wrap">
        {err && <div className="card"><div className="err">{err}</div><p><a href="/account">← Archív protokolov</a></p></div>}
        {!data && !err && <div className="card">Načítavam zapečatený protokol…</div>}
        {data && seal && (
          <>
            <div className="card no-print">
              <h2>Zapečatený protokol z archívu</h2>
              <p style={{ margin: 0 }}>
                {data.intact ? <b className="f-ok">✓ Obsah zhodný s pečaťou</b> : <b className="f-critical">✗ Obsah sa nezhoduje s odtlačkom</b>} – odtlačok SHA-256 sa
                prepočítal z uloženého obsahu. Tlač vytvorí PDF s tou istou pečaťou a overovacím kódom.
              </p>
              <div className="toolbar">
                <button className="btn" onClick={() => window.print()}>Stiahnuť PDF znova</button>
                <a className="btn ghost" href={`/overit/${seal.scanId}/${seal.code}`} target="_blank" rel="noreferrer">Verejné overenie ↗</a>
                <a className="btn ghost" href="/account">← Archív</a>
              </div>
            </div>

            <section className={`card verdict ${v.level || ""}`} style={{ ["--s" as any]: v.score ?? 0 }}>
              <div className="score"><div><div><b>{v.score ?? "–"}</b><br /><span>zo 100</span></div></div></div>
              <div>
                <p className="vlabel">{v.label}</p>
                <div className="vmeta">
                  Stav k {fmt(doc.scannedAt)} · č. {doc.scanId}
                  {doc.asOf ? ` · spätné preverenie k ${fmt(doc.asOf, false)}` : ""}
                </div>
                <ul className="reasons">{(v.reasons || []).slice(0, 8).map((r: string, i: number) => <li key={i}>{r}</li>)}</ul>
              </div>
            </section>

            <KeyFacts facts={doc.keyFacts || []} />

            <section className="card">
              <h2>Identifikácia subjektu</h2>
              <p className="company-name">{p.name || "Neznámy subjekt"}</p>
              <dl className="profile kv">
                <div><dt>IČO</dt><dd>{p.ico || doc.ico}</dd></div>
                <div><dt>DIČ</dt><dd>{p.dic || "–"}</dd></div>
                <div><dt>IČ DPH</dt><dd>{p.icDph || "–"}</dd></div>
                <div><dt>Právna forma</dt><dd>{p.legalForm || "–"}</dd></div>
                <div><dt>Sídlo</dt><dd>{p.address || "–"}</dd></div>
                <div><dt>Deň vzniku</dt><dd>{p.established || "–"}</dd></div>
                <div style={{ gridColumn: "1 / -1" }}>
                  <dt>Štatutárny orgán</dt>
                  <dd>{p.statutory?.length ? p.statutory.map((s: any) => `${s.name} (${s.role}${s.since ? `, od ${s.since}` : ""})`).join("; ") : "–"}</dd>
                </div>
              </dl>
            </section>

            {doc.deal && (doc.deal.subject || doc.deal.value || doc.deal.iban) && (
              <section className="card">
                <h2>Údaje o obchode</h2>
                <dl className="profile kv">
                  <div><dt>Smer</dt><dd>{doc.deal.direction === "sell" ? "predaj" : "nákup"}</dd></div>
                  <div><dt>Predmet</dt><dd>{doc.deal.subject || "–"}</dd></div>
                  <div><dt>Hodnota</dt><dd>{doc.deal.value || "–"}</dd></div>
                  <div><dt>IBAN</dt><dd>{doc.deal.iban || "–"}</dd></div>
                </dl>
              </section>
            )}

            {grouped.map(([cat, items]) => (
              <section className="cat" key={cat}>
                <h3>{CATEGORIES[cat]}</h3>
                {items.map((c) => (
                  <article className={`check st-${c.status}`} key={c.id}>
                    <div className="head">
                      <div className="name">{c.name}</div>
                      <div className="src">{c.source} · {c.automated ? "automaticky" : "manuálne"} · {new Date(c.checkedAt).toLocaleTimeString("sk-SK")}</div>
                    </div>
                    <span className={`pill s-${c.status}`}>{STATUS_LABEL[c.status] || c.status}</span>
                    <div className="sum">{c.summary}</div>
                    {c.findings?.length > 0 && <ul>{c.findings.map((f, i) => <li key={i} className={`f-${f.severity}`}>{f.text}</li>)}</ul>}
                  </article>
                ))}
              </section>
            ))}

            <section className="card">
              <h2>Poznámky</h2>
              <div style={{ whiteSpace: "pre-wrap" }}>{doc.note?.trim() || "–"}</div>
              <div className="sign" style={{ marginTop: 12 }}>
                <div>Vypracoval (poverený zamestnanec): {doc.author || seal.by}</div>
              </div>
              <div className="seal-print" style={{ marginTop: 12 }}>
                <b>Pečať protokolu #{seal.seq}:</b> odtlačok SHA-256 {shortHash(seal.hash)} zapísaný {fmt(seal.sealedAt)} · overovací kód <b>{seal.code}</b> ·
                overenie: {DOMAIN}/overit/{seal.scanId}/{seal.code} · úplný odtlačok: <span className="mono">{seal.hash}</span>
                {doc.appVersion ? ` · verzia aplikácie ${doc.appVersion}` : ""}
              </div>
            </section>
          </>
        )}
      </main>
    </>
  );
}
