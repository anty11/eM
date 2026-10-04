import { NextResponse } from "next/server";
import { audit } from "@/lib/audit";
import { handler, requireUser } from "@/lib/auth/guard";
import { normalizeIco } from "@/lib/ico";
import { scan } from "@/lib/scan";
import { getAiConfig } from "@/lib/ai/config";
import { recordScan } from "@/lib/companies";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export const GET = handler(async (req) => {
  const me = await requireUser();
  const ico = normalizeIco(new URL(req.url).searchParams.get("ico") || "");
  if (!ico) return NextResponse.json({ error: "Zadajte platné IČO (6–8 číslic)." }, { status: 400 });
  // Do výsledku a protokolu ide len meno povereného zamestnanca – e-mail sa v zdieľaných výstupoch neuvádza (ostáva v audite).
  const scannedBy = me.name || "poverený zamestnanec";
  const ai = await getAiConfig().catch(() => null);
  const aiInfo = ai ? { available: true, auto: ai.auto, noApiSources: ai.noApiSources, provider: ai.provider } : { available: false };

  // Priebežné výsledky: každý zdroj sa pošle hneď, ako odpovie (NDJSON)
  if (new URL(req.url).searchParams.get("stream") === "1") {
    const enc = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        const send = (o: unknown) => controller.enqueue(enc.encode(JSON.stringify(o) + "\n"));
        send({ type: "start", ico, scannedBy, ai: aiInfo });
        try {
          const report = await scan(ico, (check, profile) => send({ type: "check", check, profile }));
          if (!report.notFound) await recordScan({ ico, name: report.profile.name, by: me.email, verdict: report.verdict.level, score: report.verdict.score, scanId: report.scanId, at: report.scannedAt });
          await audit({ type: "scan", by: me.email, ico, company: report.profile.name || (report.notFound ? "IČO nenájdené" : undefined), verdict: report.notFound ? "not_found" : report.verdict.level, score: report.verdict.score, scanId: report.scanId });
          send({ type: "done", report: { ...report, scannedBy, ai: aiInfo } });
        } catch (e) {
          send({ type: "error", error: (e as Error).message });
        }
        controller.close();
      },
    });
    return new Response(stream, { headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store", "X-Accel-Buffering": "no" } });
  }

  const report = await scan(ico);
  if (!report.notFound) await recordScan({ ico, name: report.profile.name, by: me.email, verdict: report.verdict.level, score: report.verdict.score, scanId: report.scanId, at: report.scannedAt });
  await audit({
    type: "scan",
    by: me.email,
    ico,
    company: report.profile.name,
    verdict: report.verdict.level,
    score: report.verdict.score,
    scanId: report.scanId,
  });
  return NextResponse.json(
    { ...report, scannedBy, ai: aiInfo },
    { headers: { "Cache-Control": "no-store" } },
  );
});
