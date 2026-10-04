import { NextResponse } from "next/server";
import { handler, requireUser } from "@/lib/auth/guard";
import { toPublic } from "@/lib/auth/users";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = handler(async () => {
  const me = await requireUser();
  return NextResponse.json(toPublic(me, me.org));
});
