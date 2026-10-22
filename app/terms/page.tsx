import type { Metadata } from "next";
import Link from "next/link";
import { PublicHeader } from "@/components/public-header";
import { SiteFooter } from "@/components/site-footer";
import { SITE } from "@/lib/site";

export const metadata: Metadata = { title: `Terms of Service – ${SITE.name}` };

export default function TermsPage() {
  return (
    <>
      <PublicHeader />
      <main className="public-main legal">
        <h1>Terms of Service</h1>
        <p className="muted">Last updated: {SITE.legalLastUpdated}</p>

        <h2>1. The service</h2>
        <p>
          {SITE.name} checks whether online stores are ready for AI shopping agents and assistants: product data, policy pages, structured data,
          access for AI bots, mentions of the store in AI answers, and AI bot traffic reported by our WordPress plugin. It shows what it observed
          and how to fix it. You make any change in your store yourself.
        </p>

        <h2>2. Read-only access to your store</h2>
        <p>
          For a full scan you give us a WooCommerce REST API key with Read permission. We use it only to read products, settings and pages for the
          checks you ask for. We never edit products, prices or orders, and we do not read customers, orders or payment data. You can delete the
          store, and with it the saved key, at any time.
        </p>

        <h2>3. The WordPress plugin</h2>
        <p>
          The optional agentscope-core plugin counts requests that name a known AI service in their user agent or referrer, and sends daily totals
          only (day, source, type, page type, HTTP status, count). It does not send IP addresses, user agents, page URLs or cookies. You can
          disconnect or delete it at any time.
        </p>

        <h2>4. No guarantee of AI visibility or sales</h2>
        <p>
          We do not promise that your store will be mentioned, recommended or ranked by any AI assistant, or that fixing findings will bring visits
          or sales. AI services change their behaviour without notice and decide on their own what they show.
        </p>

        <h2>5. AI answers</h2>
        <p>
          AI visibility results show what an AI model answered to a question at a given time. They are the model&apos;s words, not facts checked by
          us, and other runs or apps can answer differently. Names, prices or claims in those answers may be wrong.
        </p>

        <h2>6. Your responsibilities</h2>
        <p>
          Use the service only for stores you own or are allowed to check. Do not use it to overload, attack or scrape other sites, or to get around
          limits. Keep your account credentials safe. You are responsible for the changes you make in your store.
        </p>

        <h2>7. Plans and limits</h2>
        <p>
          Each plan has the limits shown on the <Link href="/pricing">pricing page</Link> (stores, scans, questions). Paid plans are not open yet;
          when they are, prices and billing terms will be shown before you pay.
        </p>

        <h2>8. Limitation of liability</h2>
        <p>
          The service is provided &quot;as is&quot;. Checks can miss problems or report false ones, for example when a store blocks or rate-limits our
          requests. To the extent the law allows, we are not liable for indirect or consequential losses, lost profits or lost sales, and our total
          liability is limited to the amount you paid us in the 12 months before the claim (zero on the free plan).
        </p>

        <h2>9. Cancellation</h2>
        <p>
          You can stop using the service and delete your stores at any time. We may suspend accounts that break these terms or put the service or
          other sites at risk.
        </p>

        <h2>10. Changes</h2>
        <p>
          We may update these terms. The date at the top shows the latest version; for important changes we will tell signed-in users before they
          apply. Using the service after a change means you accept it.
        </p>

        <h2>Contact</h2>
        <p>Questions: <a href={`mailto:${SITE.contactEmail}`}>{SITE.contactEmail}</a>. See also the <Link href="/privacy">Privacy Policy</Link>.</p>
      </main>
      <SiteFooter />
    </>
  );
}
