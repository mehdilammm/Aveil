import { NextResponse } from "next/server";
import { applyFixes, fixContext } from "@/lib/autofix";
import { returnsProposalFor } from "@/lib/schema-fixes";
import { fixFor } from "@/lib/fix-catalog";
import { fixAccess } from "@/lib/fix-access";

export const runtime = "nodejs";
export const maxDuration = 120;

// One-click (needs confirm: true) and input fixes (needs the merchant's value) for one finding of the last scan.
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const a = await fixAccess((await params).id);
  if (!a.ok) return NextResponse.json({ error: a.error }, { status: a.status });
  const body = (await request.json().catch(() => ({}))) as { finding_key?: unknown; value?: unknown; confirm?: unknown; preview?: unknown; proposal_hash?: unknown; answer?: unknown };
  const key = typeof body.finding_key === "string" ? body.finding_key.slice(0, 300) : "";
  const { data: scan } = await a.admin.from("scans").select("id").eq("store_id", a.store.id).eq("status", "complete").order("created_at", { ascending: false }).limit(1).maybeSingle();
  const { data: finding } = scan ? await a.admin.from("findings").select("finding_key, type, evidence, product_id").eq("scan_id", scan.id).eq("finding_key", key).maybeSingle() : { data: null };
  if (!finding) return NextResponse.json({ error: "This finding is not in the last scan." }, { status: 404 });
  const spec = fixFor(finding);
  if (spec.type === "guide") return NextResponse.json({ error: "This one needs a change outside the store data; see the guidance." }, { status: 400 });
  // G7: the return policy is shown first (with the sentences it is based on), then applied as shown, or the
  // merchant answers a short form when the page is unclear.
  if (spec.kind === "returns") {
    const ctx = await fixContext(a.admin, a.store);
    if (body.preview === true) return NextResponse.json(await returnsProposalFor(ctx));
    const answer = typeof body.answer === "string" ? body.answer.slice(0, 2000) : null;
    if (!answer && (body.confirm !== true || typeof body.proposal_hash !== "string")) return NextResponse.json({ error: "Confirm the proposal first." }, { status: 400 });
    const r = await applyFixes(a.admin, ctx, [{ finding, type: answer ? "input" : "one_click", kind: "returns", value: JSON.stringify(answer ? { answer } : { hash: body.proposal_hash }) }], { userId: a.userId, automatic: false });
    return NextResponse.json(r.results[0], { status: r.results[0].status === "applied" ? 200 : 422 });
  }
  if (spec.type === "one_click" && body.confirm !== true) return NextResponse.json({ error: "Confirm the change first." }, { status: 400 });
  const value = typeof body.value === "string" ? body.value.slice(0, 500) : null;
  if (spec.type === "input" && !value) return NextResponse.json({ error: "Enter the value." }, { status: 400 });
  const ctx = await fixContext(a.admin, a.store);
  const r = await applyFixes(a.admin, ctx, [{ finding, type: spec.type, kind: spec.kind, value }], { userId: a.userId, automatic: false });
  const res = r.results[0];
  return NextResponse.json(res, { status: res.status === "applied" ? 200 : 422 });
}
