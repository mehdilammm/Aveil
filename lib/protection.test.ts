import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { detectProtection } from "./protection";
import { buildPublicReport, topicFromHome, trustedHomeHtml, type PublicScanInput } from "./public-scan";
import { analyzeAnswer, brandTerms, combineAnalysis } from "./visibility";
import type { PageFetch } from "./woo";

// Cloudflare "Attention Required" block page as served to our check of atlanticpatio.com (HTTP 403, ~5-6 KB).
// Rebuilt from Cloudflare's standard block page; the real one was not stored.
const cloudflare = readFileSync(join(__dirname, "fixtures/cloudflare-attention-required.html"), "utf8");

const page = (status: number, body: string, extra: Partial<Extract<PageFetch, { ok: true }>> = {}): PageFetch => ({
  ok: true, status, finalUrl: "https://atlanticpatio.com/", redirectedTo: null, bytes: Buffer.byteLength(body), body, challengeHeader: false, ...extra,
});

describe("detectProtection", () => {
  it("recognizes the Cloudflare block page", () => {
    const p = detectProtection(page(403, cloudflare, { vendorHint: "Cloudflare" }));
    expect(p).toMatchObject({ vendor: "Cloudflare", status: 403, title: "Attention Required! | Cloudflare" });
    expect(p?.reason).toContain("HTTP 403");
  });

  it("recognizes other vendors and small block pages", () => {
    expect(detectProtection(page(503, "<html><title>Just a moment...</title><script src='/cdn-cgi/challenge-platform/x'></script></html>"))?.vendor).toBe("Cloudflare");
    expect(detectProtection(page(403, "<html><title>Access Denied</title>Reference #18.abc</html>"))?.vendor).toBe("Akamai");
    expect(detectProtection(page(403, "<html><title>Sucuri WebSite Firewall - Access Denied</title></html>"))?.vendor).toBe("Sucuri");
    expect(detectProtection(page(403, "<html><iframe src='/_Incapsula_Resource?x'></iframe></html>"))?.vendor).toBe("Imperva");
    expect(detectProtection(page(403, "<html><script src='https://ct.captcha-delivery.com/c.js'></script></html>"))?.vendor).toBe("DataDome");
    expect(detectProtection(page(403, "<html><title>Forbidden</title></html>"))?.vendor).toBe("unknown service");
    expect(detectProtection(page(403, "<html><title>Forbidden</title></html>", { vendorHint: "Cloudflare" }))?.vendor).toBe("Cloudflare");
  });

  it("ignores normal pages, big error pages and failed requests", () => {
    expect(detectProtection(page(200, "<html><title>Patio furniture</title>" + "x".repeat(30000)))).toBeNull();
    expect(detectProtection(page(404, "<html><title>Not found</title>" + "x".repeat(30000)))).toBeNull();
    expect(detectProtection({ ok: false, error: "timeout" })).toBeNull();
  });
});

describe("public check of a store behind Cloudflare (atlanticpatio.com)", () => {
  const input: PublicScanInput = {
    url: "https://atlanticpatio.com/",
    host: "atlanticpatio.com",
    checkedAt: "2026-10-21T12:00:00Z",
    requests: 3,
    robots: page(403, cloudflare),
    llms: page(403, cloudflare),
    home: page(403, cloudflare, { vendorHint: "Cloudflare" }),
    bots: {},
    products: [],
    productSource: "none",
    gemini: {
      visibility: { status: "unavailable", reason: "The home page could not be read (bot protection, error or placeholder page), so there is no reliable topic and no general question was asked.", prompt: "" },
      knowledge: { status: "ok", model: "m", prompt: "What do you know about the online store atlanticpatio.com?", answer: "…", mentioned: true, competitors: ["Frontgate", "Polywood"], method: "model" },
    },
  };

  it("gives one clear MEDIUM heuristic note and marks the rest unavailable", () => {
    const r = buildPublicReport(input);
    const keys = r.findings.map((f) => `${f.finding_key}/${f.severity}/${f.basis}`);
    expect(keys).toContain("protection:blocked/medium/heuristic");
    expect(keys).toContain("protection:unavailable/low/unavailable");
    const blocked = r.findings.find((f) => f.finding_key === "protection:blocked")!;
    expect(blocked.title).toBe("Bot protection blocked our automated check (Cloudflare)");
    expect(blocked.evidence).toContain('HTTP 403, title "Attention Required! | Cloudflare"');
    expect(blocked.guidance).toContain("Cloudflare Bot Fight Mode, Verified Bots");
    expect(r.findings.find((f) => f.finding_key === "protection:unavailable")?.evidence).toBe("The home page was a bot protection page (Cloudflare), not the store.");
    // Nothing judged from the protection page itself.
    for (const k of ["platform:not_woocommerce", "schema:no_product_pages", "robots:no_sitemap", "access:baseline:home page", "llms_txt:missing", "page:store_gate"]) {
      expect(r.findings.map((f) => f.finding_key)).not.toContain(k);
    }
    expect(r.platform).toBeNull();
    expect(r.robots.status).toBe("unavailable");
    expect(r.robots.detail).toContain("Cloudflare");
  });

  it("never builds a topic from a protection or error page", () => {
    expect(trustedHomeHtml(input.home)).toBeNull();
    expect(topicFromHome(cloudflare, ["atlanticpatio"])).toBeNull();
    expect(topicFromHome("<title>403 Forbidden</title>", [])).toBeNull();
    expect(topicFromHome("<title>Just a moment...</title>", [])).toBeNull();
  });

  it("shows no competitors when the model extraction failed, instead of text from the page", () => {
    const answer = "Your request was blocked.\n\n* **Refreshing the page:** wait\n* **Disabling VPNs:** try\n* **Switching networks:** try";
    const terms = brandTerms("atlanticpatio", "https://atlanticpatio.com");
    expect(combineAnalysis(answer, terms, null)).toMatchObject({ competitors: [], method: "failed" });
    // The old text fallback would have listed these, which is why it is no longer used for display.
    expect(analyzeAnswer(answer, terms).competitors).toEqual(["Refreshing the page", "Disabling VPNs", "Switching networks"]);
  });
});

