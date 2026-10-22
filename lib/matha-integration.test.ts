import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { attributionStatus, summarizeOrders } from "./ai-orders";
import { checkCheckout } from "./checkout";
import { buildFunnel, diagnose } from "./funnel";

// Real data from matha.site (see the fixture's note).
const m = JSON.parse(readFileSync(join(__dirname, "fixtures/matha-2026-10-23.json"), "utf8"));

describe("matha.site (real data, 2026-10-23)", () => {
  const orders = summarizeOrders(m.orders);
  const findings = checkCheckout({
    storeUrl: "https://matha.site",
    settings: { ok: true, data: { woocommerce_enable_guest_checkout: m.guest_checkout, woocommerce_allowed_countries: m.allowed_countries, woocommerce_ship_to_countries: m.ship_to_countries } },
    zones: { ok: true, data: m.zones },
    gateways: { ok: true, data: m.gateways },
    checkoutPage: null,
    products: m.products,
  });

  it("0 orders: 'No AI-referred orders yet', not an error", () => {
    expect(attributionStatus(orders)).toEqual({ status: "ok", reason: null });
    const buy = buildFunnel({
      scanned: true,
      findings: findings.map((f) => ({ ...f, basis: f.basis })),
      visibility: null,
      plugin: { connected: true, botVisits: 0, aiReferrals: 0, days: 30 },
      orders: { kind: "ok", scanned: orders.scanned, aiOrders: orders.aiOrders.length, revenue: [], agentCheckouts: 0, days: 90 },
    }).find((s) => s.key === "buy")!;
    expect(buy.value).toBe("No AI-referred orders yet");
  });

  it("checkout: COD only (info) and ships to Morocco only while selling everywhere", () => {
    expect(findings.map((f) => f.finding_key)).toEqual(["checkout:shipping_gap", "checkout:offline_payment_only"]);
    const d = diagnose(buildFunnel({ scanned: true, findings: findings as never, visibility: { asked: 5, mentioned: 0 }, plugin: { connected: true, botVisits: 3, aiReferrals: 0, days: 30 }, orders: { kind: "ok", scanned: 0, aiOrders: 0, revenue: [], agentCheckouts: 0, days: 90 } }));
    expect(d.stage!.key).toBe("recommend");
  });
});
