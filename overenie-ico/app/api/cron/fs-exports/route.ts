import { NextResponse } from "next/server";
import { buildFsExports } from "@/lib/sources/fsexports";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Denná obnova indexov z exportov Finančnej správy (platitelia DPH + história zrušení, spotrebné dane) – Vercel Cron.
 * Chránené CRON_SECRET, ak je nastavený. Spustiť ručne: Diagnostika → „FS exporty“ (admin).
 */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret && req.headers.get("authorization") !== `Bearer ${secret}`) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  try {
    return NextResponse.json(await buildFsExports());
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
