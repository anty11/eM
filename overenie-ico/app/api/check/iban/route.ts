import { NextResponse } from "next/server";
import { handler, requireUser } from "@/lib/auth/guard";
import { ibanValid, normalizeIban } from "@/lib/deal";
import { normalizeIco } from "@/lib/ico";
import { checkBankAccount } from "@/lib/sources/fs";
import type { CompanyProfile, Ctx } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

/** { ico, iban, profile } → overenie účtu v zozname bankových účtov platiteľov DPH (Finančná správa). */
export const POST = handler(async (req) => {
  await requireUser();
  const body = await req.json().catch(() => ({}));
  const ico = normalizeIco(String(body.ico || ""));
  const iban = normalizeIban(String(body.iban || ""));
  if (!ico) return NextResponse.json({ error: "Neplatné IČO." }, { status: 400 });
  if (!ibanValid(iban)) return NextResponse.json({ status: "unknown", message: "IBAN nie je platný." });
  const profile = { ...(body.profile || {}), ico } as CompanyProfile;
  const ctx: Ctx = { ico, profile, rpoDone: Promise.resolve(), dicReady: Promise.resolve(), resolveDic: () => undefined };
  return NextResponse.json(await checkBankAccount(ctx, iban));
});
