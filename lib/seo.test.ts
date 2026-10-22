import { describe, expect, it } from "vitest";
import { AI_BOTS, PRIVATE_PREFIXES, robotsRules, sitemapEntries, softwareApplicationJsonLd } from "./seo";

describe("SEO", () => {
  it("robots: public pages open to everyone, AI bots named and allowed, the app kept out", () => {
    const rules = robotsRules();
    expect(rules[0]).toMatchObject({ userAgent: "*", allow: "/" });
    expect(rules[1].allow).toBe("/");
    for (const bot of ["GPTBot", "OAI-SearchBot", "ChatGPT-User", "ClaudeBot", "PerplexityBot", "Google-Extended"]) expect(AI_BOTS).toContain(bot);
    expect(PRIVATE_PREFIXES).toEqual(expect.arrayContaining(["/stores", "/settings", "/api/"]));
    expect(PRIVATE_PREFIXES).not.toContain("/check");
  });

  it("sitemap lists the public pages only", () => {
    const urls = sitemapEntries("https://x.test", "2026-10-22").map((e) => e.url);
    expect(urls).toEqual(["https://x.test", "https://x.test/check", "https://x.test/pricing", "https://x.test/bot", "https://x.test/terms", "https://x.test/privacy"]);
  });

  it("SoftwareApplication JSON-LD: real prices from the plans, no rating or reviews", () => {
    const ld = softwareApplicationJsonLd("https://x.test");
    expect(ld["@type"]).toBe("SoftwareApplication");
    expect(ld.offers.map((o) => [o.name, o.price, o.priceCurrency])).toEqual([["Free", "0.00", "USD"], ["Pro", "29.00", "USD"], ["Agency", "49.00", "USD"]]);
    const text = JSON.stringify(ld);
    expect(text).not.toMatch(/aggregateRating|review|ratingValue/i);
  });
});
