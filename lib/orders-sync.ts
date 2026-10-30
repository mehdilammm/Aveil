import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { ATTRIBUTION_KEYS, attributionStatus, MAX_ORDERS, ORDER_WINDOW_DAYS, reconcileFrom, staleOrderIds, summarizeOrders } from "./ai-orders";
import { firstOrderAction, firstOrderTitle, type AiOrderRow, type FirstOrderAlert } from "./first-order";
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
// Each sync replaces what it covers: orders updated in place (status, total, refunds), and stored orders that
// are no longer in the result removed, so revenue is recomputed rather than added to.
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
  const { data: stored, error: readError } = await admin.from("ai_orders").select("order_id").eq("store_id", store.id).gte("ordered_at", reconcileFrom(result.data));
  if (readError) throw readError;
  const stale = staleOrderIds((stored ?? []).map((r: { order_id: number | string }) => Number(r.order_id)), summary.aiOrders.map((o) => o.order_id));
  for (let i = 0; i < stale.length; i += 200) {
    const { error } = await admin.from("ai_orders").delete().eq("store_id", store.id).in("order_id", stale.slice(i, i + 200));
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
  await noteFirstAiOrder(admin, store);
  return { status: st.status, reason: st.reason, aiOrders: summary.aiOrders.length };
}

// The first AI-referred order: one alert per store, closed when that order no longer counts (cancelled). A failure
// here never fails the sync.
export async function noteFirstAiOrder(admin: SupabaseClient, store: Store) {
  try {
    const [{ data: existing }, { data: orders }] = await Promise.all([
      admin.from("store_alerts").select("id, status, detail").eq("store_id", store.id).eq("kind", "first_ai_order").order("created_at", { ascending: true }).limit(1).maybeSingle(),
      admin.from("ai_orders").select("order_id, ordered_at, total, currency, source, via, agent_checkout").eq("store_id", store.id),
    ]);
    const action = firstOrderAction((existing as FirstOrderAlert | null) ?? null, (orders ?? []) as AiOrderRow[]);
    if (!action) return;
    if ("insert" in action) {
      const o = action.insert;
      const { error } = await admin.from("store_alerts").insert({ store_id: store.id, owner_id: store.owner_id, kind: "first_ai_order", title: firstOrderTitle(o), detail: { order_id: Number(o.order_id), ordered_at: o.ordered_at, total: Number(o.total), currency: o.currency, source: o.source, via: o.via, agent_checkout: Boolean(o.agent_checkout) }, event_ids: [] });
      if (error) console.error("first AI order alert not saved", store.id, error.message);
    } else {
      await admin.from("store_alerts").update({ status: "dismissed", dismissed_at: new Date().toISOString(), dismissed_by: null }).eq("id", action.close);
    }
  } catch (err) {
    console.error("first AI order check failed", store.id, err instanceof Error ? err.message : "unknown");
  }
}
