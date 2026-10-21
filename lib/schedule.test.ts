import { describe, expect, it } from "vitest";
import { dueForWeeklyScan } from "./schedule";

const now = new Date("2026-10-21T05:30:00Z");
const base = { storeId: "s", lastCompleteAt: null, lastScheduledAt: null, running: false };

describe("dueForWeeklyScan", () => {
  it("scans stores never scanned, or last scanned 7+ days ago", () => {
    expect(dueForWeeklyScan(base, now)).toBe(true);
    expect(dueForWeeklyScan({ ...base, lastCompleteAt: "2026-10-14T05:30:00Z" }, now)).toBe(true);
    expect(dueForWeeklyScan({ ...base, lastCompleteAt: "2026-10-15T09:00:00Z" }, now)).toBe(false);
  });

  it("runs at most one scheduled scan per day and never on top of a running scan", () => {
    expect(dueForWeeklyScan({ ...base, lastScheduledAt: "2026-10-21T05:01:00Z" }, now)).toBe(false);
    expect(dueForWeeklyScan({ ...base, lastScheduledAt: "2026-10-20T05:01:00Z" }, now)).toBe(true);
    expect(dueForWeeklyScan({ ...base, running: true }, now)).toBe(false);
  });
});
