import { NextResponse } from "next/server";
import { audit } from "@/lib/audit";
import { handler, requireUser } from "@/lib/auth/guard";
import { importOvFromMinistry, importOvXml, ovMeta } from "@/lib/sources/ov";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

/** Stav indexu Obchodného vestníka. */
export const GET = handler(async () => {
  await requireUser({ admin: true });
  return NextResponse.json({ meta: await ovMeta(), configured: Boolean(process.env.OV_EXPORT_URL) });
});

/**
 * Ručný import: telo požiadavky = XML vydania OV (Content-Type text/xml alebo application/xml), ?date=YYYY-MM-DD doplní dátum,
 * ak ho súbor neobsahuje. Bez tela spustí import z ministerstva (OV_EXPORT_URL).
 */
export const POST = handler(async (req) => {
  const me = await requireUser({ admin: true });
  const date = new URL(req.url).searchParams.get("date") || undefined;
  const body = await req.text();
  if (body.trim().length > 20) {
    const r = await importOvXml(body, `ručný import (${me.email})`, date);
    await audit({ type: "ov_import", by: me.email, detail: `ručne: ${r.parsed} záznamov, ${r.added} nových, ${r.icos} IČO` });
    return NextResponse.json(r);
  }
  const r = await importOvFromMinistry(Number(new URL(req.url).searchParams.get("days")) || 3);
  await audit({ type: "ov_import", by: me.email, detail: r.ok ? `ministerstvo: ${r.files} súborov, ${r.added} nových` : `chyba: ${r.error}` });
  return NextResponse.json(r, { status: r.ok ? 200 : 500 });
});
