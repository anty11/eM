import { NextResponse } from "next/server";
import { audit } from "@/lib/audit";
import { handler, orgScope, requireUser } from "@/lib/auth/guard";
import { listCompanies, removeCompany } from "@/lib/companies";
import { normalizeIco } from "@/lib/ico";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Zoznam preverených spoločností firmy; ?mine=1 len moje preverenia. Správca platformy zvolí firmu cez ?org=. */
export const GET = handler(async (req) => {
  const me = await requireUser();
  const p = new URL(req.url).searchParams;
  const orgId = orgScope(me, p.get("org"));
  const mine = p.get("mine") === "1";
  return NextResponse.json(await listCompanies(orgId, mine ? { by: me.email } : {}), { headers: { "Cache-Control": "no-store" } });
});

/** Odstránenie spoločnosti zo zoznamu firmy (len správca platformy). */
export const DELETE = handler(async (req) => {
  const me = await requireUser({ admin: true });
  const p = new URL(req.url).searchParams;
  const orgId = orgScope(me, p.get("org"));
  const ico = normalizeIco(p.get("ico") || "");
  if (!ico) return NextResponse.json({ error: "Neplatné IČO." }, { status: 400 });
  await removeCompany(orgId, ico);
  await audit({ type: "company_removed", by: me.email, orgId, ico });
  return NextResponse.json({ ok: true });
});
