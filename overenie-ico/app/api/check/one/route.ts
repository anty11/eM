import { NextResponse } from "next/server";
import { handler, requireUser } from "@/lib/auth/guard";
import { normalizeIco } from "@/lib/ico";
import { runOne } from "@/lib/scan";
import type { CompanyProfile } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Znovu spustí jeden zdroj: { ico, id, profile } → { check, profile } */
export const POST = handler(async (req) => {
  await requireUser();
  const body = await req.json();
  const ico = normalizeIco(String(body.ico || ""));
  if (!ico || typeof body.id !== "string") return NextResponse.json({ error: "Neplatná požiadavka." }, { status: 400 });
  const r = await runOne(ico, body.id, (body.profile || {}) as Partial<CompanyProfile>);
  if (!r) return NextResponse.json({ error: "Neznámy zdroj." }, { status: 400 });
  return NextResponse.json(r, { headers: { "Cache-Control": "no-store" } });
});
