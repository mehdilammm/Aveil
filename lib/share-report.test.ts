import { describe, expect, it } from "vitest";
import { buildSnapshot, hashShareToken, isShareToken, newShareToken, shareState } from "./share-report";

const findings = [
  { title: "Product has no GTIN", type: "missing_gtin", finding_key: "p:1:gtin", severity: "medium" as const, basis: "observed" as const, product_id: 1, evidence: { secret: "ck_live_x", url: "https://s.test/?key=1" }, guidance: "Set it in Settings" },
  { title: "Guest checkout disabled", type: "checkout_guest", finding_key: "checkout:guest", severity: "high" as const, basis: "observed" as const, product_id: null, evidence: { option: "no" }, guidance: "" },
  { title: "GPTBot answer", type: "access_gptbot", finding_key: "access:gptbot", severity: "low" as const, basis: "unavailable" as const, product_id: null, evidence: { reason: "HTTP 403" }, guidance: "" },
];

describe("share report", () => {
  it("token format, hash and check", () => {
    const { token, hash } = newShareToken();
    expect(isShareToken(token)).toBe(true);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hashShareToken(token)).toBe(hash);
    expect(isShareToken("agsr_short")).toBe(false);
    expect(isShareToken(`${token}/../x`)).toBe(false);
    expect(newShareToken().token).not.toBe(token);
  });

  it("snapshot keeps only safe fields", () => {
    const s = buildSnapshot({ name: "Matha", url: "https://matha.site/shop" }, { finished_at: "2026-10-24T10:00:00Z", scanned_products: 12 }, findings);
    const text = JSON.stringify(s);
    expect(text).not.toContain("ck_live_x");
    expect(text).not.toContain("key=1");
    expect(text).not.toContain("Settings");
    expect(text).not.toContain("guidance");
    expect(text).not.toContain("evidence");
    expect(s.store).toEqual({ name: "Matha", host: "matha.site" });
    expect(s.counts).toEqual({ high: 1, medium: 1, low: 0, unavailable: 1 });
    expect(s.findings[0]).toEqual({ title: "Guest checkout disabled", severity: "high", basis: "observed", area: "checkout" });
    expect(Object.keys(s.findings[1]).sort()).toEqual(["area", "basis", "severity", "title"]);
  });

  it("link state: missing, revoked, expired, ok", () => {
    const now = Date.parse("2026-10-24T00:00:00Z");
    expect(shareState(null, now)).toBe("missing");
    expect(shareState({ expires_at: "2026-11-01T00:00:00Z", revoked_at: "2026-10-23T00:00:00Z" }, now)).toBe("revoked");
    expect(shareState({ expires_at: "2026-10-23T00:00:00Z", revoked_at: null }, now)).toBe("expired");
    expect(shareState({ expires_at: "2026-11-01T00:00:00Z", revoked_at: null }, now)).toBe("ok");
  });
});
