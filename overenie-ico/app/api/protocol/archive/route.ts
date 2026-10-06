import { NextResponse } from "next/server";
import { handler, orgScope, requireUser } from "@/lib/auth/guard";
import { listArchive } from "@/lib/seal";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Archív zapečatených protokolov firmy: číslo, overovací kód, dátum, verdikt (bez obsahu). Správca platformy volí firmu cez ?org=. */
export const GET = handler(async (req) => {
  const me = await requireUser();
  const p = new URL(req.url).searchParams;
  const orgId = orgScope(me, p.get("org"));
  return NextResponse.json(await listArchive(orgId, Number(p.get("limit")) || 500), { headers: { "Cache-Control": "no-store" } });
});
