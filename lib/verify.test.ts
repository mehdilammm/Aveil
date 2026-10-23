import { describe, expect, it } from "vitest";
import type { Finding } from "./rules";
import { bust, groupOf, judge, recheckDue } from "./verify";

const f = (key: string, type: string, product_id: number | null, basis: Finding["basis"] = "observed", evidence = "e"): Finding => ({ finding_key: key, type, product_id, basis, evidence, title: "t", severity: "medium", guidance: "g" });

describe("verify loop", () => {
  it("each finding is re-checked by the check that made it", () => {
    expect(groupOf(f("price_missing:173", "price_missing", 173))).toBe("product");
    expect(groupOf(f("schema_product_missing:173", "schema_product_missing", 173))).toBe("product_page");
    expect(groupOf(f("robots:GPTBot", "robots_blocks_bot", null))).toBe("robots");
    expect(groupOf(f("llms_txt:missing", "llms_txt_missing", null))).toBe("robots");
    expect(groupOf(f("checkout:rate_limited_bots", "checkout_rate_limited_bots", null))).toBe("checkout");
    expect(groupOf(f("access:GPTBot", "access_rate_limited", null))).toBe("access");
    expect(groupOf(f("page:returns", "returns_page_missing", null))).toBe("store_pages");
  });

  it("resolved only when the re-check ran and the finding is gone", () => {
    const target = f("price_missing:173", "price_missing", 173);
    expect(judge(target, [f("image_missing:173", "image_missing", 173)]).status).toBe("resolved");
    expect(judge(target, [f("price_missing:173", "price_missing", 173, "observed", "No price")])).toEqual({ status: "still_open", evidence: "No price" });
    expect(judge(target, { unavailable: "WooCommerce rejected the API key." })).toEqual({ status: "unavailable", evidence: "WooCommerce rejected the API key." });
  });

  it("a page that could not be loaded is not a fix", () => {
    const target = f("schema_product_missing:173", "schema_product_missing", 173);
    expect(judge(target, [f("schema_unavailable:173", "schema_unavailable", 173, "unavailable", "HTTP 503")])).toEqual({ status: "unavailable", evidence: "HTTP 503" });
    // Another product's page being unavailable does not block this one.
    expect(judge(target, [f("schema_unavailable:170", "schema_unavailable", 170, "unavailable")]).status).toBe("resolved");
  });

  it("cache-busting URL and the 7/14/30-day dates", () => {
    expect(bust("https://matha.site/product/x/?a=1", "abc")).toBe("https://matha.site/product/x/?a=1&agsc_verify=abc");
    expect(recheckDue(new Date("2026-10-23T15:00:00Z"), 7)).toBe("2026-10-30T06:00:00.000Z");
  });
});
