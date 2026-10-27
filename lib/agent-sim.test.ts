import { describe, expect, it } from "vitest";
import { SIM_LIMITS, simulatePurchase, type Send, type SimResponse } from "./agent-sim";
import { isAgentScopeCheck } from "./check-header";

type Call = { method: string; path: string; headers: Record<string, string>; body?: unknown };
const headers = (h: Record<string, string> = {}, cookies: string[] = []): SimResponse["headers"] => ({
  get: (n) => Object.entries(h).find(([k]) => k.toLowerCase() === n.toLowerCase())?.[1] ?? null,
  getSetCookie: () => cookies,
});
const json = (status: number, body: unknown, h: Record<string, string> = {}, cookies: string[] = []): SimResponse => ({ status, headers: headers(h, cookies), text: JSON.stringify(body) });

// A Store API shaped like matha.site's (2026-10-27): sells and ships to Morocco only (Morocco zone: flat rate),
// cash on delivery only, MAD with 2 decimals.
function store(opts: { robots?: string; products?: unknown[]; addFails?: number[]; noToken?: boolean } = {}) {
  const calls: Call[] = [];
  let items: number[] = [];
  let country = "";
  const cart = () => ({
    items_count: items.length,
    needs_shipping: true,
    needs_payment: true,
    shipping_rates: country === "MA" ? [{ shipping_rates: [{ name: "Delivery across Morocco", price: "3000", currency_code: "MAD", currency_minor_unit: 2 }] }] : [],
    payment_methods: ["cod"],
    errors: [],
    totals: { total_price: String(80000 * items.length + (country === "MA" ? 3000 : 0)), currency_code: "MAD", currency_minor_unit: 2 },
  });
  const send: Send = async (url, init) => {
    const body = init.body ? JSON.parse(init.body) : undefined;
    calls.push({ method: init.method, path: url.pathname + url.search, headers: init.headers, body });
    const auth: Record<string, string> = opts.noToken ? {} : { "Cart-Token": "tok-1", Nonce: "n-1" };
    if (url.pathname === "/robots.txt") return { status: 200, headers: headers(), text: opts.robots ?? "User-agent: *\nDisallow: /wp-admin/\n" };
    if (url.pathname === "/wp-json/wc/store/v1/products") return json(200, opts.products ?? [
      { id: 11, name: "Babouche cuir", type: "simple", is_purchasable: true, is_in_stock: true },
      { id: 12, name: "Tapis berb&#232;re", type: "simple", is_purchasable: true, is_in_stock: true },
      { id: 13, name: "Out of stock lamp", type: "simple", is_purchasable: true, is_in_stock: false },
      { id: 14, name: "Tajine", type: "simple", is_purchasable: true, is_in_stock: true },
      { id: 15, name: "Plateau", type: "simple", is_purchasable: true, is_in_stock: true },
    ]);
    if (url.pathname === "/wp-json/wc/store/v1/cart" && init.method === "GET") return json(200, cart(), auth, ["wp_woocommerce_session_x=abc; path=/; HttpOnly"]);
    if (url.pathname === "/wp-json/wc/store/v1/cart/add-item") {
      if (opts.addFails?.includes(body.id)) return json(400, { code: "woocommerce_rest_cart_product_is_not_purchasable", message: "This product cannot be purchased." });
      items.push(body.id);
      return json(201, cart(), auth);
    }
    if (url.pathname === "/wp-json/wc/store/v1/cart/update-customer") {
      country = body.shipping_address.country;
      return json(200, cart(), auth);
    }
    if (url.pathname === "/wp-json/wc/store/v1/cart/items" && init.method === "DELETE") {
      items = [];
      return json(200, []);
    }
    return json(404, { code: "rest_no_route", message: "No route was found matching the URL and request method." });
  };
  return { send, calls, items: () => items };
}
const run = (s: ReturnType<typeof store>, market: "MA" | "US" = "MA", checkToken: string | null = "conn-token") => simulatePurchase({ storeUrl: "https://matha.site", market, checkToken, send: s.send, gapMs: 0 });

