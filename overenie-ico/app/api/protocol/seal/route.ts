import { NextResponse } from "next/server";
import { handler, orgScope, requireUser } from "@/lib/auth/guard";
import { getOrg } from "@/lib/orgs";
import { sealProtocol } from "@/lib/seal";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Zapečatenie protokolu pred uložením PDF: klient pošle konečný obsah (checks, verdict, deal, kontakt, poznámka, autor),
 * server vypočíta SHA-256 z kanonického JSON, zapíše ho s časom a vráti. Rovnaký obsah dostane rovnakú pečať (idempotentné).
 */
export const POST = handler(async (req) => {
  const me = await requireUser();
  const orgId = orgScope(me, new URL(req.url).searchParams.get("org"));
  const org = me.org && me.org.id === orgId ? me.org : await getOrg(orgId);
  if (!org) return NextResponse.json({ error: "Firma neexistuje." }, { status: 404 });
  const b = await req.json().catch(() => null);
  if (!b || typeof b.scanId !== "string" || !/^SK-\d{6,8}-\d{14}$/.test(b.scanId) || typeof b.ico !== "string" || typeof b.scannedAt !== "string" || !b.verdict || !Array.isArray(b.checks))
    return NextResponse.json({ error: "Neúplný obsah protokolu." }, { status: 400 });
  try {
    const seal = await sealProtocol({
      scanId: b.scanId,
      ico: b.ico,
      scannedAt: b.scannedAt,
      asOf: typeof b.asOf === "string" ? b.asOf : undefined,
      profile: b.profile ?? null,
      checks: b.checks,
      verdict: b.verdict,
      keyFacts: b.keyFacts,
      deal: b.deal,
      contact: b.contact,
      note: typeof b.note === "string" ? b.note : "",
      author: typeof b.author === "string" ? b.author : "",
      appVersion: typeof b.appVersion === "string" ? b.appVersion : undefined,
      company: typeof b.profile?.name === "string" ? b.profile.name : undefined,
      verdictLevel: String(b.verdict.level || ""),
      score: Number(b.verdict.score ?? 0),
      by: me.name || "poverený zamestnanec",
      orgId,
      orgName: org.name,
    });
    return NextResponse.json(seal);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
});
