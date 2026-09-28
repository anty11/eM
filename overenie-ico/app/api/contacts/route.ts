import { NextResponse } from "next/server";
import { directory } from "@/lib/auth/users";
import { handler, requireUser } from "@/lib/auth/guard";
import { getContact, saveContact } from "@/lib/contacts";
import { normalizeIco } from "@/lib/ico";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const icoOf = (req: Request) => {
  const ico = normalizeIco(new URL(req.url).searchParams.get("ico") || "");
  if (!ico) throw Object.assign(new Error("Neplatné IČO."), { status: 400 });
  return ico;
};

export const GET = handler(async (req) => {
  await requireUser();
  return NextResponse.json((await getContact(icoOf(req))) || null);
});

export const PUT = handler(async (req) => {
  const me = await requireUser();
  const ico = icoOf(req);
  try {
    const allowed = (await directory()).map((u) => u.email);
    return NextResponse.json(await saveContact(ico, await req.json(), me.email, allowed));
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
});
