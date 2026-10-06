import { NextResponse } from "next/server";
import { handler, orgScope, requireUser } from "@/lib/auth/guard";
import { getSealedDoc } from "@/lib/seal";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Uložený obsah zapečateného protokolu (len firma, ktorej patrí) + kontrola, že sa od zapečatenia nezmenil. */
export const GET = handler(async (req) => {
  const me = await requireUser();
  const p = new URL(req.url).searchParams;
  const orgId = orgScope(me, p.get("org"));
  const r = await getSealedDoc(orgId, p.get("scanId") || "", Number(p.get("seq")));
  if (!r) return NextResponse.json({ error: "Protokol sa nenašiel alebo jeho obsah nie je uložený (pečate spred archívu)." }, { status: 404 });
  return NextResponse.json(r, { headers: { "Cache-Control": "no-store" } });
});
