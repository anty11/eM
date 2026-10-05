import { NextResponse } from "next/server";
import { aiCheck } from "@/lib/ai/fallback";
import { getAiConfig } from "@/lib/ai/config";
import { AI_SPECS } from "@/lib/ai/specs";
import { audit } from "@/lib/audit";
import { saveRun } from "@/lib/ailog";
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
  const t0 = Date.now();
  const events: { kind: string; text: string; t: number }[] = [];
  const logAudit = async (r: Awaited<ReturnType<typeof aiCheck>> | null, err?: Error) => {
    // záznam behu pre administráciu (Záznam AI overení) – podklad na prevod na automatický dopyt
    await saveRun({
      kind: "ai",
      source: check.id,
      ico,
      company: profile.name,
      orgId: me.orgId,
      by: me.email,
      provider: r?.check.ai?.provider || cfg.provider,
      model: r?.check.ai?.model || cfg.model,
      mode: r?.check.ai?.mode,
      result: r?.check.ai?.rawResult,
      status: r?.check.status,
      rejected: r?.check.ai?.rejected,
      summary: r?.check.summary,
      note: r?.check.ai?.note,
      error: err?.message,
      ms: Date.now() - t0,
      steps: r?.debug?.steps,
      decidedBy: r?.debug?.decidedBy,
      jev: r?.debug?.jev,
      evidence: r?.check.ai?.evidence,
      actions: r?.debug?.actions,
      pages: r?.debug?.pages,
      visited: r?.debug?.visited?.slice(0, 20),
      events: events.slice(-60),
    }).catch(() => undefined);
    return audit({
      type: "ai_check",
      by: me.email,
      orgId: me.orgId,
      ico,
      company: profile.name,
      target: check.id,
      detail: err ? `chyba: ${err.message}` : `${r!.check.status} · ${r!.check.ai?.rawResult}${r!.check.ai?.rejected ? " (zamietnuté – bez dôkazu)" : ""} · ${cfg.provider}/${cfg.model}`,
    });
  };

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
          const r = await aiCheck(cfg, check, ico, profile, (e) => {
            events.push({ kind: e.kind, text: e.text, t: e.at - t0 });
            send({ type: "step", ...e });
          });
          await logAudit(r);
          send({ type: "result", check: r.check, profilePatch: r.profilePatch });
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
    return NextResponse.json({ check: r.check, profilePatch: r.profilePatch });
  } catch (e) {
    await logAudit(null, e as Error);
    return NextResponse.json({ error: `AI overenie zlyhalo: ${(e as Error).message}` }, { status: 502 });
  }
});
