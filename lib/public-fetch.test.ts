import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

describe("PublicFetcher SSRF guards (no network needed)", () => {
  it("refuses http, IP literals in private ranges and internal names before any request", async () => {
    const { PublicFetcher } = await import("./public-fetch");
    const f = new PublicFetcher();
    for (const url of ["http://example.com/", "https://127.0.0.1/", "https://169.254.169.254/latest/meta-data/", "https://[::1]/", "https://metadata.google.internal/", "https://user:pw@example.com/"]) {
      const r = await f.get(url, "test", "test");
      expect(r.ok).toBe(false);
    }
    expect(f.requests).toBe(0);
  });

  it("stops after the request budget", async () => {
    const { PublicFetcher } = await import("./public-fetch");
    const f = new PublicFetcher();
    f.requests = 10;
    const r = await f.get("https://example.com/", "test", "home page as ClaudeBot");
    expect(r).toEqual({ ok: false, error: "not checked: request limit", skipped: true });
    expect(f.log).toEqual([{ step: "home page as ClaudeBot", outcome: "not checked: request limit" }]);
  });
});
