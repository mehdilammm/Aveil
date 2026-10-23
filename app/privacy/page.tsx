import type { Metadata } from "next";
import Link from "next/link";
import { PublicHeader } from "@/components/public-header";
import { SiteFooter } from "@/components/site-footer";
import { SITE } from "@/lib/site";

export const metadata: Metadata = { title: "Privacy Policy", description: "What data the service collects, which providers process it, how long it is kept and your rights.", alternates: { canonical: "/privacy" } };

export default function PrivacyPage() {
  return (
    <>
      <PublicHeader />
      <main className="public-main legal">
        <h1>Privacy Policy</h1>
        <p className="muted">Last updated: {SITE.legalLastUpdated}</p>

        <h2>What we collect</h2>
        <ul>
          <li><strong>Account:</strong> your email address and a password hash (handled by Supabase Auth).</li>
          <li><strong>Store keys:</strong> WooCommerce API keys with Read permission, stored encrypted in Supabase Vault and never shown again.</li>
          <li><strong>Scan results:</strong> findings about your products and pages, AI visibility questions and answers, and their history.</li>
          <li>
            <strong>AI traffic totals:</strong> daily counts sent by the plugin (day, AI source, type, page type, HTTP status, count). No IP address, no user
            agent, no page URL, no cookie.
          </li>
          <li>
            <strong>Free public check:</strong> the domain checked and the report. For rate limits we keep a hash of your IP address that changes every
            day; we do not store the IP itself.
          </li>
          <li>
            <strong>AI-referred orders (Pro and Agency):</strong> with your WooCommerce API key we read the orders of the last 90 days, asking only for the
            order id, date, total, currency, status, how the order was created and its attribution fields. We keep, for orders that came from an AI
            assistant: order id, date, total, currency, the AI source, how it was matched and the landing page path. No customer name, email, phone,
            address or IP address is requested or stored.
          </li>
          <li>
            <strong>AI bot identity (plugin 1.5 or later, with traffic capture on):</strong> only for requests whose user agent is a known AI bot
            (for example GPTBot, ClaudeBot, PerplexityBot, Googlebot), the plugin sends the time, IP address, full user agent, page path (no query
            string), method and status. Requests from people are never sent. We check the IP against the lists the bot operators publish (and
            Google&apos;s reverse DNS) to tell a real bot from one that only uses its name. These rows are deleted after 90 days by default.
          </li>
          <li>
            <strong>Plugin AI-referral note (opt-in):</strong> the WordPress plugin can save the AI source, how it was matched and the landing path on new
            orders, through the WooCommerce session; it respects the WP Consent API when a consent plugin is active.
          </li>
          <li><strong>Waitlist:</strong> the email and plan you enter, only to tell you when payments open.</li>
          <li><strong>Team members:</strong> workspace memberships and invites (only a hash of each invite link is stored).</li>
        </ul>

        <h2>What we do not collect</h2>
        <p>Customer, order or payment data from your store, and the personal data of your shoppers.</p>

        <h2>Services we use</h2>
        <ul>
          <li><strong>Supabase</strong> (database, authentication, encrypted secrets).</li>
          <li><strong>Vercel</strong> (hosting and running the app).</li>
          <li><strong>Google Gemini</strong> (AI visibility questions; product and category names from your store can be part of a question).</li>
          <li>
            <strong>Groq</strong> and <strong>NVIDIA</strong> (internal tasks: reading store names out of AI answers and writing question suggestions from
            your product names, categories and prices).
          </li>
        </ul>
        <p>These providers process data for us under their own terms. We do not sell your data or use it for advertising.</p>

        <h2>How long we keep it</h2>
        <ul>
          <li>Account, stores and scan history: until you delete them or your account.</li>
          <li>Free public check reports: 30 days.</li>
          <li>IP hashes for rate limits: replaced every day.</li>
          <li>Deleting a store removes its saved key, scans, findings, AI visibility results and traffic totals.</li>
        </ul>

        <h2>Your rights</h2>
        <p>
          You can see and export your data in the app (reports and CSV), correct it, or delete stores at any time. To delete your account or ask for a
          copy of your data, write to <a href={`mailto:${SITE.contactEmail}`}>{SITE.contactEmail}</a>. Depending on where you live (for example under the
          GDPR) you may also object to processing or complain to your data protection authority.
        </p>

        <h2>Security</h2>
        <p>Access to data is limited to your account and the members of your workspaces. Keys and connection tokens are encrypted and stay on the server.</p>

        <h2>Changes</h2>
        <p>We will update the date above when this policy changes, and tell signed-in users about important changes. See also the <Link href="/terms">Terms of Service</Link>.</p>
      </main>
      <SiteFooter />
    </>
  );
}
