import { NextResponse } from "next/server";
import { handler, requireUser } from "@/lib/auth/guard";
import { directory } from "@/lib/auth/users";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Zoznam kolegov na výber zodpovedného zamestnanca. */
export const GET = handler(async () => {
  await requireUser();
  return NextResponse.json(await directory());
});
