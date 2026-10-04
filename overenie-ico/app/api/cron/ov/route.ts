import { NextResponse } from "next/server";
import { importOvFromMinistry } from "@/lib/sources/ov";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** Denný import vydaní Obchodného vestníka (Vercel Cron). Vyžaduje OV_EXPORT_URL (+ OV_USER / OV_PASSWORD). Chránené CRON_SECRET. */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret && req.headers.get("authorization") !== `Bearer ${secret}`) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const r = await importOvFromMinistry(Number(new URL(req.url).searchParams.get("days")) || 3);
  return NextResponse.json(r, { status: r.ok ? 200 : 500 });
}
