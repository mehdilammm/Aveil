import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { applyFixes, fixContext, planAuto } from "./autofix";

// Applies the auto fixes of one scan's findings that are ready and not already applied (and not undone by the
// merchant: an undone fix is not applied again automatically).
export async function runAutoFix(admin: SupabaseClient, store: { id: string; owner_id: string; url: string }, scanId: string) {
  const ctx = await fixContext(admin, store);
  const { data: findings } = await admin.from("findings").select("finding_key, type, evidence, product_id").eq("scan_id", scanId);
  const { data: past } = await admin.from("fix_audit_log").select("finding_key, status").eq("store_id", store.id).in("status", ["applied", "reverted"]);
  const done = new Set((past ?? []).map((p) => p.finding_key as string));
  const plan = planAuto(ctx, (findings ?? []) as never).filter((p) => p.ready && !done.has(p.finding.finding_key));
  if (!plan.length) return { applied: 0 };
  const r = await applyFixes(admin, ctx, plan.map((p) => ({ finding: p.finding, type: p.type, kind: p.kind })), { userId: null, automatic: true });
  return { applied: r.results.filter((x) => x.status === "applied").length, batchId: r.batchId };
}
