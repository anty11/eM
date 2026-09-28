import { NextResponse } from "next/server";
import { clientIp, handler, startSession } from "@/lib/auth/guard";
import { setPasswordWithCode } from "@/lib/auth/users";

export const runtime = "nodejs";

/** Nastavenie hesla jednorazovým kódom (pozvánka alebo reset). */
export const POST = handler(async (req) => {
  const { email, code, password } = await req.json();
  const u = await setPasswordWithCode(String(email || ""), String(code || ""), String(password || ""), clientIp(req));
  return startSession(NextResponse.json({ ok: true, role: u.role }), u);
});
