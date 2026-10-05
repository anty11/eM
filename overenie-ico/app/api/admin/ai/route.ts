import { NextResponse } from "next/server";
import { aiStatus, saveAiSettings } from "@/lib/ai/config";
import { jevStatus, saveJevSettings } from "@/lib/ai/jev";
import { handler, requireUser } from "@/lib/auth/guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = handler(async () => {
  await requireUser({ admin: true });
  return NextResponse.json({ ...(await aiStatus()), jev: await jevStatus() });
});

export const PUT = handler(async (req) => {
  const me = await requireUser({ admin: true });
  const body = await req.json();
  // nastavenie Jev sa ukladá samostatne (body.jev), zvyšok sú nastavenia LLM
  if (body.jev) return NextResponse.json({ ...(await aiStatus()), jev: await saveJevSettings(body.jev, me.email) });
  return NextResponse.json({ ...(await saveAiSettings(body, me.email)), jev: await jevStatus() });
});
