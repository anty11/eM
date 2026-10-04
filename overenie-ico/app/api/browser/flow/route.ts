import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { ovFlow, unionFlow } from "@/lib/browser/flows";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Interná funkcia so skriptovanými dopytmi cez prehliadač na serveri (Chromium). Je oddelená od hlavnej funkcie preverenia,
 * aby tá ostala malá a rýchlo štartovala – balík Chromia (~80 MB) sa pribaľuje len sem, k AI agentovi a k diagnostike.
 * Volá sa len zo servera s tokenom odvodeným zo SESSION_SECRET (rovnako ako /api/edgefetch).
 */
const token = () => createHash("sha256").update(`edgefetch:${process.env.SESSION_SECRET || "dev-only-secret-dev-only-secret-dev-only"}`).digest("hex");

export async function POST(req: Request) {
  if (req.headers.get("x-internal") !== token()) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const body = await req.json().catch(() => ({}));
  const ico = String(body.ico || "").replace(/\D/g, "");
  if (!/^\d{6,8}$/.test(ico)) return NextResponse.json({ error: "bad ico" }, { status: 400 });
  if (body.source !== "union" && body.source !== "ov") return NextResponse.json({ error: "unknown source" }, { status: 400 });
  const r = body.source === "ov" ? await ovFlow(ico, { diag: Boolean(body.diag) }) : await unionFlow(ico, { diag: Boolean(body.diag) });
  return NextResponse.json(r);
}
