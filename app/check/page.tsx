import type { Metadata } from "next";
import Link from "next/link";
import { PublicHeader } from "@/components/public-header";
import { SITE } from "@/lib/site";
import { SiteFooter } from "@/components/site-footer";
import { getTranslations } from "next-intl/server";
import { CheckForm } from "./check-form";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("checkPage");
  return {
  title: { absolute: `Free AI agent readiness check for WooCommerce and Shopify stores – ${SITE.name}` },
  alternates: { canonical: "/check" },
  description: t("metaDescription"),
  };
}

export default async function CheckPage() {
  const t = await getTranslations("checkPage");
  return (
    <>
      <PublicHeader />
      <main className="public-main">
        <div className="hero page-head">
          <h1>{t("title")}</h1>
          <p className="sub">{t("sub")}</p>
        </div>
        <CheckForm />
        <h2>{t("whatTitle")}</h2>
        <div className="card">
          <ul>
            {(["robots", "access", "product", "shopify", "status", "gemini", "llms"] as const).map((k) => <li key={k}><strong>{t(`w_${k}_title`)}:</strong> {t(`w_${k}`)}</li>)}
          </ul>
          <p className="muted small">{t("note")} <Link href="/bot">{t("bot")}</Link>.</p>
        </div>
      </main>
      <SiteFooter />
    </>
  );
}
