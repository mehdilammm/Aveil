import { describe, expect, it } from "vitest";
import { checkManual, fileHasToken, isCurrent, metaHasToken, newVerificationToken, txtHasToken, type OwnershipDeps } from "./ownership";

const token = "0123456789abcdef0123456789abcdef";
const deps = (over: Partial<OwnershipDeps>): OwnershipDeps => ({
  resolveTxt: async () => [],
  fetchPage: async () => ({ ok: true, status: 200, body: "", redirectedTo: null }),
  ...over,
});

describe("ownership verification", () => {
  it("tokens are 32 hex characters and unique", () => {
    const a = newVerificationToken();
    expect(a).toMatch(/^[0-9a-f]{32}$/);
    expect(newVerificationToken()).not.toBe(a);
  });

  it("DNS TXT: exact record only (chunks joined)", async () => {
    expect(txtHasToken([["agentscope-verification=", token]], token)).toBe(true);
    expect(txtHasToken([["agentscope-verification=other"], ["v=spf1 -all"]], token)).toBe(false);
    expect(await checkManual("https://matha.site", "dns_txt", token, deps({ resolveTxt: async () => [[`agentscope-verification=${token}`]] }))).toMatchObject({ verified: true });
    const fail = await checkManual("https://matha.site", "dns_txt", token, deps({ resolveTxt: async () => Promise.reject(Object.assign(new Error("x"), { code: "ENOTFOUND" })) }));
    expect(fail).toEqual({ verified: false, evidence: "DNS lookup for matha.site failed (ENOTFOUND)." });
  });

  it("meta tag: in the head, either attribute order; not in the body", () => {
    expect(metaHasToken(`<head><meta name="agentscope-verification" content="${token}"></head>`, token)).toBe(true);
    expect(metaHasToken(`<head><meta content='${token}' name='AgentScope-Verification' /></head>`, token)).toBe(true);
    expect(metaHasToken(`<head></head><body><meta name="agentscope-verification" content="${token}"></body>`, token)).toBe(false);
    expect(metaHasToken(`<head><meta name="agentscope-verification" content="${token}x"></head>`, token)).toBe(false);
  });

  it("file: the token on its own line", () => {
    expect(fileHasToken(`${token}\n`, token)).toBe(true);
    expect(fileHasToken(`agentscope-verification=${token}`, token)).toBe(true);
    expect(fileHasToken(`<html>${token}</html>`, token)).toBe(false);
  });

  it("a redirect to another host or an error page does not verify", async () => {
    const r1 = await checkManual("https://matha.site", "well_known_file", token, deps({ fetchPage: async () => ({ ok: true, status: 301, body: "", redirectedTo: "https://evil.test/x" }) }));
    expect(r1.verified).toBe(false);
    const r2 = await checkManual("https://matha.site", "well_known_file", token, deps({ fetchPage: async () => ({ ok: true, status: 404, body: token, redirectedTo: null }) }));
    expect(r2).toEqual({ verified: false, evidence: "https://matha.site/.well-known/agentscope-verification.txt answered HTTP 404." });
  });

  it("expiry", () => {
    expect(isCurrent({ verified_at: "2026-10-01T00:00:00Z", expires_at: "2026-12-30T00:00:00Z" }, Date.parse("2026-10-22T00:00:00Z"))).toBe(true);
    expect(isCurrent({ verified_at: "2026-01-01T00:00:00Z", expires_at: "2026-04-01T00:00:00Z" }, Date.parse("2026-10-22T00:00:00Z"))).toBe(false);
    expect(isCurrent(null)).toBe(false);
  });
});
