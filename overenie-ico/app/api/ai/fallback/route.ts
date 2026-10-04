import { NextResponse } from "next/server";
import { aiCheck } from "@/lib/ai/fallback";
import { getAiConfig } from "@/lib/ai/config";
import { AI_SPECS } from "@/lib/ai/specs";
import { audit } from "@/lib/audit";
import { handler, requireUser } from "@/lib/auth/guard";
import { normalizeIco } from "@/lib/ico";
import type { CheckResult, CompanyProfile } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** { ico, check, profile } → { check, profilePatch } – AI overenie jedného zdroja. */
export const POST = handler(async (req) => {
  const me = await requireUser();
  const cfg = await getAiConfig();
  if (!cfg) return NextResponse.json({ error: "AI nie je nastavená (Administrácia → Nastavenia AI)." }, { status: 409 });
  const body = await req.json();
  const ico = normalizeIco(String(body.ico || ""));
  const check = body.check as CheckResult;
  if (!ico || !check?.id || !AI_SPECS[check.id]) return NextResponse.json({ error: "Neplatná požiadavka." }, { status: 400 });
  const profile = { ...(body.profile || {}), ico } as CompanyProfile;
  try {
    const r = await aiCheck(cfg, check, ico, profile);
    await audit({
      type: "ai_check",
      by: me.email,
      orgId: me.orgId,
      ico,
      company: profile.name,
      target: check.id,
      detail: `${r.check.status} · ${r.check.ai?.rawResult}${r.check.ai?.rejected ? " (zamietnuté – bez dôkazu)" : ""} · ${cfg.provider}/${cfg.model}`,
    });
    return NextResponse.json(r);
  } catch (e) {
    await audit({ type: "ai_check", by: me.email, orgId: me.orgId, ico, target: check.id, detail: `chyba: ${(e as Error).message}` });
    return NextResponse.json({ error: `AI overenie zlyhalo: ${(e as Error).message}` }, { status: 502 });
  }
});
