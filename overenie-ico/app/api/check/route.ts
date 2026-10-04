import { NextResponse } from "next/server";
import { audit } from "@/lib/audit";
import { handler, orgScope, requireUser } from "@/lib/auth/guard";
import { normalizeIco } from "@/lib/ico";
import { scan } from "@/lib/scan";
import { getAiConfig } from "@/lib/ai/config";
import { recordScan } from "@/lib/companies";
import { effectiveMode, getOrg } from "@/lib/orgs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

export const GET = handler(async (req) => {
  const me = await requireUser();
  // Správca platformy preveruje v mene zvolenej firmy (?org=), používateľ vždy vo svojej
  const orgId = orgScope(me, new URL(req.url).searchParams.get("org"));
  const ico = normalizeIco(new URL(req.url).searchParams.get("ico") || "");
  if (!ico) return NextResponse.json({ error: "Zadajte platné IČO (6–8 číslic)." }, { status: 400 });
  // Do výsledku a protokolu ide len meno povereného zamestnanca – e-mail sa v zdieľaných výstupoch neuvádza (ostáva v audite).
  const scannedBy = me.name || "poverený zamestnanec";
  const org = me.org && me.org.id === orgId ? me.org : await getOrg(orgId);
  if (!org) return NextResponse.json({ error: "Firma neexistuje." }, { status: 404 });
  const orgName = org.name;
  // Spätné preverenie k rozhodnému dátumu – len verzia Rozšírené; dátum musí byť v minulosti (nie starší ako 1. 1. 1993)
  const asOfRaw = new URL(req.url).searchParams.get("asOf") || "";
  let asOf: string | undefined;
  if (asOfRaw) {
    if (effectiveMode(org, me.role === "admin") !== "advokat") return NextResponse.json({ error: "Spätné preverenie k rozhodnému dátumu je dostupné len vo verzii Rozšírené." }, { status: 403 });
    if (!/^\d{4}-\d{2}-\d{2}$/.test(asOfRaw) || isNaN(+new Date(asOfRaw)) || asOfRaw > new Date().toISOString().slice(0, 10) || asOfRaw < "1993-01-01")
      return NextResponse.json({ error: "Rozhodný dátum musí byť platný dátum v minulosti." }, { status: 400 });
    asOf = asOfRaw;
  }
  const fresh = new URL(req.url).searchParams.get("fresh") === "1";
  const ai = await getAiConfig().catch(() => null);
  const aiInfo = ai ? { available: true, auto: ai.auto, noApiSources: ai.noApiSources, provider: ai.provider } : { available: false };

  // Priebežné výsledky: každý zdroj sa pošle hneď, ako odpovie (NDJSON)
  if (new URL(req.url).searchParams.get("stream") === "1") {
    const enc = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        const send = (o: unknown) => controller.enqueue(enc.encode(JSON.stringify(o) + "\n"));
        send({ type: "start", ico, scannedBy, orgName, ai: aiInfo });
        try {
          const report = await scan(ico, (check, profile) => send({ type: "check", check, profile }), { asOf, fresh });
          if (!report.notFound) await recordScan(orgId, { ico, name: report.profile.name, by: me.email, verdict: report.verdict.level, score: report.verdict.score, scanId: report.scanId, at: report.scannedAt });
          await audit({ type: "scan", by: me.email, orgId, ico, company: report.profile.name || (report.notFound ? "IČO nenájdené" : undefined), verdict: report.notFound ? "not_found" : report.verdict.level, score: report.verdict.score, scanId: report.scanId });
          send({ type: "done", report: { ...report, scannedBy, orgName, ai: aiInfo } });
        } catch (e) {
          send({ type: "error", error: (e as Error).message });
        }
        controller.close();
      },
    });
    return new Response(stream, { headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store", "X-Accel-Buffering": "no" } });
  }

  const report = await scan(ico, undefined, { asOf, fresh });
  if (!report.notFound) await recordScan(orgId, { ico, name: report.profile.name, by: me.email, verdict: report.verdict.level, score: report.verdict.score, scanId: report.scanId, at: report.scannedAt });
  await audit({
    type: "scan",
    by: me.email,
    orgId,
    ico,
    company: report.profile.name,
    verdict: report.verdict.level,
    score: report.verdict.score,
    scanId: report.scanId,
  });
  return NextResponse.json(
    { ...report, scannedBy, orgName, ai: aiInfo },
    { headers: { "Cache-Control": "no-store" } },
  );
});
