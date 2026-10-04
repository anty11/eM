import { NextResponse } from "next/server";
import { handler, requireUser } from "@/lib/auth/guard";
import { addUsers, AuthError, deleteUser, getUser, listUsers, resetUser, updateUser } from "@/lib/auth/users";
import { ORG_ID_RE } from "@/lib/orgs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Používatelia firmy (?org=) alebo všetci (bez parametra) – len správca platformy. */
export const GET = handler(async (req) => {
  await requireUser({ admin: true });
  const org = new URL(req.url).searchParams.get("org") || undefined;
  if (org && !ORG_ID_RE.test(org)) throw new AuthError("Neplatná firma.");
  return NextResponse.json(await listUsers(org));
});

/** Hromadné pridanie používateľov do firmy: { org, emails: "a@x.sk, b@y.sk\nc@z.sk" } */
export const POST = handler(async (req) => {
  const me = await requireUser({ admin: true });
  const { org, emails } = await req.json();
  if (typeof org !== "string" || !ORG_ID_RE.test(org)) throw new AuthError("Zvoľte firmu.");
  const results = await addUsers(String(emails || ""), org, me.email);
  if (!results.length) throw new AuthError("Zoznam neobsahuje žiadnu e-mailovú adresu.");
  return NextResponse.json({ results });
});

/** { email, action: "reset" | "disable" | "enable" | "name" | "delete", name? } */
export const PATCH = handler(async (req) => {
  const me = await requireUser({ admin: true });
  const { email, action, name } = await req.json();
  const target = await getUser(String(email || ""));
  if (!target) throw new AuthError("Používateľ neexistuje.", 404);
  // Správcov platformy cez rozhranie nemožno mazať ani blokovať (okrem nového kódu a mena) – vznikajú a rušia sa cez ADMIN_EMAILS.
  if (target.role === "admin" && ["disable", "delete"].includes(action)) throw new AuthError("Správcu platformy nemožno zablokovať ani zmazať cez aplikáciu.", 403);
  switch (action) {
    case "reset":
      return NextResponse.json({ code: await resetUser(email, me.email) });
    case "disable":
      return NextResponse.json(await updateUser(email, { disabled: true }, me.email));
    case "enable":
      return NextResponse.json(await updateUser(email, { disabled: false }, me.email));
    case "name":
      return NextResponse.json(await updateUser(email, { name: String(name ?? "") }, me.email));
    case "delete":
      await deleteUser(email, me.email);
      return NextResponse.json({ ok: true });
    default:
      throw new AuthError("Neznáma akcia.");
  }
});
