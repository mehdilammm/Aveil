import { describe, expect, it } from "vitest";
import { ATTRIBUTION_KEYS, attributionStatus, classifyAttribution, entryPath, revenueByCurrency, summarizeOrders, type WooOrder } from "./ai-orders";

const order = (id: number, meta: Record<string, string>, extra: Partial<WooOrder> = {}): WooOrder => ({
  id,
  date_created_gmt: "2026-10-20T10:00:00",
  total: "120.50",
  currency: "MAD",
  status: "processing",
  created_via: "checkout",
  meta_data: Object.entries(meta).map(([key, value]) => ({ key, value })),
  ...extra,
});
const wc = (k: string) => `_wc_order_attribution_${k}`;

describe("AI-referred orders: attribution parsing", () => {
  it("utm_source=chatgpt.com, referrers and utm in the entry URL", () => {
    expect(classifyAttribution({ utm_source: "chatgpt.com" })).toEqual({ source: "ChatGPT", via: "utm_source" });
    expect(classifyAttribution({ referrer: "https://www.perplexity.ai/search?q=lamps" })).toEqual({ source: "Perplexity", via: "referrer" });
    expect(classifyAttribution({ referrer: "https://gemini.google.com/app" })).toEqual({ source: "Gemini", via: "referrer" });
    expect(classifyAttribution({ referrer: "https://claude.ai/chat/1" })).toEqual({ source: "Claude", via: "referrer" });
    expect(classifyAttribution({ referrer: "https://copilot.microsoft.com/" })).toEqual({ source: "Copilot", via: "referrer" });
    expect(classifyAttribution({ session_entry: "https://shop.test/p/lamp/?utm_source=chatgpt.com" })).toEqual({ source: "ChatGPT", via: "session_entry" });
  });

  it("lookalikes and normal traffic do not match", () => {
    expect(classifyAttribution({ referrer: "https://fake-chatgpt.com/" })).toBeNull();
    expect(classifyAttribution({ referrer: "https://claude.ai.evil.example/" })).toBeNull();
    expect(classifyAttribution({ referrer: "https://www.google.com/", utm_source: "google" })).toBeNull();
  });

  it("the entry path drops the query string (it can hold personal data)", () => {
    expect(entryPath("https://shop.test/p/lamp/?utm_source=chatgpt.com&email=a@b.co")).toBe("/p/lamp/");
  });

  it("stores only non-personal fields; the plugin's note is a fallback", () => {
    const orders = [
      order(1, { [wc("source_type")]: "utm", [wc("utm_source")]: "chatgpt.com", [wc("session_entry")]: "https://shop.test/p/a/?x=1" }),
      order(2, { [wc("source_type")]: "referral", [wc("referrer")]: "https://www.google.com/" }),
      order(3, { _agsc_ai_referral_source: "Perplexity", _agsc_ai_referral_via: "referrer", _agsc_ai_referral_entry: "/p/b/" }, { total: "80", currency: "EUR" }),
      order(4, { _agsc_ai_referral_source: "NotAnAi" }),
    ];
    const s = summarizeOrders(orders);
    expect(s.scanned).toBe(4);
    expect(s.aiOrders.map((o) => [o.order_id, o.source, o.via, o.entry_path])).toEqual([[1, "ChatGPT", "utm_source", "/p/a/"], [3, "Perplexity", "plugin", "/p/b/"]]);
    expect(Object.keys(s.aiOrders[0]).sort()).toEqual(["agent_checkout", "currency", "entry_path", "order_id", "ordered_at", "refunded", "source", "total", "via"]);
    expect(JSON.stringify(s.aiOrders)).not.toMatch(/email|phone|address|billing|@/i);
    expect(revenueByCurrency(s.aiOrders)).toEqual([{ currency: "MAD", total: 120.5, orders: 1 }, { currency: "EUR", total: 80, orders: 1 }]);
  });

  it("the request asks only for attribution keys", () => {
    expect(ATTRIBUTION_KEYS.every((k) => k.startsWith("_wc_order_attribution_") || k.startsWith("_agsc_ai_referral_"))).toBe(true);
    expect(ATTRIBUTION_KEYS).not.toContain("_wc_order_attribution_user_agent");
  });

  it("orders without any attribution: Unavailable with how to turn it on; no orders: a result, not an error", () => {
    const off = attributionStatus(summarizeOrders([order(1, {}), order(2, {})]));
    expect(off.status).toBe("unavailable");
    expect(off.reason).toContain("Order attribution");
    expect(attributionStatus(summarizeOrders([]))).toEqual({ status: "ok", reason: null });
  });

  it("agent checkout only with evidence on the order", () => {
    expect(summarizeOrders([order(1, {}, { created_via: "checkout" })]).agentCheckouts).toBe(0);
    expect(summarizeOrders([order(1, {}, { created_via: "agentic-commerce" })]).agentCheckouts).toBe(1);
  });
});
