import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { applyFixes, fixContext, planAuto } from "./autofix";

// Applies the auto fixes of one scan's findings that are ready and not already applied (and not undone by the
// merchant: an undone fix is not applied again automatically). A fix that failed in the last 7 days is not tried
// again on every scan (for example a feature that needs a newer plugin than the store has).
const RETRY_FAILED_AFTER_MS = 7 * 86_400_000;
export async function runAutoFix(admin: SupabaseClient, store: { id: string; owner_id: string; url: string }, scanId: string) {
  const ctx = await fixContext(admin, store);
  const { data: findings } = await admin.from("findings").select("finding_key, type, evidence, product_id").eq("scan_id", scanId);
  const { data: past } = await admin.from("fix_audit_log").select("finding_key, status, applied_at").eq("store_id", store.id).in("status", ["applied", "reverted", "failed"]);
  const since = Date.now() - RETRY_FAILED_AFTER_MS;
  const done = new Set((past ?? []).filter((p) => p.status !== "failed" || Date.parse(String(p.applied_at)) > since).map((p) => p.finding_key as string));
  const plan = planAuto(ctx, (findings ?? []) as never).filter((p) => p.ready && !done.has(p.finding.finding_key));
  if (!plan.length) return { applied: 0 };
  const r = await applyFixes(admin, ctx, plan.map((p) => ({ finding: p.finding, type: p.type, kind: p.kind })), { userId: null, automatic: true });
  return { applied: r.results.filter((x) => x.status === "applied").length, batchId: r.batchId };
}
