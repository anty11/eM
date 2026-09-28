import { NextResponse } from "next/server";
import { listAudit } from "@/lib/audit";
import { handler, requireUser } from "@/lib/auth/guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = handler(async (req) => {
  await requireUser({ admin: true });
  const p = new URL(req.url).searchParams;
  const events = await listAudit({ limit: Number(p.get("limit")) || 500, type: p.get("type") || undefined, q: p.get("q") || undefined });
  if (p.get("format") === "csv") {
    const cols = ["at", "type", "by", "ico", "company", "verdict", "score", "scanId", "target", "detail"] as const;
    const esc = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const csv = "﻿" + [cols.join(";"), ...events.map((e) => cols.map((c) => esc((e as any)[c])).join(";"))].join("\r\n");
    return new Response(csv, {
      headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="audit-${new Date().toISOString().slice(0, 10)}.csv"` },
    });
  }
  return NextResponse.json(events);
});
