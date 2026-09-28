import { NextResponse } from "next/server";
import { getAiConfig } from "@/lib/ai/config";
import { pingLlm } from "@/lib/ai/llm";
import { handler, requireUser } from "@/lib/auth/guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = handler(async () => {
  await requireUser({ admin: true });
  const cfg = await getAiConfig();
  if (!cfg) return NextResponse.json({ ok: false, error: "AI nie je nastavená." }, { status: 409 });
  const t0 = Date.now();
  try {
    const reply = await pingLlm(cfg);
    return NextResponse.json({ ok: true, reply, provider: cfg.provider, model: cfg.model, ms: Date.now() - t0 });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message, provider: cfg.provider, model: cfg.model }, { status: 502 });
  }
});
