import { beforeEach, describe, expect, it, vi } from "vitest";
import { aiOrdersLabel, reconcileFrom, revenueByCurrency, staleOrderIds, summarizeOrders, type WooOrder } from "./ai-orders";

vi.mock("server-only", () => ({}));

// What WooCommerce answers to the order query (only counted statuses are asked for).
let wooOrders: WooOrder[] = [];
vi.mock("./woo", () => ({
  fetchRecentOrders: async (_u: string, _c: unknown, _d: number, _m: number, _k: string[]) => ({ ok: true, data: wooOrders.filter((o) => ["processing", "completed", "on-hold"].includes(o.status ?? "")) }),
}));

const recent = new Date(Date.now() - 2 * 86_400_000).toISOString().slice(0, 19);
const chatgpt = (id: number, extra: Partial<WooOrder> = {}): WooOrder => ({
  id,
  date_created_gmt: recent,
  total: "2400.00",
  currency: "MAD",
  status: "processing",
  created_via: "checkout",
  meta_data: [
    { key: "_wc_order_attribution_source_type", value: "utm" },
    { key: "_wc_order_attribution_utm_source", value: "chatgpt.com" },
  ],
  ...extra,
});

// In-memory ai_orders / order_syncs with the query calls syncOrders makes.
function fakeAdmin() {
  const tables: Record<string, Record<string, unknown>[]> = { ai_orders: [], order_syncs: [] };
  const from = (table: string) => {
    const rows = tables[table];
    let op: "select" | "delete" = "select";
    const filters: ((r: Record<string, unknown>) => boolean)[] = [];
    const q: Record<string, unknown> = {
      upsert: async (payload: Record<string, unknown> | Record<string, unknown>[]) => {
        for (const p of Array.isArray(payload) ? payload : [payload]) {
          const i = rows.findIndex((r) => (table === "ai_orders" ? r.store_id === p.store_id && r.order_id === p.order_id : r.store_id === p.store_id));
          if (i >= 0) rows[i] = { ...rows[i], ...p };
          else rows.push({ ...p });
        }
        return { error: null };
      },
      select: () => ((op = "select"), q),
      delete: () => ((op = "delete"), q),
      eq: (c: string, v: unknown) => (filters.push((r) => r[c] === v), q),
      gte: (c: string, v: string) => (filters.push((r) => String(r[c]) >= v), q),
      lt: (c: string, v: string) => (filters.push((r) => String(r[c]) < v), q),
      in: (c: string, v: unknown[]) => (filters.push((r) => v.includes(r[c])), q),
      then: (resolve: (v: unknown) => void) => {
        const hit = rows.filter((r) => filters.every((f) => f(r)));
        if (op === "delete") tables[table] = rows.filter((r) => !hit.includes(r));
        return resolve({ data: op === "select" ? hit : null, error: null });
      },
    };
    return q;
  };
  return { admin: { from } as never, tables };
}

const store = { id: "s1", owner_id: "u1", url: "https://matha.site" };
const creds = { consumerKey: "ck", consumerSecret: "cs" };

async function sync(admin: never) {
  const { syncOrders } = await import("./orders-sync");
  return syncOrders(admin, store, creds);
}
const net = (rows: Record<string, unknown>[]) => revenueByCurrency(rows.map((r) => ({ total: Number(r.total), refunded: Number(r.refunded), currency: String(r.currency) })));

