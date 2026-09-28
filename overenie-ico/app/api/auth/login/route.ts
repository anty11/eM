import { NextResponse } from "next/server";
import { clientIp, handler, startSession } from "@/lib/auth/guard";
import { login } from "@/lib/auth/users";

export const runtime = "nodejs";

export const POST = handler(async (req) => {
  const { email, password } = await req.json();
  const u = await login(String(email || ""), String(password || ""), clientIp(req));
  return startSession(NextResponse.json({ ok: true, role: u.role }), u);
});
