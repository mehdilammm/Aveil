import { describe, expect, it } from "vitest";
import { effortOf, fixQueue, weightsFrom } from "./fix-queue";

// Findings of matha.site's scan of 2026-10-23 (types, severities and bases as stored).
const findings = [
  { finding_key: "price_missing:173", type: "price_missing", severity: "high" as const, basis: "observed" as const, product_id: 173 },
  { finding_key: "checkout:shipping_gap", type: "checkout_shipping_gap", severity: "medium" as const, basis: "observed" as const, product_id: null },
  { finding_key: "checkout:rate_limited_bots", type: "checkout_rate_limited_bots", severity: "medium" as const, basis: "heuristic" as const, product_id: null },
  { finding_key: "llms_txt:missing", type: "llms_txt_missing", severity: "low" as const, basis: "observed" as const, product_id: null },
  { finding_key: "feed_identifier_missing:170", type: "feed_identifier_missing", severity: "low" as const, basis: "observed" as const, product_id: 170 },
  { finding_key: "schema_unavailable:9", type: "schema_unavailable", severity: "low" as const, basis: "unavailable" as const, product_id: 9 },
];

describe("prioritized fix queue", () => {
  it("score = (impact × confidence) / effort; unavailable left out; groups", () => {
    const q = fixQueue(findings, new Set([173]));
    expect(q.map((x) => [x.finding.finding_key, x.score, x.group])).toEqual([
      ["price_missing:173", 3, "high_value"], // 3 × 1 × 1 / 1
      ["checkout:shipping_gap", 2, "store"], // 2 × 2 × 1 / 2
      ["llms_txt:missing", 2, "store"], // 1 × 2 × 1 / 1
      ["checkout:rate_limited_bots", 0.67, "store"], // 2 × 2 × 0.5 / 3
      ["feed_identifier_missing:170", 0.5, "product"], // 1 × 1 × 1 / 2
    ]);
    expect(q.some((x) => x.finding.basis === "unavailable")).toBe(false);
  });

  it("weights from the page, bounded; heuristic never counts more than observed", () => {
    expect(weightsFrom({ w_high: "5", w_heuristic: "3", w_store: "0" })).toEqual({ severity: { high: 5, medium: 2, low: 1 }, storeWide: 1, confidence: { observed: 1, heuristic: 1 } });
    const q = fixQueue(findings, new Set(), weightsFrom({ w_store: "1" }));
    expect(q.find((x) => x.finding.finding_key === "llms_txt:missing")!.score).toBe(1);
  });

  it("effort by kind of fix", () => {
    expect(effortOf("price_missing")).toBe(1);
    expect(effortOf("schema_product_missing")).toBe(3);
    expect(effortOf("returns_page_missing")).toBe(2);
  });
});

import real from "./fixtures/matha-findings-2026-10-23.json";
describe("matha.site's real scan (24 findings)", () => {
  it("the missing price comes first, then store-wide shipping, images and llms.txt; heuristic 429s rank low", () => {
    const q = fixQueue(real.findings as never, new Set(real.sample));
    expect(q).toHaveLength(24);
    expect(q.slice(0, 5).map((x) => [x.finding.finding_key, x.score])).toEqual([
      ["price_missing:173", 3],
      ["checkout:shipping_gap", 2],
      ["image_missing:171", 2],
      ["image_missing:174", 2],
      ["llms_txt:missing", 2],
    ]);
    expect(q.find((x) => x.finding.finding_key === "access:GPTBot")!.score).toBe(0.67);
    expect(q.at(-1)!.finding.finding_key).toBe("checkout:offline_payment_only");
  });
});
