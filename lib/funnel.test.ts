import { describe, expect, it } from "vitest";
import { buildFunnel, diagnose, stageOfFinding, type FunnelInput } from "./funnel";

const base: FunnelInput = {
  scanned: true,
  findings: [],
  visibility: { asked: 5, mentioned: 1 },
  plugin: { connected: true, botVisits: 12, aiReferrals: 2, days: 30 },
  orders: { kind: "ok", scanned: 0, aiOrders: 0, revenue: [], agentCheckouts: 0, days: 90 },
};
const f = (type: string, severity: "high" | "medium" | "low", basis: "observed" | "heuristic" = "observed", key = type) => ({ finding_key: key, type, title: type, severity, basis, evidence: "e", guidance: "g" });

describe("AI Revenue funnel", () => {
  it("six stages, real numbers; no AI orders is a result, not an error", () => {
    const s = buildFunnel(base);
    expect(s.map((x) => x.key)).toEqual(["access", "understand", "recommend", "visit", "referral", "buy"]);
    expect(s.find((x) => x.key === "recommend")!.value).toBe("Mentioned in 1 of 5 answers");
    expect(s.find((x) => x.key === "buy")).toMatchObject({ status: "problem", basis: "observed", value: "No AI-referred orders yet" });
    expect(s.find((x) => x.key === "buy")!.detail).toContain("not measurable yet");
  });

  it("missing data is Unavailable with the reason", () => {
    const s = buildFunnel({ ...base, scanned: false, visibility: null, plugin: { connected: false, botVisits: 0, aiReferrals: 0, days: 30 }, orders: { kind: "locked" } });
    expect(s.every((x) => x.status === "unknown" && x.basis === "unavailable")).toBe(true);
    expect(s.find((x) => x.key === "buy")!.value).toBe("Available on Pro and Agency");
    expect(buildFunnel({ ...base, orders: { kind: "unavailable", reason: "Turn it on" } }).find((x) => x.key === "buy")!.detail).toBe("Turn it on");
  });

  it("findings go to the right stage; checkout blocked for bots is an access problem", () => {
    expect(stageOfFinding({ type: "access_blocked", finding_key: "a" })).toBe("access");
    expect(stageOfFinding({ type: "checkout_blocked_bots", finding_key: "c" })).toBe("access");
    expect(stageOfFinding({ type: "checkout_rate_limited_bots", finding_key: "r" })).toBe("access");
    expect(stageOfFinding({ type: "checkout_guest_disabled", finding_key: "c" })).toBe("buy");
    expect(stageOfFinding({ type: "price_missing", finding_key: "p" })).toBe("understand");
  });

  it("diagnosis: first broken stage, blocking reasons first; low heuristics do not block", () => {
    const d = diagnose(buildFunnel({ ...base, findings: [f("schema_missing", "medium"), f("description_short", "low", "heuristic"), f("price_missing", "high")] }));
    expect(d.stage!.key).toBe("understand");
    expect(d.reasons.map((r) => r.finding_key)).toEqual(["price_missing", "schema_missing"]);
  });

  it("late in the funnel, checkout reasons are added", () => {
    const d = diagnose(buildFunnel({ ...base, plugin: { connected: true, botVisits: 0, aiReferrals: 0, days: 30 }, findings: [f("checkout_guest_disabled", "high")] }));
    expect(d.stage!.key).toBe("visit");
    expect(d.reasons.map((r) => r.finding_key)).toContain("checkout_guest_disabled");
  });
});
