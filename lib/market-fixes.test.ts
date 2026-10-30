import { describe, expect, it, vi } from "vitest";
import type { Gateway, ShippingZone } from "./checkout";
import { fakeSupabase } from "./fixtures/fake-supabase";
import { marketCheckout } from "./market-checkout";
import { marketFindings, marketLinks } from "./market-fixes";

vi.mock("server-only", () => ({}));

// matha.site, 2026-10-27 (WooCommerce REST API, read only), as in market-checkout.test.ts.
const SETTINGS = { woocommerce_allowed_countries: "specific", woocommerce_specific_allowed_countries: "MA", woocommerce_ship_to_countries: "", woocommerce_default_country: "MA:mamar", woocommerce_currency: "MAD", woocommerce_calc_taxes: "no", woocommerce_enable_guest_checkout: "yes" };
const ZONES: ShippingZone[] = [
  { id: 0, name: "Locations not covered by your other zones", locations: [], methods: [] },
  { id: 1, name: "Marrakech", locations: [{ code: "MA:mamar", type: "state" }], methods: [{ method_id: "free_shipping", enabled: true }] },
  { id: 2, name: "Morocco", locations: [{ code: "MA", type: "country" }], methods: [{ method_id: "flat_rate", enabled: true }] },
];
const GATEWAYS: Gateway[] = [{ id: "cod", title: "Cash on delivery", enabled: true }];
const rows = (markets: ("US" | "MA")[]) => marketCheckout({ markets, settings: SETTINGS, zones: ZONES, gateways: GATEWAYS, states: { US: 54, MA: 75 }, needsShipping: true });
const URL = "https://matha.site";

describe("Checkout by market → Fix Center items", () => {
  it("matha.site US: one item per blocker and note, with the WooCommerce setting, the row's basis and severity", () => {
    const f = marketFindings(URL, rows(["US"]));
    expect(f.map((x) => [x.finding_key, x.type, x.severity, x.basis])).toEqual([
      ["market:US:notSold", "market_not_sold", "high", "observed"],
      ["market:US:noMethods", "market_no_methods", "high", "observed"],
      ["market:US:statesAsked", "market_states_asked", "low", "heuristic"],
      ["market:US:currency", "market_currency", "low", "observed"],
    ]);
    const no = f[1];
    expect(no.title).toBe("United States: No shipping method");
    expect(no.evidence).toBe('Addresses here fall into the shipping zone "Locations not covered by your other zones", which has no shipping method turned on. An agent cannot complete a checkout for United States.');
    expect(no.guidance).toContain("WooCommerce → Settings → Shipping → the zone → Add shipping method");
    expect(no.fix_url).toBe("https://matha.site/wp-admin/admin.php?page=wc-settings&tab=shipping");
    // Morocco has no blocker: only its notes.
    expect(marketFindings(URL, rows(["MA"])).map((x) => x.finding_key)).toEqual(["market:MA:statesAsked"]);
  });

  it("the last purchase test is named, and Fix Center links to the market row and the test", () => {
    const test = { jobId: "j1", at: "2026-10-27T21:11:47Z", result: { market: "US" as const, country: "US", stoppedAt: "shipping" as const, requests: 9, steps: [{ step: "shipping" as const, outcome: "stop" as const, basis: "observed" as const, code: "noRates", values: {} }] } };
    expect(marketFindings(URL, rows(["US"]), { US: test })[1].evidence).toContain('Last purchase test (2026-10-27): stopped at "shipping" (noRates).');
    expect(marketLinks("s1", "market:US:noMethods")).toEqual({ row: "/stores/s1/markets#market-US", test: "/stores/s1/markets#purchase-test" });
    expect(marketLinks("s1", "checkout:shipping_gap")).toBeNull();
  });
});

// The runner against a fake WooCommerce and database: three checks, one item.
vi.mock("./platform/woocommerce", () => ({
  wooCommerceAdapter: () => ({
    fetchPolicies: async () => ({ settings: { ok: true, data: SETTINGS } }),
    fetchCheckoutSetup: async () => ({ zones: { ok: true, data: ZONES }, gateways: { ok: true, data: GATEWAYS } }),
    fetchProductsPage: async () => ({ items: [{ virtual: false }] }),
  }),
}));
vi.mock("./woo", async (orig) => ({ ...(await orig<typeof import("./woo")>()), fetchCountryStates: async (_u: string, _c: unknown, cc: string) => ({ US: 54, MA: 75 })[cc] ?? null }));
const { refreshMarketFindings } = await import("./market-fixes-run");

describe("refreshMarketFindings", () => {
  it('US "No shipping method" stays one Fix Center item after 3 purchase tests', async () => {
    const { client, tables } = fakeSupabase({
      scans: [{ id: "scan1", store_id: "s1", status: "complete", created_at: "2026-10-28" }],
      visibility_prompts: [{ store_id: "s1", market: "US" }, { store_id: "s1", market: "US" }],
      findings: [{ id: "other", scan_id: "scan1", store_id: "s1", finding_key: "jsonld:returns", job_step: "store" }],
      jobs: [],
    });
    const store = { id: "s1", owner_id: "u1", url: URL };
    for (let i = 0; i < 3; i++) await refreshMarketFindings(client, store, { consumerKey: "ck", consumerSecret: "cs" });
    expect(tables.findings.filter((f) => f.finding_key === "market:US:noMethods")).toHaveLength(1);
    expect(tables.findings.filter((f) => f.job_step === "markets")).toHaveLength(4);
    expect(tables.findings.find((f) => f.finding_key === "jsonld:returns")).toBeTruthy();
  });
});
