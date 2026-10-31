import "server-only";
// The data behind the AI Revenue funnel, read once for the AI Revenue page and the Overview (same queries as before).
import type { SupabaseClient } from "@supabase/supabase-js";
import { ORDER_WINDOW_DAYS, revenueByCurrency } from "./ai-orders";
import { findingsForScan, listScans } from "./data";
import { buildFunnel, diagnose, type FunnelInput } from "./funnel";
import { PLANS, type PlanId } from "./plans";
import { createAdminClient } from "./supabase/admin";
import { CHECKER_CONFIDENCE } from "./traffic";

export const TRAFFIC_DAYS = 30;

export async function loadFunnel(supabase: SupabaseClient, id: string) {
  const scans = await listScans(supabase, id, 10);
  const lastComplete = scans.find((s) => s.status === "complete");
  const findings = lastComplete ? await findingsForScan(supabase, lastComplete.id) : [];

  const { data: runs } = await supabase.from("visibility_runs").select("id").eq("store_id", id).eq("status", "complete").order("created_at", { ascending: false }).limit(1);
  const { data: answers } = runs?.[0]
    ? await supabase.from("visibility_results").select("mentioned").eq("run_id", runs[0].id).eq("engine", "gemini").not("answer", "is", null)
    : { data: [] };

  const since = new Date(Date.now() - (TRAFFIC_DAYS - 1) * 86_400_000).toISOString().slice(0, 10);
  const { data: traffic } = await supabase.from("traffic_daily").select("category, confidence, hits").eq("store_id", id).gte("day", since).limit(5000);
  const botVisits = (traffic ?? []).filter((r) => r.confidence === "unverified-user-agent").reduce((n, r) => n + r.hits, 0);
  const aiReferrals = (traffic ?? []).filter((r) => r.category === "human-ai-referral" && r.confidence !== CHECKER_CONFIDENCE).reduce((n, r) => n + r.hits, 0);

  const admin = createAdminClient();
  const [{ data: connector }, { data: ws }] = await Promise.all([
    admin.from("traffic_connectors").select("store_id").eq("store_id", id).maybeSingle(),
    admin.from("stores").select("workspaces(plan)").eq("id", id).maybeSingle(),
  ]);
  const wsRow = (ws as { workspaces?: { plan?: string } | { plan?: string }[] } | null)?.workspaces;
  const planId = ((Array.isArray(wsRow) ? wsRow[0]?.plan : wsRow?.plan) ?? "free") as PlanId;
  const plan = PLANS[planId] ?? PLANS.free;

  const [{ data: sync }, { data: orders }] = await Promise.all([
    supabase.from("order_syncs").select("synced_at, status, reason, orders_scanned, ai_orders, agent_checkouts").eq("store_id", id).maybeSingle(),
    supabase.from("ai_orders").select("order_id, ordered_at, total, refunded, currency, source, via, entry_path, agent_checkout").eq("store_id", id).order("ordered_at", { ascending: false }).limit(200),
  ]);
  const aiOrders = (orders ?? []).map((o) => ({ ...o, total: Number(o.total), refunded: Number(o.refunded) }));

  let ordersInput: FunnelInput["orders"];
  if (!plan.aiRevenue) ordersInput = { kind: "locked" };
  else if (!sync) ordersInput = { kind: "not_synced" };
  else if (sync.status !== "ok") ordersInput = { kind: "unavailable", reason: sync.reason ?? "Orders could not be read." };
  else ordersInput = { kind: "ok", scanned: sync.orders_scanned, aiOrders: aiOrders.length, revenue: revenueByCurrency(aiOrders), agentCheckouts: sync.agent_checkouts, days: ORDER_WINDOW_DAYS };

  const stages = buildFunnel({
    scanned: Boolean(lastComplete),
    findings: findings.map((f) => ({ finding_key: f.finding_key, type: f.type, title: f.title, severity: f.severity, basis: f.basis, evidence: f.evidence, guidance: f.guidance })),
    visibility: answers ? { asked: answers.length, mentioned: answers.filter((a) => a.mentioned).length } : null,
    plugin: { connected: Boolean(connector), botVisits, aiReferrals, days: TRAFFIC_DAYS },
    orders: ordersInput,
  });
  return { stages, diagnosis: diagnose(stages), lastComplete, plan, sync, aiOrders, findings };
}
