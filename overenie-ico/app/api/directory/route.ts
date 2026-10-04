import { NextResponse } from "next/server";
import { handler, orgScope, requireUser } from "@/lib/auth/guard";
import { directory } from "@/lib/auth/users";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Zoznam kolegov vlastnej firmy na výber zodpovedného zamestnanca (správca platformy: ?org=). */
export const GET = handler(async (req) => {
  const me = await requireUser();
  return NextResponse.json(await directory(orgScope(me, new URL(req.url).searchParams.get("org"))));
});
