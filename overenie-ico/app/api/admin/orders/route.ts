import { NextResponse } from "next/server";
import { handler, requireUser } from "@/lib/auth/guard";
import { listOrders, OrderError, setOrderStatus } from "@/lib/orders";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = handler(async () => {
  await requireUser({ admin: true });
  return NextResponse.json(await listOrders());
});

/** { id, status: "new" | "contacted" | "done" } */
export const PATCH = handler(async (req) => {
  const me = await requireUser({ admin: true });
  const { id, status } = await req.json();
  if (!["new", "contacted", "done"].includes(status)) return NextResponse.json({ error: "Neplatný stav." }, { status: 400 });
  try {
    return NextResponse.json(await setOrderStatus(String(id), status, me.email));
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: e instanceof OrderError ? 404 : 500 });
  }
});
