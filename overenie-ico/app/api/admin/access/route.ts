import { NextResponse } from "next/server";
import { AccessError, accessStatus, saveAccess } from "@/lib/access";
import { handler, requireUser } from "@/lib/auth/guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Administrácia → Prístupy k registrom (proxy pre blokované registre, export Obchodného vestníka). Len správca platformy. */
export const GET = handler(async () => {
  await requireUser({ admin: true });
  return NextResponse.json(await accessStatus());
});

export const PUT = handler(async (req) => {
  const me = await requireUser({ admin: true });
  try {
    return NextResponse.json(await saveAccess(await req.json(), me.email));
  } catch (e) {
    if (e instanceof AccessError) return NextResponse.json({ error: e.message }, { status: e.status });
    throw e;
  }
});
