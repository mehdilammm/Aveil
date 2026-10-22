import { describe, expect, it } from "vitest";
import { capStatus, costMicros, DAILY_REQUEST_LIMITS, fitsCap } from "./usage";

describe("daily AI caps per workspace", () => {
  it("ok under 80 %, warn from 80 %, reached at the limit", () => {
    const limit = DAILY_REQUEST_LIMITS.free.gemini;
    const at = (n: number) => capStatus("free", { gemini: n }).find((c) => c.provider === "gemini")!.level;
    expect(at(0)).toBe("ok");
    expect(at(Math.ceil(limit * 0.8))).toBe("warn");
    expect(at(limit)).toBe("reached");
  });

  it("paid plans have higher caps; a provider with cap 0 is not listed", () => {
    expect(DAILY_REQUEST_LIMITS.pro.gemini).toBeGreaterThan(DAILY_REQUEST_LIMITS.free.gemini);
    expect(capStatus("free", {}).map((c) => c.provider)).not.toContain("mistral");
  });

  it("fitsCap counts the requests about to be made", () => {
    const limit = DAILY_REQUEST_LIMITS.free.groq;
    expect(fitsCap("free", "groq", limit - 2, 2)).toBe(true);
    expect(fitsCap("free", "groq", limit - 1, 2)).toBe(false);
  });

  it("free tiers cost nothing", () => {
    expect(costMicros("gemini", { requests: 10, input: 50_000, output: 20_000 })).toBe(0);
  });
});
