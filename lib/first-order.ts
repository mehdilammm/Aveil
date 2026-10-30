// The store's first AI-referred order (processing, completed or on-hold: the statuses ai_orders keeps). One alert
// per store, ever; the banner shows while that order is still counted (a cancelled order leaves ai_orders on the
// next sync, and the alert is closed). Pure.
export type AiOrderRow = { order_id: number; ordered_at: string; total: number | string; currency: string; source: string; via: string; agent_checkout?: boolean };
export type FirstOrderAlert = { id: string; status: string; detail: { order_id?: number } };

export function firstOrderAction(existing: FirstOrderAlert | null, orders: AiOrderRow[]): { insert: AiOrderRow } | { close: string } | null {
  if (!existing) {
    if (!orders.length) return null;
    const first = [...orders].sort((a, b) => a.ordered_at.localeCompare(b.ordered_at) || a.order_id - b.order_id)[0];
    return { insert: first };
  }
  if (existing.status === "open" && !orders.some((o) => Number(o.order_id) === Number(existing.detail.order_id))) return { close: existing.id };
  return null;
}

export const firstOrderTitle = (o: AiOrderRow) => `First order from an AI assistant: #${o.order_id}, ${Number(o.total).toFixed(2)} ${o.currency} (${o.source})`.slice(0, 300);
