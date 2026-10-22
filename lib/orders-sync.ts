import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { ATTRIBUTION_KEYS, attributionStatus, MAX_ORDERS, ORDER_WINDOW_DAYS, summarizeOrders } from "./ai-orders";
import { PLANS, type PlanId } from "./plans";
import { fetchRecentOrders, type WooCredentials } from "./woo";

type Store = { id: string; owner_id: string; url: string; workspace_id?: string };

export async function planOf(admin: SupabaseClient, storeId: string): Promise<PlanId> {
  const { data } = await admin.from("stores").select("workspaces(plan)").eq("id", storeId).maybeSingle();
  const ws = (data as { workspaces?: { plan?: string } | { plan?: string }[] } | null)?.workspaces;
  const plan = (Array.isArray(ws) ? ws[0]?.plan : ws?.plan) as PlanId | undefined;
  return plan && plan in PLANS ? plan : "free";
}

// Reads the last 90 days of orders, keeps the AI-referred ones (non-personal fields only) and records the result.
export async function syncOrders(admin: SupabaseClient, store: Store, creds: WooCredentials): Promise<{ status: string; reason: string | null; aiOrders: number }> {
  const result = await fetchRecentOrders(store.url, creds, ORDER_WINDOW_DAYS, MAX_ORDERS, ATTRIBUTION_KEYS);
  const base = { store_id: store.id, owner_id: store.owner_id, synced_at: new Date().toISOString() };
  if (!result.ok) {
    await admin.from("order_syncs").upsert({ ...base, status: "unavailable", reason: result.reason, orders_scanned: 0, with_attribution: 0, ai_orders: 0, agent_checkouts: 0 });
    return { status: "unavailable", reason: result.reason, aiOrders: 0 };
  }
  const summary = summarizeOrders(result.data);
  const st = attributionStatus(summary);
  if (summary.aiOrders.length) {
    const { error } = await admin.from("ai_orders").upsert(
      summary.aiOrders.map((o) => ({ ...o, store_id: store.id, owner_id: store.owner_id })),
      { onConflict: "store_id,order_id" },
    );
    if (error) throw error;
  }
  // Orders older than the window are dropped.
  await admin.from("ai_orders").delete().eq("store_id", store.id).lt("ordered_at", new Date(Date.now() - ORDER_WINDOW_DAYS * 86_400_000).toISOString());
  await admin.from("order_syncs").upsert({
    ...base,
    status: st.status,
    reason: st.reason,
    orders_scanned: summary.scanned,
    with_attribution: summary.withAttribution,
    ai_orders: summary.aiOrders.length,
    agent_checkouts: summary.agentCheckouts,
  });
  return { status: st.status, reason: st.reason, aiOrders: summary.aiOrders.length };
}
