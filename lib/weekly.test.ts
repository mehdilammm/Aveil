import { describe, expect, it } from "vitest";
import { renderWeeklyEmail } from "./email";
import { weeklySummary } from "./weekly";

describe("weeklySummary", () => {
  it("needs two scans", () => {
    expect(weeklySummary([{ id: "a", finishedAt: "2026-10-01T00:00:00Z", keys: ["x"] }])).toBeNull();
  });

  it("compares with the latest scan at least a week old", () => {
    const s = weeklySummary([
      { id: "s1", finishedAt: "2026-10-01T00:00:00Z", keys: ["price:1", "image:2"] },
      { id: "s2", finishedAt: "2026-10-10T00:00:00Z", keys: ["price:1", "weight:3"] }, // image:2 fixed here
      { id: "s3", finishedAt: "2026-10-15T00:00:00Z", keys: ["weight:3"] },
      { id: "s4", finishedAt: "2026-10-20T00:00:00Z", keys: ["image:2", "brand:4"] },
    ]);
    expect(s).toMatchObject({ fromScanId: "s2", toScanId: "s4", open: 2 });
    expect(s?.fixed.sort()).toEqual(["price:1", "weight:3"]);
    expect(s?.added).toEqual(["brand:4"]);
    expect(s?.recurred).toEqual(["image:2"]);
  });

  it("uses the oldest scan when history is shorter than a week", () => {
    const s = weeklySummary([
      { id: "s1", finishedAt: "2026-10-18T00:00:00Z", keys: ["a"] },
      { id: "s2", finishedAt: "2026-10-20T00:00:00Z", keys: ["b"] },
    ]);
    expect(s).toMatchObject({ fromScanId: "s1", fixed: ["a"], added: ["b"], recurred: [] });
  });
});

describe("renderWeeklyEmail", () => {
  it("renders a plain-text summary with titles", () => {
    const summary = weeklySummary([
      { id: "s1", finishedAt: "2026-10-01T00:00:00Z", keys: ["price_missing:1"] },
      { id: "s2", finishedAt: "2026-10-09T00:00:00Z", keys: ["feed_brand_missing:2"] },
    ])!;
    const { subject, text } = renderWeeklyEmail({
      storeName: "Matha",
      appUrl: "https://app.test/stores/1/reports",
      summary,
      titles: new Map([["price_missing:1", "Price missing"], ["feed_brand_missing:2", "Feed: brand missing"]]),
    });
    expect(subject).toBe("Matha: 1 fixed, 1 new, 0 back");
    expect(text).toContain("- Price missing");
    expect(text).toContain("- Feed: brand missing");
  });
});
