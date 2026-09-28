import { NextResponse } from "next/server";
import { endSession, handler } from "@/lib/auth/guard";

export const POST = handler(async () => endSession(NextResponse.json({ ok: true })));