describe("orders sync reconciles with WooCommerce", () => {
  beforeEach(() => {
    wooOrders = [];
  });

  it("an order cancelled after a sync is removed on the next sync", async () => {
    const { admin, tables } = fakeAdmin();
    wooOrders = [chatgpt(213)];
    expect((await sync(admin)).aiOrders).toBe(1);
    expect(net(tables.ai_orders)).toEqual([{ currency: "MAD", total: 2400, orders: 1 }]);

    wooOrders = [chatgpt(213, { status: "cancelled" })];
    expect((await sync(admin)).aiOrders).toBe(0);
    expect(tables.ai_orders).toEqual([]);
    expect(tables.order_syncs[0]).toMatchObject({ ai_orders: 0 });
  });

  it("a fully refunded order is not counted (and is removed if it was)", async () => {
    const { admin, tables } = fakeAdmin();
    wooOrders = [chatgpt(214)];
    await sync(admin);
    // Still "completed" in the REST answer while carrying a full refund: excluded all the same.
    wooOrders = [chatgpt(214, { status: "completed", refunds: [{ total: "-2400.00" }] })];
    expect((await sync(admin)).aiOrders).toBe(0);
    expect(tables.ai_orders).toEqual([]);
    // Status "refunded" is not in the counted statuses either.
    wooOrders = [chatgpt(214, { status: "refunded", refunds: [{ total: "-2400.00" }] })];
    expect((await sync(admin)).aiOrders).toBe(0);
  });

  it("a partial refund lowers the revenue by the refunded amount", async () => {
    const { admin, tables } = fakeAdmin();
    wooOrders = [chatgpt(215, { refunds: [{ total: "-400.00" }, { total: "-100.50" }] }), chatgpt(216, { total: "100.00" })];
    await sync(admin);
    expect(tables.ai_orders.find((r) => r.order_id === 215)).toMatchObject({ total: 2400, refunded: 500.5 });
    expect(net(tables.ai_orders)).toEqual([{ currency: "MAD", total: 1999.5, orders: 2 }]);
  });

  it("an order back from cancelled to processing is counted again, without adding twice", async () => {
    const { admin, tables } = fakeAdmin();
    wooOrders = [chatgpt(217)];
    await sync(admin);
    wooOrders = [chatgpt(217, { status: "cancelled" })];
    await sync(admin);
    expect(tables.ai_orders).toEqual([]);
    wooOrders = [chatgpt(217, { status: "processing" })];
    await sync(admin);
    await sync(admin);
    expect(tables.ai_orders).toHaveLength(1);
    expect(net(tables.ai_orders)).toEqual([{ currency: "MAD", total: 2400, orders: 1 }]);
  });

  it("orders of other stores are never touched", async () => {
    const { admin, tables } = fakeAdmin();
    tables.ai_orders.push({ store_id: "other", order_id: 1, ordered_at: new Date().toISOString(), total: 50, refunded: 0, currency: "MAD" });
    wooOrders = [];
    await sync(admin);
    expect(tables.ai_orders).toHaveLength(1);
  });
});

describe("statuses, refunds and labels", () => {
  it("only processing, completed and on-hold count", () => {
    const statuses = ["processing", "completed", "on-hold", "pending", "cancelled", "failed", "refunded", "trash", "checkout-draft"];
    const s = summarizeOrders(statuses.map((status, i) => chatgpt(i + 1, { status })));
    expect(s.aiOrders.map((o) => o.order_id)).toEqual([1, 2, 3]);
  });

  it("stale ids and the covered range", () => {
    expect(staleOrderIds([1, 2, 3], [2])).toEqual([1, 3]);
    const now = Date.parse("2026-10-23T00:00:00Z");
    expect(reconcileFrom([], now)).toBe("2026-07-25T00:00:00.000Z");
    const many = Array.from({ length: 1000 }, (_, i) => chatgpt(i + 1, { date_created_gmt: i === 999 ? "2026-10-01T00:00:00" : "2026-10-20T00:00:00" }));
    expect(reconcileFrom(many, now)).toBe("2026-10-01T00:00:00.000Z");
  });

  it("singular and plural", () => {
    expect(aiOrdersLabel(0)).toBe("0 AI-referred orders");
    expect(aiOrdersLabel(1)).toBe("1 AI-referred order");
    expect(aiOrdersLabel(2)).toBe("2 AI-referred orders");
  });
});
