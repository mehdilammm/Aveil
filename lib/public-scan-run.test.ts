import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("./gemini", () => ({ askGemini: vi.fn(), geminiConfigured: () => false, GEMINI_MODEL: "test" }));

// Fake network: every path on badeloft.com redirects to www.badeloft.com (like the real store), which serves Shopify pages.
const fx = (name: string) => readFileSync(join(__dirname, "fixtures", name), "utf8");
const pages: Record<string, () => Response> = {
  "/robots.txt": () => new Response("User-agent: *\nDisallow: /cart\nSitemap: https://www.badeloft.com/sitemap.xml", { status: 200 }),
  "/": () => new Response(fx("shopify-home.html").replace(/badeloft\.com\//g, "www.badeloft.com/"), { status: 200, headers: { "x-shopify-stage": "production" } }),
  "/products.json": () => new Response(fx("shopify-products.json"), { status: 200 }),
  "/products/bw-01-l-freestanding-bathtub": () => new Response(fx("shopify-product.html"), { status: 200 }),
  "/products/bw-04-oval-bathtub": () => new Response(fx("shopify-product.html"), { status: 200 }),
  "/llms.txt": () => new Response("not found", { status: 404 }),
};
const calls: string[] = [];

vi.mock("undici", () => ({
  Agent: class {},
  fetch: async (url: URL) => {
    calls.push(url.toString());
    if (url.host === "badeloft.com") return new Response(null, { status: 301, headers: { location: `https://www.badeloft.com${url.pathname}${url.search}` } });
    const page = pages[url.pathname];
    return page ? page() : new Response("missing", { status: 404 });
  },
}));

describe("public check request budget (badeloft.com with a www redirect)", () => {
  beforeEach(() => {
    calls.length = 0;
  });

  it("learns the www host after the first redirect, tests every bot, and marks only the last step not checked", async () => {
    const { PublicFetcher } = await import("./public-fetch");
    const { runPublicScan } = await import("./public-scan-run");
    const { report, requests } = await runPublicScan({} as never, "https://badeloft.com", "badeloft.com", new PublicFetcher(0));

    expect(requests).toBe(10);
    // Only the very first request went to the bare domain.
    expect(calls.filter((c) => c.startsWith("https://badeloft.com"))).toEqual(["https://badeloft.com/robots.txt"]);
    expect(report.requestLog?.map((e) => e.step)).toEqual([
      "robots.txt",
      "home page",
      "Shopify product list (/products.json)",
      "product page 1",
      "home page as GPTBot",
      "home page as ClaudeBot",
      "home page as PerplexityBot",
      "home page as OAI-SearchBot",
      "llms.txt",
      "product page 2",
    ]);
    expect(report.requestLog?.at(-1)?.outcome).toBe("not checked: request limit");
    expect(report.requestLimit).toBe(10);

    // All four bots were tested and nothing was reported against them.
    expect(report.accessResults.map((a) => a.bot)).toEqual(["GPTBot", "ClaudeBot", "PerplexityBot", "OAI-SearchBot"]);
    expect(report.findings.filter((f) => f.finding_key.startsWith("access:"))).toEqual([]);
    expect(report.shopifyList).toMatchObject({ status: "ok", checked: 5 });
    expect(report.findings.find((f) => f.finding_key === "schema:unavailable:product2")).toMatchObject({ basis: "unavailable", severity: "low" });
    expect(report.findings.find((f) => f.finding_key === "schema:unavailable:product2")?.evidence).toContain("not checked: request limit");
  });
});
