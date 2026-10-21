import { describe, expect, it } from "vitest";
import { hashToken, sign, validateRows, verifySignature } from "./traffic";

const now = new Date("2026-10-21T10:00:00Z");
const row = (over: Record<string, unknown> = {}) => ({
  day: "2026-10-20", source: "ChatGPT-User", category: "ai-assistant", confidence: "claimed", route: "product", http_status: 200, hits: 12, last_seen: "2026-10-20 18:22:01", ...over,
});

describe("signature", () => {
  const token = "agsc_secret";
  const ts = String(Math.floor(now.getTime() / 1000));
  const body = JSON.stringify({ rows: [row()] });

  it("accepts a valid signature and rejects tampering, other tokens and old timestamps", () => {
    const sig = sign(token, ts, body);
    expect(sig).toMatch(/^sha256=[0-9a-f]{64}$/);
    expect(verifySignature(token, ts, body, sig, Number(ts))).toBe(true);
    expect(verifySignature(token, ts, body + " ", sig, Number(ts))).toBe(false);
    expect(verifySignature("other", ts, body, sig, Number(ts))).toBe(false);
    expect(verifySignature(token, ts, body, sig, Number(ts) + 301)).toBe(false);
    expect(verifySignature(token, ts, body, null, Number(ts))).toBe(false);
    expect(verifySignature(token, "abc", body, sig, Number(ts))).toBe(false);
  });

  it("hashes tokens to hex", () => {
    expect(hashToken("x")).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("validateRows", () => {
  it("accepts plugin rows and converts last_seen to UTC ISO", () => {
    const r = validateRows({ rows: [row()] }, now);
    expect(r).toEqual({ rows: [{ ...row(), last_seen: "2026-10-20T18:22:01.000Z" }] });
  });

  it("rejects bad input", () => {
    const bad: Record<string, unknown>[] = [
      { day: "2026-13-01" },
      { day: "2026-10-25" },
      { day: "2024-01-01" },
      { source: "" },
      { source: "x".repeat(41) },
      { route: "<script>" },
      { http_status: 999 },
      { hits: -1 },
      { hits: 1.5 },
      { last_seen: "yesterday" },
    ];
    for (const over of bad) expect(validateRows({ rows: [row(over)] }, now)).toHaveProperty("error");
    expect(validateRows({ rows: [row(), row()] }, now)).toHaveProperty("error");
    expect(validateRows({ data: [] }, now)).toHaveProperty("error");
    expect(validateRows({ rows: Array.from({ length: 1001 }, (_, i) => row({ hits: i })) }, now)).toHaveProperty("error");
  });
});
