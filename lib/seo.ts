// SEO helpers: robots rules, sitemap entries and the SoftwareApplication JSON-LD (no rating or reviews: nothing invented).
import { PLAN_ORDER, PLANS } from "./plans";
import { SITE } from "./site";

export const PUBLIC_PAGES = ["/", "/check", "/pricing", "/bot", "/terms", "/privacy"] as const;
// Signed-in app, API and one-time links: not for crawlers.
export const PRIVATE_PREFIXES = ["/stores", "/settings", "/api/", "/invite/", "/auth/", "/login"];
// AI crawlers and assistants are welcome on the public pages (named explicitly so their rules are clear).
export const AI_BOTS = ["GPTBot", "OAI-SearchBot", "ChatGPT-User", "ClaudeBot", "Claude-SearchBot", "Claude-User", "PerplexityBot", "Perplexity-User", "Google-Extended", "Applebot-Extended"];

export function robotsRules() {
  return [
    { userAgent: "*", allow: "/", disallow: PRIVATE_PREFIXES },
    { userAgent: AI_BOTS, allow: "/", disallow: PRIVATE_PREFIXES },
  ];
}

export function sitemapEntries(base = SITE.url, lastModified = SITE.legalLastUpdated) {
  return PUBLIC_PAGES.map((path) => ({
    url: `${base}${path === "/" ? "" : path}` || base,
    lastModified,
    changeFrequency: path === "/terms" || path === "/privacy" ? ("yearly" as const) : ("monthly" as const),
    priority: path === "/" ? 1 : path === "/check" || path === "/pricing" ? 0.8 : 0.4,
  }));
}

export const SEO_DESCRIPTION = "Others give you a score. AgentScope shows why AI agents don't buy from your WooCommerce store, fixes it with your approval, and proves it with real AI-referred orders.";

// Offers come from the plans config; no aggregateRating or review.
export function softwareApplicationJsonLd(base = SITE.url) {
  return {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    name: SITE.name,
    url: `${base}/`,
    description: SEO_DESCRIPTION,
    applicationCategory: "BusinessApplication",
    operatingSystem: "Web",
    offers: PLAN_ORDER.map((id) => ({
      "@type": "Offer",
      name: PLANS[id].name,
      price: PLANS[id].priceUsdPerMonth.toFixed(2),
      priceCurrency: "USD",
      url: `${base}/pricing`,
      ...(PLANS[id].cta === "waitlist" ? { availability: "https://schema.org/PreOrder" } : { availability: "https://schema.org/InStock" }),
    })),
  };
}
