import { NextResponse } from "next/server";
import { audit } from "@/lib/audit";
import { handler, requireUser } from "@/lib/auth/guard";
import { normalizeIco } from "@/lib/ico";
import { scan } from "@/lib/scan";
import { getAiConfig } from "@/lib/ai/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export const GET = handler(async (req) => {
  const me = await requireUser();
  const ico = normalizeIco(new URL(req.url).searchParams.get("ico") || "");
  if (!ico) return NextResponse.json({ error: "Zadajte platné IČO (6–8 číslic)." }, { status: 400 });
  const report = await scan(ico);
  const scannedBy = me.name ? `${me.name} <${me.email}>` : me.email;
  await audit({
    type: "scan",
    by: me.email,
    ico,
    company: report.profile.name,
    verdict: report.verdict.level,
    score: report.verdict.score,
    scanId: report.scanId,
  });
  const ai = await getAiConfig().catch(() => null);
  return NextResponse.json(
    { ...report, scannedBy, ai: ai ? { available: true, auto: ai.auto, noApiSources: ai.noApiSources, provider: ai.provider } : { available: false } },
    { headers: { "Cache-Control": "no-store" } },
  );
});
