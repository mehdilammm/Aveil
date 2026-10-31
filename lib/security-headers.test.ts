import { describe, expect, it } from "vitest";
import { contentSecurityPolicy, SESSION_COOKIE, STATIC_SECURITY_HEADERS } from "./security-headers";

describe("security headers", () => {
  it("CSP: scripts only with the nonce, no framing, no plugins, forms to ourselves", () => {
    const csp = contentSecurityPolicy("abc123", false);
    const script = csp.split("; ").find((d) => d.startsWith("script-src"))!;
    expect(script).toBe("script-src 'self' 'nonce-abc123' 'strict-dynamic'");
    expect(script).not.toContain("unsafe-inline");
    for (const d of ["frame-ancestors 'none'", "object-src 'none'", "base-uri 'self'", "form-action 'self'", "default-src 'self'"]) expect(csp).toContain(d);
    expect(contentSecurityPolicy("n", true)).toContain("'unsafe-eval'"); // only for next dev
  });
  it("static headers and the session cookie", () => {
    expect(Object.fromEntries(STATIC_SECURITY_HEADERS.map((h) => [h.key, h.value]))).toMatchObject({ "X-Content-Type-Options": "nosniff", "X-Frame-Options": "DENY" });
    expect(SESSION_COOKIE).toMatchObject({ secure: true, httpOnly: true, sameSite: "lax", maxAge: 604800 });
  });
});
