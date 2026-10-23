import { NextResponse } from "next/server";
import { applyFixes, fixContext } from "@/lib/autofix";
import { fixFor } from "@/lib/fix-catalog";
import { fixAccess } from "@/lib/fix-access";

export const runtime = "nodejs";
export const maxDuration = 120;

// One-click (needs confirm: true) and input fixes (needs the merchant's value) for one finding of the last scan.
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const a = await fixAccess((await params).id);
  if (!a.ok) return NextResponse.json({ error: a.error }, { status: a.status });
  const body = (await request.json().catch(() => ({}))) as { finding_key?: unknown; value?: unknown; confirm?: unknown };
  const key = typeof body.finding_key === "string" ? body.finding_key.slice(0, 300) : "";
  const { data: scan } = await a.admin.from("scans").select("id").eq("store_id", a.store.id).eq("status", "complete").order("created_at", { ascending: false }).limit(1).maybeSingle();
  const { data: finding } = scan ? await a.admin.from("findings").select("finding_key, type, evidence, product_id").eq("scan_id", scan.id).eq("finding_key", key).maybeSingle() : { data: null };
  if (!finding) return NextResponse.json({ error: "This finding is not in the last scan." }, { status: 404 });
  const spec = fixFor(finding);
  if (spec.type === "guide") return NextResponse.json({ error: "This one needs a change outside the store data; see the guidance." }, { status: 400 });
  if (spec.type === "one_click" && body.confirm !== true) return NextResponse.json({ error: "Confirm the change first." }, { status: 400 });
  const value = typeof body.value === "string" ? body.value.slice(0, 500) : null;
  if (spec.type === "input" && !value) return NextResponse.json({ error: "Enter the value." }, { status: 400 });
  const ctx = await fixContext(a.admin, a.store);
  const r = await applyFixes(a.admin, ctx, [{ finding, type: spec.type, kind: spec.kind, value }], { userId: a.userId, automatic: false });
  const res = r.results[0];
  return NextResponse.json(res, { status: res.status === "applied" ? 200 : 422 });
}
