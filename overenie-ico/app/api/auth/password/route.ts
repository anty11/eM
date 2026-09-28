import { NextResponse } from "next/server";
import { handler, requireUser, startSession } from "@/lib/auth/guard";
import { changePassword } from "@/lib/auth/users";

export const runtime = "nodejs";

export const POST = handler(async (req) => {
  const me = await requireUser();
  const { oldPassword, newPassword } = await req.json();
  const u = await changePassword(me.email, String(oldPassword || ""), String(newPassword || ""));
  return startSession(NextResponse.json({ ok: true }), u); // ostatné relácie sa odhlásia
});
