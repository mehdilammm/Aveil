import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { PublicHeader } from "@/components/public-header";
import { SiteFooter } from "@/components/site-footer";
import { SITE } from "@/lib/site";
import { getUser } from "@/lib/supabase/server";

export const metadata: Metadata = {
  title: `${SITE.name}: AI shopping agent readiness for WooCommerce`,
  description: "Product-level readiness checks, AI visibility tracking and verified fixes for WooCommerce stores.",
};

const SECTIONS = [
  {
    title: "Store readiness",
    text: "Every product, checked: price, weight, images, stock, brand and GTIN. The ChatGPT product feed fields, your policy pages and the structured data AI agents read.",
  },
  {
    title: "AI agent access",
    text: "Whether AI bots are blocked by Cloudflare, rate limits or a Coming soon page, what your robots.txt allows, and whether llms.txt is there.",
  },
  {
    title: "AI visibility",
    text: "Questions written from your real products. Whether your store is named in the answer, which stores are named instead, how the answers describe you, and your share of voice week by week.",
  },
  {
    title: "Real AI bot traffic",
    text: "A WordPress plugin counts real visits from AI bots and assistants, and keeps checker tools and our own tests out of the numbers (burst detection).",
  },
];

const FAQ = [
  { q: "Do you change my store?", a: "No. AgentScope is read-only: it reads products and pages and never edits them. You make the fixes in WooCommerce, then rescan to confirm." },
  { q: "Does it work with Shopify?", a: "The free public check works with Shopify stores. The full scan is for WooCommerce today; Shopify is coming." },
  { q: "What do you need from me?", a: "A WooCommerce API key with Read permission only. It is stored encrypted and never shown again." },
];

export default async function Home() {
  const { user } = await getUser();
  if (user) redirect("/stores");

  return (
    <>
      <PublicHeader />
      <main className="public-main landing">
        <section className="hero">
          <h1>{SITE.tagline}</h1>
          <p className="sub lead">Product-level readiness checks, AI visibility tracking and verified fixes for WooCommerce stores.</p>
          <div className="row">
            <Link href="/check" className="button">Run a free check</Link>
            <Link href="/login?mode=signup" className="button secondary">Sign up</Link>
          </div>
        </section>

        <section aria-labelledby="what">
          <h2 id="what">What it checks</h2>
          <div className="features">
            {SECTIONS.map((s) => (
              <div key={s.title} className="card">
                <h3>{s.title}</h3>
                <p className="muted">{s.text}</p>
              </div>
            ))}
          </div>
        </section>

        <section aria-labelledby="loop">
          <h2 id="loop">Fix → Rescan → Resolved</h2>
          <div className="card">
            <div className="loop">
              <div><span className="loop-n">43</span><span className="muted small">issues found</span></div>
              <span aria-hidden="true" className="loop-arrow">→</span>
              <div><span className="loop-n">19</span><span className="muted small">after fixes</span></div>
            </div>
            <p>Including 13 critical issues fixed in one change. Each finding says what was seen and how to fix it; the next scan marks it resolved only when the check passes.</p>
            <p className="muted small">Case study: our own test store, not a customer. Your numbers will differ.</p>
          </div>
        </section>

        <section aria-labelledby="honest">
          <h2 id="honest">Honest data</h2>
          <div className="card">
            <p>Every number has a label, so you know how much to trust it:</p>
            <p className="label-row">
              <span className="badge basis-observed">Observed</span> <span>seen in your store or in a real AI answer</span>
            </p>
            <p className="label-row">
              <span className="badge basis-heuristic">Heuristic</span> <span>a rule of thumb, shown as one</span>
            </p>
            <p className="label-row">
              <span className="badge basis-unavailable">Unavailable</span> <span>we could not check it, and say why</span>
            </p>
            <p className="muted">No invented scores. AI answers are shown as what the model said, not as facts.</p>
          </div>
        </section>

        <section aria-labelledby="faq">
          <h2 id="faq">Questions</h2>
          {FAQ.map((f) => (
            <details key={f.q} className="card faq">
              <summary><strong>{f.q}</strong></summary>
              <p>{f.a}</p>
            </details>
          ))}
        </section>

        <div className="cta">
          <p><strong>See what AI agents see on your store.</strong> Free, no account needed.</p>
          <div className="row">
            <Link href="/check" className="button">Run a free check</Link>
            <Link href="/pricing" className="button secondary on-dark">See pricing</Link>
          </div>
        </div>
      </main>
      <SiteFooter />
    </>
  );
}