describe("normal stores behind Cloudflare are not 'blocked' (offermanwoodshop.com case)", () => {
  // A normal 200 page with Cloudflare's /cdn-cgi/challenge-platform beacon script; written for this test.
  const normal = readFileSync(join(__dirname, "fixtures/cloudflare-normal-store.html"), "utf8");
  const ok = page(200, normal, { vendorHint: "Cloudflare" });

  it("a large 200 page with a normal title, cf-ray and the challenge-platform script is not protection", () => {
    expect(normal).toContain("/cdn-cgi/challenge-platform/scripts/jsd/main.js");
    expect(ok.ok && ok.bytes).toBeGreaterThan(100 * 1024);
    expect(detectProtection(ok)).toBeNull();
  });

  it("the public report checks the store normally and only notes 'served via Cloudflare'", () => {
    const r = buildPublicReport({
      url: "https://offermanwoodshop.com/",
      host: "offermanwoodshop.com",
      checkedAt: "2026-10-21T21:00:00Z",
      requests: 6,
      robots: page(200, "User-agent: *\nDisallow: /cart\nSitemap: https://offermanwoodshop.com/sitemap.xml", { vendorHint: "Cloudflare" }),
      llms: page(404, "<html><title>404 Not Found</title></html>", { vendorHint: "Cloudflare" }),
      home: ok,
      bots: { GPTBot: ok, ClaudeBot: ok, PerplexityBot: ok, "OAI-SearchBot": ok },
      products: [],
      productSource: "none",
      gemini: { visibility: { status: "unavailable", reason: "x", prompt: "q" }, knowledge: { status: "unavailable", reason: "x", prompt: "k" } },
    });
    expect(r.protection).toBeNull();
    expect(r.servedVia).toBe("Cloudflare");
    expect(r.platformName).toBe("Shopify");
    expect(r.accessTested).toBe(true);
    expect(r.findings.map((f) => f.finding_key).filter((k) => k.startsWith("protection:") || k.startsWith("access:"))).toEqual([]);
    expect(trustedHomeHtml(ok)).not.toBeNull();
    expect(topicFromHome(normal, ["offermanwoodshop"])).toBe("cutting boards, furniture");
  });

  it("real challenge and block pages are still caught", () => {
    // atlanticpatio.com: 403 Cloudflare block page.
    expect(detectProtection(page(403, cloudflare))?.vendor).toBe("Cloudflare");
    // Cloudflare JS challenge served with 200 or 503.
    const jsChallenge = `<!DOCTYPE html><html><head><title>Just a moment...</title></head><body><div id="challenge-error-text">Enable JavaScript and cookies to continue</div><script>window._cf_chl_opt={cvId:'3'}</script></body></html>`;
    expect(detectProtection(page(200, jsChallenge))?.vendor).toBe("Cloudflare");
    expect(detectProtection(page(503, jsChallenge))?.vendor).toBe("Cloudflare");
    // Challenge header alone.
    expect(detectProtection(page(200, "<html><body>x</body></html>", { challengeHeader: true }))?.vendor).toBe("Cloudflare");
    // A big 403 is still a block for us.
    expect(detectProtection(page(403, normal))).not.toBeNull();
    // A 503 maintenance page is the store's own placeholder, not protection.
    expect(detectProtection(page(503, "<html><title>Maintenance</title>Briefly unavailable for scheduled maintenance. Check back in a minute.</html>"))).toBeNull();
  });
});
