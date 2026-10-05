import { NextResponse } from "next/server";
import { clearRuns, listRuns, summarize } from "@/lib/ailog";
import { handler, requireUser } from "@/lib/auth/guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Záznam AI overení a skriptovaných dopytov (len správca platformy).
 *  GET ?summary=1[&source=] → súhrn na zdieľanie (za register: výsledky, posledný úspešný postup, posledný neúspech so stránkami)
 *  GET [?source=&limit=] → zoznam behov (bez snímok stránok; detail ?id=)
 *  DELETE → vymaže záznam
 */
export const GET = handler(async (req) => {
  await requireUser({ admin: true });
  const p = new URL(req.url).searchParams;
  const source = p.get("source") || undefined;
  const runs = await listRuns({ source });
  if (p.get("summary") === "1") return NextResponse.json(summarize(runs));
  const id = p.get("id");
  if (id) {
    const r = runs.find((x) => x.id === id);
    return r ? NextResponse.json(r) : NextResponse.json({ error: "Záznam neexistuje." }, { status: 404 });
  }
  const limit = Math.min(200, Number(p.get("limit")) || 60);
  return NextResponse.json({
    runs: runs.slice(0, limit).map(({ pages, actions, events, visited, ...r }) => ({ ...r, pagesCount: pages?.length || 0, actionsCount: actions?.length || 0 })),
    total: runs.length,
  });
});

export const DELETE = handler(async () => {
  await requireUser({ admin: true });
  await clearRuns();
  return NextResponse.json({ ok: true });
});
