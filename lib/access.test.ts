import { describe, expect, it } from "vitest";
import { accessPlan, AI_BOTS, checkAccess, requestCount, type PageResult } from "./access";
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
