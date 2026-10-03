import { NextResponse } from "next/server";
import { createOrder, OrderError } from "@/lib/orders";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Verejný príjem objednávky z webu (bez prihlásenia). */
export async function POST(req: Request) {
  const ip = (req.headers.get("x-forwarded-for") || "").split(",")[0].trim() || "neznáma";
  try {
    const body = await req.json().catch(() => ({}));
    const o = await createOrder(body, ip);
    return NextResponse.json({ ok: true, id: o.id });
  } catch (e) {
    const status = e instanceof OrderError ? 400 : 500;
    return NextResponse.json({ error: status === 400 ? (e as Error).message : "Objednávku sa nepodarilo uložiť. Napíšte nám, prosím, e-mail." }, { status });
  }
}
