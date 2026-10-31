import { describe, expect, it } from "vitest";
import { httpGroup, labelOf } from "./traffic-labels";

describe("traffic labels", () => {
  it("HTTP status in plain groups", () => {
    expect([200, 301, 404, 403, 429, 503, 0].map(httpGroup)).toEqual(["ok", "redirect", "notFound", "blocked", "limited", "error", "other"]);
  });
  it("raw value when the catalog has no word for it", () => {
    const t = Object.assign((k: string) => `L:${k}`, { has: (k: string) => k === "cat.crawler" });
    expect(labelOf(t, "cat", "crawler")).toBe("L:cat.crawler");
    expect(labelOf(t, "cat", "new-kind")).toBe("new-kind");
  });
});
