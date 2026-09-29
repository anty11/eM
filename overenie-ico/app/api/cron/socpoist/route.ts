import { NextResponse } from "next/server";
import { buildIndexNow } from "@/lib/sources/socpoist";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** Denná obnova zoznamu dlžníkov Sociálnej poisťovne (Vercel Cron). Chránené CRON_SECRET, ak je nastavený. */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret && req.headers.get("authorization") !== `Bearer ${secret}`) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const r = await buildIndexNow();
  return NextResponse.json(r, { status: r.built ? 200 : 500 });
}
