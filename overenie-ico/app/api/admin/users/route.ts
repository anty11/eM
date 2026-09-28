import { NextResponse } from "next/server";
import { handler, requireUser } from "@/lib/auth/guard";
import { addUsers, AuthError, deleteUser, listUsers, resetUser, updateUser, type Mode, type Role } from "@/lib/auth/users";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = handler(async () => {
  await requireUser({ admin: true });
  return NextResponse.json(await listUsers());
});

/** Hromadné pridanie: { emails: "a@x.sk, b@y.sk\nc@z.sk", role: "user" | "admin" } */
export const POST = handler(async (req) => {
  const me = await requireUser({ admin: true });
  const { emails, role, mode } = await req.json();
  const r: Role = role === "admin" ? "admin" : "user";
  const m: Mode | undefined = mode === "advokat" ? "advokat" : mode === "firma" ? "firma" : undefined;
  const results = await addUsers(String(emails || ""), r, me.email, m);
  if (!results.length) throw new AuthError("Zoznam neobsahuje žiadnu e-mailovú adresu.");
  return NextResponse.json({ results });
});

/** { email, action: "reset" | "disable" | "enable" | "role" | "mode" | "name" | "delete", role?, mode?, name? } */
export const PATCH = handler(async (req) => {
  const me = await requireUser({ admin: true });
  const { email, action, role, mode, name } = await req.json();
  switch (action) {
    case "reset":
      return NextResponse.json({ code: await resetUser(email, me.email) });
    case "disable":
      return NextResponse.json(await updateUser(email, { disabled: true }, me.email));
    case "enable":
      return NextResponse.json(await updateUser(email, { disabled: false }, me.email));
    case "role":
      return NextResponse.json(await updateUser(email, { role: role === "admin" ? "admin" : "user" }, me.email));
    case "mode":
      return NextResponse.json(await updateUser(email, { mode: mode === "advokat" ? "advokat" : "firma" }, me.email));
    case "name":
      return NextResponse.json(await updateUser(email, { name: String(name ?? "") }, me.email));
    case "delete":
      await deleteUser(email, me.email);
      return NextResponse.json({ ok: true });
    default:
      throw new AuthError("Neznáma akcia.");
  }
});
