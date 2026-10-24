import type { Metadata } from "next";
import Link from "next/link";
import { PublicHeader } from "@/components/public-header";
import { SiteFooter } from "@/components/site-footer";
import { getTranslations } from "next-intl/server";
import { PLAN_ORDER, PLANS } from "@/lib/plans";
import { WaitlistForm } from "./waitlist-form";

export const metadata: Metadata = { title: "Pricing", description: "Free, Pro and Agency plans for WooCommerce AI readiness checks, AI visibility tracking and AI bot traffic.", alternates: { canonical: "/pricing" } };

export default async function PricingPage() {
  const t = await getTranslations("pricingPage");
  return (
    <>
      <PublicHeader />
      <main className="public-main">
        <div className="page-head">
          <h1>{t("title")}</h1>
          <p className="sub">{t("sub")}</p>
        </div>
        <div className="plans">
          {PLAN_ORDER.map((id) => {
            const p = PLANS[id];
            return (
              <div key={id} className={`card plan${id === "pro" ? " plan-featured" : ""}`}>
                <h2>{p.name}</h2>
                <p className="plan-price"><strong>${p.priceUsdPerMonth}</strong><span className="muted">{t("perMonth")}</span></p>
                <ul>{p.features.map((f) => <li key={f}>{t(`f.${f}` as "f.stores", { stores: p.stores, questions: p.visibilityQuestions, per: p.visibilityPer, sample: p.sampleProducts })}</li>)}</ul>
                {p.cta === "signup" ? <Link href="/login?mode=signup" className="button">{t("signup")}</Link> : <WaitlistForm plan={id} />}
              </div>
            );
          })}
        </div>
        <p className="muted small">{t("foot")}</p>
      </main>
      <SiteFooter />
    </>
  );
}
