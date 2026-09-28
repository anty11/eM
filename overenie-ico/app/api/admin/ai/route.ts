import { NextResponse } from "next/server";
import { aiStatus, saveAiSettings } from "@/lib/ai/config";
import { handler, requireUser } from "@/lib/auth/guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = handler(async () => {
  await requireUser({ admin: true });
  return NextResponse.json(await aiStatus());
});

export const PUT = handler(async (req) => {
  const me = await requireUser({ admin: true });
  return NextResponse.json(await saveAiSettings(await req.json(), me.email));
});
