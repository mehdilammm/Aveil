import { describe, expect, it, vi } from "vitest";
import { fakeSupabase } from "./fixtures/fake-supabase";
import { firstOrderAction, firstOrderTitle, type AiOrderRow } from "./first-order";

vi.mock("server-only", () => ({}));

const order = (order_id: number, ordered_at: string): AiOrderRow => ({ order_id, ordered_at, total: "800.00", currency: "MAD", source: "chatgpt.com", via: "referrer" });

describe("first AI order", () => {
  it("one alert for the earliest order, never a second one; closed when that order no longer counts", () => {
    expect(firstOrderAction(null, [])).toBeNull();
    expect(firstOrderAction(null, [order(205, "2026-10-29T10:00:00Z"), order(204, "2026-10-28T09:00:00Z")])).toEqual({ insert: order(204, "2026-10-28T09:00:00Z") });
    const open = { id: "a1", status: "open", detail: { order_id: 204 } };
    expect(firstOrderAction(open, [order(204, "2026-10-28T09:00:00Z"), order(205, "2026-10-29T10:00:00Z")])).toBeNull();
    // Cancelled: the sync drops it from ai_orders; the alert closes and no new one comes for order 205.
    expect(firstOrderAction(open, [order(205, "2026-10-29T10:00:00Z")])).toEqual({ close: "a1" });
    expect(firstOrderAction({ ...open, status: "dismissed" }, [order(205, "2026-10-29T10:00:00Z")])).toBeNull();
    expect(firstOrderTitle(order(204, "x"))).toBe("First order from an AI assistant: #204, 800.00 MAD (chatgpt.com)");
  });

  it("the sync writes it once per store and closes it after a cancellation", async () => {
    const { noteFirstAiOrder } = await import("./orders-sync");
    const store = { id: "s1", owner_id: "u1", url: "https://matha.site" };
    const { client, tables } = fakeSupabase({ store_alerts: [], ai_orders: [{ ...order(204, "2026-10-28T09:00:00Z"), store_id: "s1" }] });
    await noteFirstAiOrder(client, store);
    await noteFirstAiOrder(client, store);
    expect(tables.store_alerts).toHaveLength(1);
    expect(tables.store_alerts[0]).toMatchObject({ kind: "first_ai_order", detail: { order_id: 204, total: 800, currency: "MAD", source: "chatgpt.com" } });
    tables.store_alerts[0].status = "open"; // the column default in the database
    tables.ai_orders.length = 0;
    tables.ai_orders.push({ ...order(205, "2026-10-29T10:00:00Z"), store_id: "s1" });
    await noteFirstAiOrder(client, store);
    expect(tables.store_alerts).toHaveLength(1);
    expect(tables.store_alerts[0]).toMatchObject({ status: "dismissed", dismissed_by: null });
  });
});
