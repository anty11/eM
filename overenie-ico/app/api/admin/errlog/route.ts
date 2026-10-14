import { NextResponse } from "next/server";
import { clearErrors, listErrors, summarizeErrors } from "@/lib/errlog";
import { handler, requireUser } from "@/lib/auth/guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Záznam chýb zdrojov (len správca platformy): GET → { errors, summary }, DELETE → vymaže. */
export const GET = handler(async (req) => {
  await requireUser({ admin: true });
  const limit = Math.min(300, Number(new URL(req.url).searchParams.get("limit")) || 100);
  const all = await listErrors();
  return NextResponse.json({ errors: all.slice(0, limit), total: all.length, summary: summarizeErrors(all) });
});

export const DELETE = handler(async () => {
  await requireUser({ admin: true });
  await clearErrors();
  return NextResponse.json({ ok: true });
});
