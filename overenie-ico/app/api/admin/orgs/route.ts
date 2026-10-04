import { NextResponse } from "next/server";
import { audit } from "@/lib/audit";
import { handler, requireUser } from "@/lib/auth/guard";
import { AuthError, seatsUsed } from "@/lib/auth/users";
import { createOrg, getOrg, listOrgs, OrgError, updateOrg } from "@/lib/orgs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const wrap = async <T,>(fn: () => Promise<T>) => {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof OrgError) throw new AuthError(e.message, e.status);
    throw e;
  }
};

/** Zoznam firiem s obsadenosťou miest – len správca platformy. */
export const GET = handler(async () => {
  await requireUser({ admin: true });
  const orgs = await listOrgs();
  const used = await Promise.all(orgs.map((o) => seatsUsed(o.id)));
  return NextResponse.json(orgs.map((o, i) => ({ ...o, used: used[i] })));
});

/** Založenie firmy: { name, ico?, mode, seats, note?, orderId?, id? } */
export const POST = handler(async (req) => {
  const me = await requireUser({ admin: true });
  const b = await req.json();
  const o = await wrap(() => createOrg(b, me.email));
  await audit({ type: "org_created", by: me.email, target: o.id, detail: `${o.name} · ${o.mode === "advokat" ? "Rozšírené" : "Štandard"} · ${o.seats} miest` });
  return NextResponse.json({ ...o, used: 0 });
});

/** Úprava firmy: { id, name?, ico?, mode?, seats?, disabled?, note? } */
export const PATCH = handler(async (req) => {
  const me = await requireUser({ admin: true });
  const { id, ...change } = await req.json();
  if (!(await getOrg(String(id || "")))) throw new AuthError("Firma neexistuje.", 404);
  const o = await wrap(() => updateOrg(String(id), change));
  await audit({ type: "org_updated", by: me.email, target: o.id, detail: Object.keys(change).map((k) => `${k}=${String((change as any)[k])}`).join(", ") });
  return NextResponse.json({ ...o, used: await seatsUsed(o.id) });
});
