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

describe("scheduled scans follow the plan", () => {
  it("Free is due after 30 days, Pro after 7", () => {
    const now = new Date("2026-10-24T03:00:00Z");
    const s = (daysAgo: number) => ({ storeId: "s", lastCompleteAt: new Date(now.getTime() - daysAgo * 86_400_000).toISOString(), lastScheduledAt: null, running: false });
    expect(dueForWeeklyScan(s(10), now, 30)).toBe(false);
    expect(dueForWeeklyScan(s(30), now, 30)).toBe(true);
    expect(dueForWeeklyScan(s(10), now, 7)).toBe(true);
  });
});
