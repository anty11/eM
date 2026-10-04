import { NextResponse } from "next/server";
import { handler, requireUser } from "@/lib/auth/guard";
import { sealProtocol } from "@/lib/seal";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Zapečatenie protokolu pred uložením PDF: klient pošle konečný obsah (checks, verdict, deal, kontakt, poznámka, autor),
 * server vypočíta SHA-256 z kanonického JSON, zapíše ho s časom a vráti. Rovnaký obsah dostane rovnakú pečať (idempotentné).
 */
export const POST = handler(async (req) => {
  const me = await requireUser();
  const b = await req.json().catch(() => null);
  if (!b || typeof b.scanId !== "string" || typeof b.ico !== "string" || typeof b.scannedAt !== "string" || !b.verdict || !Array.isArray(b.checks))
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
    });
    return NextResponse.json(seal);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
});