describe("agent purchase test, Mode A (F7)", () => {
  it("matha-like store, market MA: reaches the order (not placed), cash on delivery only, cart emptied", async () => {
    const s = store();
    const r = await run(s);
    expect(r.stoppedAt).toBeNull();
    expect(r.steps.map((x) => [x.step, x.outcome, x.code])).toEqual([
      ["robots", "ok", "robotsOk"],
      ["products", "ok", "productsOk"],
      ["cart", "ok", "cartOk"],
      ["add", "ok", "addOk"],
      ["add", "ok", "addOk"],
      ["add", "ok", "addOk"],
      ["address", "ok", "addressOk"],
      ["shipping", "ok", "shippingOk"],
      ["payment", "warn", "paymentOffline"],
      ["order", "skip", "orderNever"],
      ["cleanup", "ok", "cleanupOk"],
    ]);
    expect(r.steps[1].values).toEqual({ n: 3, names: '"Babouche cuir", "Tapis berbère", "Tajine"' });
    expect(r.steps.find((x) => x.code === "shippingOk")!.values).toEqual({ rates: "Delivery across Morocco (30.00 MAD)" });
    expect(r.steps.find((x) => x.code === "paymentOffline")!.basis).toBe("heuristic");
    expect(r.steps.find((x) => x.code === "orderNever")!).toMatchObject({ basis: "unavailable", values: { total: "2430.00 MAD" } });
    expect(s.items()).toEqual([]);
    expect(r.requests).toBe(8);
  });

  it("never touches checkout; sends the AgentScope user agent, a signed check header, the Cart-Token, Nonce and session cookie", async () => {
    const s = store();
    await run(s);
    expect(s.calls.some((c) => /checkout/.test(c.path))).toBe(false);
    expect(s.calls.map((c) => `${c.method} ${c.path.split("?")[0]}`)).toEqual([
      "GET /robots.txt",
      "GET /wp-json/wc/store/v1/products",
      "GET /wp-json/wc/store/v1/cart",
      "POST /wp-json/wc/store/v1/cart/add-item",
      "POST /wp-json/wc/store/v1/cart/add-item",
      "POST /wp-json/wc/store/v1/cart/add-item",
      "POST /wp-json/wc/store/v1/cart/update-customer",
      "DELETE /wp-json/wc/store/v1/cart/items",
    ]);
    for (const c of s.calls) {
      expect(c.headers["User-Agent"]).toMatch(/^AgentScopeBot\//);
      expect(isAgentScopeCheck(c.headers["X-AgentScope-Check"], "conn-token")).toBe(true);
    }
    const add = s.calls.find((c) => c.path.endsWith("/add-item"))!;
    expect(add.headers).toMatchObject({ "Cart-Token": "tok-1", Nonce: "n-1", Cookie: "wp_woocommerce_session_x=abc", "Content-Type": "application/json" });
    expect(add.body).toEqual({ id: 11, quantity: 1 });
    const addr = s.calls.find((c) => c.path.endsWith("/update-customer"))!.body as { shipping_address: Record<string, string>; billing_address: Record<string, string> };
    expect(addr.shipping_address).toEqual({ country: "MA", city: "Casablanca", postcode: "20000" });
    expect(Object.keys(addr.billing_address)).not.toContain("email");
  });

  it("market US on the same store: stops at shipping, and the cart is still emptied", async () => {
    const s = store();
    const r = await run(s, "US");
    expect(r.stoppedAt).toBe("shipping");
    const stop = r.steps.find((x) => x.outcome === "stop")!;
    expect(stop).toMatchObject({ code: "shippingNone", basis: "observed", values: { address: "New York, NY, 10001, US" } });
    expect(r.steps.at(-1)!.code).toBe("cleanupOk");
    expect(s.items()).toEqual([]);
  });

  it("robots.txt Disallow for AgentScopeBot on the Store API: stops before any cart request", async () => {
    const s = store({ robots: "User-agent: AgentScopeBot\nDisallow: /wp-json/\n" });
    const r = await run(s);
    expect(r.stoppedAt).toBe("robots");
    expect(r.steps).toEqual([{ step: "robots", outcome: "stop", basis: "observed", code: "robotsBlocked", values: { path: "/wp-json/wc/store/v1/products" }, http: "HTTP 200" }]);
    expect(s.calls.map((c) => c.path)).toEqual(["/robots.txt"]);
  });

  it("a product that cannot be added is reported with the store's own message; none added stops with nothing to empty", async () => {
    const one = await run(store({ addFails: [12] }));
    expect(one.steps.find((x) => x.code === "addError")!.values).toEqual({ name: "Tapis berbère", code: "woocommerce_rest_cart_product_is_not_purchasable", message: "This product cannot be purchased." });
    const s = store({ addFails: [11, 12, 14] });
    const none = await run(s);
    expect(none.stoppedAt).toBe("add");
    expect(s.calls.some((c) => c.method === "DELETE")).toBe(false);
  });

  it("no product to buy, and a cart without a Cart-Token", async () => {
    const r = await run(store({ products: [{ id: 1, name: "Shirt", type: "simple", is_purchasable: true, is_in_stock: false }] }));
    expect(r.steps.at(-1)).toMatchObject({ step: "products", outcome: "stop", code: "noProduct", values: { listed: 1 } });
    const t = await run(store({ noToken: true }));
    expect(t.steps.find((x) => x.step === "cart")!.code).toBe("cartNoToken");
  });

  it("stays within 15 requests (redirect hops count) and keeps the last one for emptying the cart", async () => {
    const s = store();
    const seen = new Map<string, number>();
    // Every GET is redirected three times (same URL) before it is answered.
    const hops: Send = async (url, init) => {
      const n = seen.get(url.pathname) ?? 0;
      if (init.method === "GET" && n < 3) {
        seen.set(url.pathname, n + 1);
        return { status: 301, headers: headers({ location: url.toString() }), text: "" };
      }
      return s.send(url, init);
    };
    const r = await simulatePurchase({ storeUrl: "https://matha.site", market: "MA", checkToken: null, send: hops, gapMs: 0 });
    expect(r.requests).toBe(SIM_LIMITS.requests);
    expect(r.steps.filter((x) => x.code === "addOk")).toHaveLength(2);
    expect(r.steps.find((x) => x.code === "addError")!.values.message).toBe("the 15-request limit was reached");
    expect(r.stoppedAt).toBe("address");
    expect(r.steps.at(-1)!.code).toBe("cleanupOk");
    expect(s.items()).toEqual([]);
  });

  it("a redirect to another site is not followed", async () => {
    const away: Send = async () => ({ status: 302, headers: headers({ location: "https://elsewhere.example/robots.txt" }), text: "" });
    const r = await simulatePurchase({ storeUrl: "https://matha.site", market: "MA", checkToken: null, send: away, gapMs: 0 });
    expect(r.steps.map((x) => x.code)).toEqual(["robotsUnread", "productsHttp"]);
    expect(r.steps[0].values).toEqual({ detail: "redirected to another site (elsewhere.example)" });
    expect(r.requests).toBe(2);
  });
});
