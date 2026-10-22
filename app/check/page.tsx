import type { Metadata } from "next";
import Link from "next/link";
import { PublicHeader } from "@/components/public-header";
import { SITE } from "@/lib/site";
import { SiteFooter } from "@/components/site-footer";
import { CheckForm } from "./check-form";

export const metadata: Metadata = {
  title: { absolute: `Free AI agent readiness check for WooCommerce and Shopify stores – ${SITE.name}` },
  alternates: { canonical: "/check" },
  description: "See whether AI assistants and shopping agents can read your store: robots.txt, bot access, product structured data and prices.",
};

export default function CheckPage() {
  return (
    <>
      <PublicHeader />
      <main className="public-main">
        <div className="hero page-head">
          <h1>Can AI shopping agents read your store?</h1>
          <p className="sub">A free check of what ChatGPT, Claude, Perplexity and Gemini can see on your public pages. For WooCommerce and Shopify stores.</p>
        </div>
        <CheckForm />
        <h2>What we check</h2>
        <div className="card">
          <ul>
            <li><strong>robots.txt:</strong> allowed, blocked or not mentioned for GPTBot, OAI-SearchBot, ChatGPT-User, ClaudeBot, PerplexityBot and Google-Extended, and whether a sitemap is listed.</li>
            <li><strong>Bot access:</strong> your home page loaded as four AI bots and compared with a normal request (user agent only).</li>
            <li><strong>Product data:</strong> JSON-LD Product on two product pages, and whether its price matches the price shown.</li>
            <li><strong>Shopify product list:</strong> on Shopify stores, the first 10 products of the public /products.json (prices, discounts, images, descriptions, vendor, weight).</li>
            <li><strong>Store status:</strong> WooCommerce or Shopify, Coming soon or maintenance mode, bot protection.</li>
            <li><strong>Gemini:</strong> one question about your domain to the Gemini API.</li>
            <li><strong>llms.txt:</strong> present or not (information only).</li>
          </ul>
          <p className="muted small">Each finding says how to fix it in WooCommerce. No score: only what we saw. <Link href="/bot">How our bot behaves</Link>.</p>
        </div>
      </main>
      <SiteFooter />
    </>
  );
}
