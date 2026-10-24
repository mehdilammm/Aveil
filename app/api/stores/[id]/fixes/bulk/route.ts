import { NextResponse } from "next/server";
import { applyFixes, fixContext } from "@/lib/autofix";
import { MAX_BULK, planBulk } from "@/lib/bulk-fixes";
import { fixAccess } from "@/lib/fix-access";

export const runtime = "nodejs";
export const maxDuration = 300;

type Admin = Extract<Awaited<ReturnType<typeof fixAccess>>, { ok: true }>["admin"];
async function load(admin: Admin, storeId: string) {
  const { data: scan } = await admin.from("scans").select("id").eq("store_id", storeId).eq("status", "complete").order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (!scan) return null;
  const [{ data: findings }, { data: applied }] = await Promise.all([
    admin.from("findings").select("finding_key, type, evidence, product_id, title").eq("scan_id", scan.id),
    admin.from("fix_audit_log").select("finding_key").eq("store_id", storeId).eq("status", "applied"),
  ]);
  return { findings: (findings ?? []) as { finding_key: string; type: string; evidence: string; product_id: number | null; title: string }[], applied: new Set((applied ?? []).map((r) => r.finding_key as string)) };
}

// Bulk apply (G8). GET: the auto and one-click fixes of the last scan not applied yet, each with what it changes.
// POST {finding_keys, confirm: true}: applies the chosen ones in one batch (one Undo for all), at most MAX_BULK.
export async function GET(_r: Request, { params }: { params: Promise<{ id: string }> }) {
  const a = await fixAccess((await params).id);
  if (!a.ok) return NextResponse.json({ error: a.error }, { status: a.status });
  const data = await load(a.admin, a.store.id);
  if (!data) return NextResponse.json({ error: "Run a scan first." }, { status: 409 });
  const plan = planBulk(await fixContext(a.admin, a.store), data.findings, data.applied);
  return NextResponse.json({ max: MAX_BULK, items: plan.map((p) => ({ finding_key: p.finding.finding_key, title: p.finding.title, type: p.type, kind: p.kind, ready: p.ready, reason: p.reason, describe: p.describe })) });
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const a = await fixAccess((await params).id);
  if (!a.ok) return NextResponse.json({ error: a.error }, { status: a.status });
  const body = (await request.json().catch(() => ({}))) as { finding_keys?: unknown; confirm?: unknown };
  if (body.confirm !== true) return NextResponse.json({ error: "Confirm the preview first." }, { status: 400 });
  const keys = Array.isArray(body.finding_keys) ? [...new Set(body.finding_keys.filter((k): k is string => typeof k === "string"))] : [];
  if (!keys.length) return NextResponse.json({ error: "Choose at least one fix." }, { status: 400 });
  if (keys.length > MAX_BULK) return NextResponse.json({ error: `At most ${MAX_BULK} fixes at a time.` }, { status: 400 });
  const data = await load(a.admin, a.store.id);
  if (!data) return NextResponse.json({ error: "Run a scan first." }, { status: 409 });
  const ctx = await fixContext(a.admin, a.store);
  const chosen = planBulk(ctx, data.findings, data.applied).filter((p) => keys.includes(p.finding.finding_key) && p.ready);
  if (!chosen.length) return NextResponse.json({ error: "None of these fixes can be applied now." }, { status: 409 });
  const r = await applyFixes(a.admin, ctx, chosen.map((p) => ({ finding: p.finding, type: p.type, kind: p.kind })), { userId: a.userId, automatic: false });
  return NextResponse.json(r);
}
