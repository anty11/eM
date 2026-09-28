import { NextResponse } from "next/server";
import { handler, requireUser } from "@/lib/auth/guard";
import { toPublic } from "@/lib/auth/users";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = handler(async () => NextResponse.json(toPublic(await requireUser())));
