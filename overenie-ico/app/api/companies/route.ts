import { NextResponse } from "next/server";
import { audit } from "@/lib/audit";
import { handler, requireUser } from "@/lib/auth/guard";
import { listCompanies, removeCompany } from "@/lib/companies";
import { normalizeIco } from "@/lib/ico";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Zoznam preverených spoločností (celá kancelária); ?mine=1 len moje preverenia. */
export const GET = handler(async (req) => {
  const me = await requireUser();
  const mine = new URL(req.url).searchParams.get("mine") === "1";
  return NextResponse.json(await listCompanies(mine ? { by: me.email } : {}), { headers: { "Cache-Control": "no-store" } });
});

/** Odstránenie spoločnosti zo zoznamu (len administrátor). */
export const DELETE = handler(async (req) => {
  const me = await requireUser({ admin: true });
  const ico = normalizeIco(new URL(req.url).searchParams.get("ico") || "");
  if (!ico) return NextResponse.json({ error: "Neplatné IČO." }, { status: 400 });
  await removeCompany(ico);
  await audit({ type: "company_removed", by: me.email, ico });
  return NextResponse.json({ ok: true });
});
