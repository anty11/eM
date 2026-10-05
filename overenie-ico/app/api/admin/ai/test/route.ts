import { NextResponse } from "next/server";
import { getAiConfig } from "@/lib/ai/config";
import { getJevConfig, pingJev } from "@/lib/ai/jev";
import { isModelError } from "@/lib/ai/fallback";
import { pingLlm } from "@/lib/ai/llm";
import { handler, requireUser } from "@/lib/auth/guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = handler(async (req) => {
  await requireUser({ admin: true });
  // test kľúča Jev (TypeSafe)
  if (new URL(req.url).searchParams.get("jev") === "1") {
    const jc = await getJevConfig();
    if (!jc) return NextResponse.json({ ok: false, error: "Jev nie je nastavený alebo je vypnutý." }, { status: 409 });
    try {
      const r = await pingJev(jc);
      return NextResponse.json({ ok: true, provider: "Jev (TypeSafe)", model: r.model, ms: r.ms, reply: "OK" });
    } catch (e) {
      return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 502 });
    }
  }
  const cfg = await getAiConfig();
  if (!cfg) return NextResponse.json({ ok: false, error: "AI nie je nastavená." }, { status: 409 });
  const t0 = Date.now();
  try {
    const reply = await pingLlm(cfg);
    return NextResponse.json({ ok: true, reply, provider: cfg.provider, model: cfg.model, ms: Date.now() - t0 });
  } catch (e) {
    const msg = (e as Error).message;
    // rýchly model nedostupný → overíme aj štandardný, aby bolo jasné, či overenia budú fungovať (s automatickým zopakovaním)
    if (cfg.fallbackModel && isModelError(msg)) {
      try {
        const reply = await pingLlm({ ...cfg, model: cfg.fallbackModel });
        return NextResponse.json({
          ok: true,
          reply,
          provider: cfg.provider,
          model: cfg.fallbackModel,
          ms: Date.now() - t0,
          warning: `Rýchly model ${cfg.model} nie je pre tento kľúč dostupný (${msg.slice(0, 160)}). Overenia budú automaticky používať štandardný ${cfg.fallbackModel} – alebo prepnite na „Štandardný“, prípadne zadajte iný model.`,
        });
      } catch {
        /* nižšie pôvodná chyba */
      }
    }
    return NextResponse.json({ ok: false, error: msg, provider: cfg.provider, model: cfg.model }, { status: 502 });
  }
});
