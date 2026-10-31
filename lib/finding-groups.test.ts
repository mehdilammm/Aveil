import { describe, expect, it } from "vitest";
import type { FindingRow } from "./data";
import { groupByType, groupSeverity, plainSentence } from "./finding-groups";

const f = (key: string, type: string, severity: FindingRow["severity"] = "medium"): FindingRow => ({ finding_key: key, type, title: `T ${type}`, severity, evidence: "", guidance: "", product_id: null, basis: "observed", state: null, fix_url: null });

describe("finding groups", () => {
  it("groups identical findings and keeps the fixing order", () => {
    const g = groupByType([f("a:1", "a", "high"), f("b:1", "b"), f("a:2", "a", "low"), f("a:3", "a")]);
    expect(g.map((x) => [x.type, x.items.length])).toEqual([["a", 3], ["b", 1]]);
    expect(groupSeverity(g[0])).toBe("high");
    expect(groupSeverity({ type: "c", items: [f("c:1", "c", "low"), f("c:2", "c")] })).toBe("medium");
  });

  it("uses the plain catalog, or the scan title when the type has no plain sentence", () => {
    const t = Object.assign((k: string, v?: Record<string, string | number>) => `${k}:${v?.n}`, { has: (k: string) => k === "a" });
    const [a, b] = groupByType([f("a:1", "a"), f("a:2", "a"), f("b:1", "b"), f("b:2", "b")]);
    expect(plainSentence(t, a)).toBe("a:2");
    expect(plainSentence(t, b)).toBe("T b (2)");
  });
});
