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
  const logAudit = async (r: Awaited<ReturnType<typeof aiCheck>> | null, err?: Error) =>
    audit({
      type: "ai_check",
      by: me.email,
      orgId: me.orgId,
      ico,
      company: profile.name,
      target: check.id,
      detail: err ? `chyba: ${err.message}` : `${r!.check.status} · ${r!.check.ai?.rawResult}${r!.check.ai?.rejected ? " (zamietnuté – bez dôkazu)" : ""} · ${cfg.provider}/${cfg.model}`,
    });

  // Živý priebeh: ?stream=1 → NDJSON {type:"step",kind,text,at} … {type:"result",check,profilePatch} | {type:"error",error}
  if (new URL(req.url).searchParams.get("stream") === "1") {
    const enc = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        let open = true;
        const send = (o: unknown) => {
          if (!open) return;
          try {
            controller.enqueue(enc.encode(JSON.stringify(o) + "\n"));
          } catch {
            open = false;
          }
        };
        // srdcový tep každých 10 s, aby proxy nespojenie neukončila počas dlhého volania modelu
        const hb = setInterval(() => send({ type: "ping", at: Date.now() }), 10000);
        try {
          const r = await aiCheck(cfg, check, ico, profile, (e) => send({ type: "step", ...e }));
          await logAudit(r);
          send({ type: "result", ...r });
        } catch (e) {
          await logAudit(null, e as Error).catch(() => undefined);
          send({ type: "error", error: `AI overenie zlyhalo: ${(e as Error).message}` });
        } finally {
          clearInterval(hb);
          open = false;
          controller.close();
        }
      },
    });
    return new Response(stream, { headers: { "content-type": "application/x-ndjson; charset=utf-8", "cache-control": "no-store, no-transform", "x-accel-buffering": "no" } });
  }

  try {
    const r = await aiCheck(cfg, check, ico, profile);
    await logAudit(r);
    return NextResponse.json(r);
  } catch (e) {
    await logAudit(null, e as Error);
    return NextResponse.json({ error: `AI overenie zlyhalo: ${(e as Error).message}` }, { status: 502 });
  }
});
