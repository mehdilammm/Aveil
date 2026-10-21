import { describe, expect, it } from "vitest";
import { accessPlan, AI_BOTS, checkAccess, requestCount, retryAfterMs, type PageResult } from "./access";
import type { PageFetch } from "./woo";

const page = (status: number, body = "<html>" + "x".repeat(20000) + "</html>", extra: Partial<Extract<PageFetch, { ok: true }>> = {}): PageFetch => ({
  ok: true, status, finalUrl: "https://shop.test/", redirectedTo: null, bytes: body.length, body, challengeHeader: false, ...extra,
});

const ok = page(200);
const allBots = (f: PageFetch) => Object.fromEntries(AI_BOTS.map((b) => [b.name, f]));

describe("accessPlan", () => {
  it("never uses more than 10 requests", () => {
    expect(requestCount(accessPlan("https://shop.test", ["https://shop.test/p/1", "https://shop.test/p/2", "https://shop.test/p/3"]))).toBe(10);
    expect(requestCount(accessPlan("https://shop.test", []))).toBe(6);
  });
});

describe("checkAccess", () => {
  it("passes when bots get the same page", () => {
    expect(checkAccess("https://shop.test", [{ label: "home page", url: "https://shop.test", browser: ok, bots: allBots(ok) }])).toEqual([]);
  });

  it("flags a 403 for a bot when the browser gets 200 as HIGH heuristic", () => {
    const pages: PageResult[] = [{ label: "home page", url: "https://shop.test", browser: ok, bots: { ...allBots(ok), GPTBot: page(403, "Forbidden") } }];
    const [f] = checkAccess("https://shop.test", pages);
    expect(f.finding_key).toBe("access:GPTBot");
    expect(f.severity).toBe("high");
    expect(f.basis).toBe("heuristic");
    expect(f.title).toContain("AI agents are blocked");
    expect(f.evidence).toContain("only changes the User-Agent");
  });

  it("detects challenge pages but ignores captcha text the browser also gets", () => {
    const challenge = page(200, "<title>Just a moment...</title>");
    const f = checkAccess("https://shop.test", [{ label: "home page", url: "https://shop.test", browser: ok, bots: { ClaudeBot: challenge } }]);
    expect(f.map((x) => `${x.finding_key}/${x.severity}`)).toEqual(["access:ClaudeBot/high"]);

    const withRecaptcha = page(200, "<html>contact form recaptcha captcha-delivery " + "x".repeat(20000));
    expect(checkAccess("https://shop.test", [{ label: "home page", url: "https://shop.test", browser: withRecaptcha, bots: { ClaudeBot: withRecaptcha } }])).toEqual([]);

    const header = page(403, "", { challengeHeader: true });
    expect(checkAccess("https://shop.test", [{ label: "home page", url: "https://shop.test", browser: ok, bots: { GPTBot: header } }])[0].severity).toBe("high");
  });

  it("treats a 429 that survives the retry as MEDIUM rate-limited, not blocked (matha.site case)", () => {
    const pages: PageResult[] = [{ label: "home page", url: "https://shop.test", browser: ok, bots: { ...allBots(ok), GPTBot: page(429, "Too Many Requests") } }];
    const [f] = checkAccess("https://shop.test", pages);
    expect(f.finding_key).toBe("access:GPTBot");
    expect(f.type).toBe("access_rate_limited");
    expect(f.severity).toBe("medium");
    expect(f.title).toBe("Rate-limited for this bot: GPTBot");
    expect(f.title).not.toContain("blocked");
  });

  it("keeps HIGH for 401 and 403 only; other errors are MEDIUM", () => {
    const sev = (status: number) => checkAccess("https://shop.test", [{ label: "home page", url: "https://shop.test", browser: ok, bots: { GPTBot: page(status, "x") } }])[0].severity;
    expect(sev(401)).toBe("high");
    expect(sev(403)).toBe("high");
    expect(sev(503)).toBe("medium");
    expect(sev(406)).toBe("medium");
  });

  it("does not test bots against a Coming soon page", () => {
    const comingSoon = page(200, "<html><head><meta name='woo-coming-soon-page' content='yes'><title>Coming soon</title></head></html>");
    const f = checkAccess("https://shop.test", [{ label: "product page 1", url: "https://shop.test/p/1", browser: comingSoon, bots: {} }]);
    expect(f.map((x) => `${x.finding_key}/${x.basis}`)).toEqual(["access:baseline:product page 1/unavailable"]);
    expect(f[0].evidence).toContain("Coming soon");
  });

  it("reports redirects, timeouts and much smaller pages as MEDIUM", () => {
    const f = checkAccess("https://shop.test", [
      { label: "home page", url: "https://shop.test", browser: ok, bots: { GPTBot: page(301, "", { redirectedTo: "https://elsewhere.test/" }), ClaudeBot: { ok: false, error: "no response within 12 seconds" }, PerplexityBot: page(200, "<html>tiny</html>") } },
    ]);
    expect(f.map((x) => `${x.finding_key}/${x.type}/${x.severity}`)).toEqual([
      "access:GPTBot/access_degraded/medium",
      "access:ClaudeBot/access_degraded/medium",
      "access:PerplexityBot/access_degraded/medium",
    ]);
  });

  it("reports unavailable instead of guessing when the browser request fails", () => {
    const f = checkAccess("https://shop.test", [{ label: "home page", url: "https://shop.test", browser: page(500, "error"), bots: allBots(page(403, "no")) }]);
    expect(f.map((x) => `${x.finding_key}/${x.basis}`)).toEqual(["access:baseline:home page/unavailable"]);
  });
});

describe("retryAfterMs", () => {
  it("reads seconds or a date and keeps the wait between 1 and 10 seconds", () => {
    expect(retryAfterMs(null)).toBe(3000);
    expect(retryAfterMs("2")).toBe(2000);
    expect(retryAfterMs("0")).toBe(1000);
    expect(retryAfterMs("120")).toBe(10000);
    const now = Date.parse("2026-10-21T10:00:00Z");
    expect(retryAfterMs("Wed, 21 Oct 2026 10:00:05 GMT", now)).toBe(5000);
    expect(retryAfterMs("soon")).toBe(3000);
  });
});
