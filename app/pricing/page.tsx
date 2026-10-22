import type { Metadata } from "next";
import Link from "next/link";
import { PublicHeader } from "@/components/public-header";
import { SiteFooter } from "@/components/site-footer";
import { PLAN_ORDER, PLANS } from "@/lib/plans";
import { SITE } from "@/lib/site";
import { WaitlistForm } from "./waitlist-form";

export const metadata: Metadata = { title: `Pricing – ${SITE.name}`, description: "Free, Pro and Agency plans for WooCommerce AI readiness checks." };

export default function PricingPage() {
  return (
    <>
      <PublicHeader />
      <main className="public-main">
        <div className="page-head">
          <h1>Pricing</h1>
          <p className="sub">Start free. Paid plans open soon: join the waitlist and we will email you when payments are ready.</p>
        </div>
        <div className="plans">
          {PLAN_ORDER.map((id) => {
            const p = PLANS[id];
            return (
              <div key={id} className={`card plan${id === "pro" ? " plan-featured" : ""}`}>
                <h2>{p.name}</h2>
                <p className="plan-price"><strong>${p.priceUsdPerMonth}</strong><span className="muted">/month</span></p>
                <ul>{p.features.map((f) => <li key={f}>{f}</li>)}</ul>
                {p.cta === "signup" ? <Link href="/login?mode=signup" className="button">Sign up free</Link> : <WaitlistForm plan={id} />}
              </div>
            );
          })}
        </div>
        <p className="muted small">Prices in US dollars. No plan promises AI visibility or sales: AgentScope shows what it observed and how to fix it.</p>
      </main>
      <SiteFooter />
    </>
  );
}
