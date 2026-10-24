import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { PublicHeader } from "@/components/public-header";
import { SiteFooter } from "@/components/site-footer";
import { SEO_DESCRIPTION, softwareApplicationJsonLd } from "@/lib/seo";
import { getUser } from "@/lib/supabase/server";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("landing");
  return { title: { absolute: t("metaTitle") }, description: SEO_DESCRIPTION, alternates: { canonical: "/" } };
}

const POINTS = ["multi", "bots", "check", "noScore"] as const;
const STEPS = ["see", "fix", "prove"] as const;
const FAQ = ["change", "shopify", "need"] as const;

export default async function Home() {
  const { user } = await getUser();
  if (user) redirect("/stores");
  const t = await getTranslations("landing");

  return (
    <>
      <PublicHeader />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(softwareApplicationJsonLd()).replace(/</g, "\\u003c") }} />
      <main className="public-main landing">
        <section className="hero">
          <h1>{t("hero")}</h1>
          <p className="sub lead">{t("edge")}</p>
          <div className="row">
            <Link href="/check" className="button">{t("ctaCheck")}</Link>
            <Link href="/login?mode=signup" className="button secondary">{t("ctaSignup")}</Link>
          </div>
        </section>

        <section aria-labelledby="steps">
          <h2 id="steps">{t("stepsTitle")}</h2>
          <div className="features">
            {STEPS.map((k) => (
              <div key={k} className="card">
                <h3>{t(`steps.${k}.t`)}</h3>
                <p className="muted">{t(`steps.${k}.d`)}</p>
              </div>
            ))}
          </div>
        </section>

        <section aria-labelledby="points">
          <h2 id="points">{t("pointsTitle")}</h2>
          <div className="features">
            {POINTS.map((k) => (
              <div key={k} className="card">
                <h3>{t(`points.${k}.t`)}</h3>
                <p className="muted">{t(`points.${k}.d`)}</p>
              </div>
            ))}
          </div>
        </section>

        <section aria-labelledby="loop">
          <h2 id="loop">{t("loopTitle")}</h2>
          <div className="card">
            <div className="loop">
              <div><span className="loop-n">43</span><span className="muted small">{t("loopFound")}</span></div>
              <span aria-hidden="true" className="loop-arrow">→</span>
              <div><span className="loop-n">19</span><span className="muted small">{t("loopAfter")}</span></div>
            </div>
            <p>{t("loopText")}</p>
            <p className="muted small">{t("loopNote")}</p>
          </div>
        </section>

        <section aria-labelledby="honest">
          <h2 id="honest">{t("honestTitle")}</h2>
          <div className="card">
            <p>{t("honestIntro")}</p>
            <p className="label-row"><span className="badge basis-observed">Observed</span> <span>{t("observed")}</span></p>
            <p className="label-row"><span className="badge basis-heuristic">Heuristic</span> <span>{t("heuristic")}</span></p>
            <p className="label-row"><span className="badge basis-unavailable">Unavailable</span> <span>{t("unavailable")}</span></p>
            <p className="muted">{t("honestNote")}</p>
          </div>
        </section>

        <section aria-labelledby="faq">
          <h2 id="faq">{t("faqTitle")}</h2>
          {FAQ.map((k) => (
            <details key={k} className="card faq">
              <summary><strong>{t(`faq.${k}.q`)}</strong></summary>
              <p>{t(`faq.${k}.a`)}</p>
            </details>
          ))}
        </section>

        <div className="cta">
          <p><strong>{t("ctaTitle")}</strong> {t("ctaSub")}</p>
          <div className="row">
            <Link href="/check" className="button">{t("ctaCheck")}</Link>
            <Link href="/pricing" className="button secondary on-dark">{t("ctaPricing")}</Link>
          </div>
        </div>
      </main>
      <SiteFooter />
    </>
  );
}
