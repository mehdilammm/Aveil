import { NextResponse } from "next/server";
import { fixContext, revertFix } from "@/lib/autofix";
import { fixAccess } from "@/lib/fix-access";

export const runtime = "nodejs";
export const maxDuration = 300;

// Undo one applied fix ({audit_id}) or a whole batch ({batch_id}: automatic, bulk one-click or CSV import).
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const a = await fixAccess((await params).id);
  if (!a.ok) return NextResponse.json({ error: a.error }, { status: a.status });
  const body = (await request.json().catch(() => ({}))) as { audit_id?: unknown; batch_id?: unknown };
  const ctx = await fixContext(a.admin, a.store);
  let ids: string[] = [];
  if (typeof body.audit_id === "string") ids = [body.audit_id];
  else if (typeof body.batch_id === "string") {
    const { data } = await a.admin.from("fix_audit_log").select("id").eq("store_id", a.store.id).eq("batch_id", body.batch_id).eq("status", "applied");
    ids = (data ?? []).map((r) => r.id as string);
  }
  if (!ids.length) return NextResponse.json({ error: "Nothing to undo." }, { status: 404 });
  const results = [];
  for (const id of ids) results.push({ id, ...(await revertFix(a.admin, ctx, id, a.userId)) });
  return NextResponse.json({ results }, { status: results.every((r) => r.ok) ? 200 : 207 });
}
