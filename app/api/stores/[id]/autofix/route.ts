import type { SupabaseClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { applyFixes, fixContext, planAuto } from "@/lib/autofix";
import { fixAccess } from "@/lib/fix-access";
import { lockedReason, storePlan } from "@/lib/plan-gate";

export const runtime = "nodejs";
export const maxDuration = 300;

async function lastFindings(admin: SupabaseClient, storeId: string) {
  const { data: scan } = await admin.from("scans").select("id").eq("store_id", storeId).eq("status", "complete").order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (!scan) return null;
  const { data } = await admin.from("findings").select("finding_key, type, evidence, product_id, title").eq("scan_id", scan.id);
  return (data ?? []) as { finding_key: string; type: string; evidence: string; product_id: number | null; title: string }[];
}

// GET: the preview of what auto-fix would change now. POST {action: "enable", confirm: true}: one approval, then
// the previewed fixes are applied now and on every scan. POST {action: "disable"}: stops it (applied fixes stay
// until undone).
export async function GET(_r: Request, { params }: { params: Promise<{ id: string }> }) {
  const a = await fixAccess((await params).id);
  if (!a.ok) return NextResponse.json({ error: a.error }, { status: a.status });
  const findings = await lastFindings(a.admin, a.store.id);
  if (!findings) return NextResponse.json({ error: "Run a scan first." }, { status: 409 });
  const plan = planAuto(await fixContext(a.admin, a.store), findings);
  return NextResponse.json({ plan: plan.map((p) => ({ finding_key: p.finding.finding_key, title: p.finding.title, kind: p.kind, ready: p.ready, reason: p.reason, describe: p.describe })) });
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const a = await fixAccess((await params).id);
  if (!a.ok) return NextResponse.json({ error: a.error }, { status: a.status });
  const body = (await request.json().catch(() => ({}))) as { action?: string; confirm?: boolean };
  if (body.action === "disable") {
    await a.admin.from("stores").update({ auto_fix_enabled: false }).eq("id", a.store.id);
    return NextResponse.json({ enabled: false });
  }
  if (!(await storePlan(a.admin, a.store.id)).autoFix) return NextResponse.json({ error: lockedReason("autoFix") }, { status: 403 });
  if (body.action !== "enable" || body.confirm !== true) return NextResponse.json({ error: "Confirm the preview to turn on auto-fix." }, { status: 400 });
  const findings = await lastFindings(a.admin, a.store.id);
  if (!findings) return NextResponse.json({ error: "Run a scan first." }, { status: 409 });
  const ctx = await fixContext(a.admin, a.store);
  const plan = planAuto(ctx, findings);
  await a.admin.from("stores").update({ auto_fix_enabled: true, auto_fix_approved_at: new Date().toISOString(), auto_fix_approved_by: a.userId, auto_fix_preview: plan.map((p) => ({ finding_key: p.finding.finding_key, kind: p.kind, describe: p.describe, ready: p.ready })) }).eq("id", a.store.id);
  const ready = plan.filter((p) => p.ready);
  const r = ready.length ? await applyFixes(a.admin, ctx, ready.map((p) => ({ finding: p.finding, type: p.type, kind: p.kind })), { userId: a.userId, automatic: true }) : null;
  return NextResponse.json({ enabled: true, batchId: r?.batchId ?? null, results: r?.results ?? [] });
}
