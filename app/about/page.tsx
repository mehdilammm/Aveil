import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { InfoPage } from "@/components/info-page";
import { SITE } from "@/lib/site";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("trust"))("aboutTitle"), alternates: { canonical: "/about" } };
}

export default async function AboutPage() {
  const t = await getTranslations("trust");
  return (
    <InfoPage title={t("aboutTitle")} sub={t("aboutSub")}>
      <div className="card">
        <p>{t("aboutP1")}</p>
        <p>{t("aboutP2")}</p>
      </div>
      <div className="card">
        <p>{t("aboutWho", { company: SITE.companyName })}</p>
        <p>{t("aboutWhere", { city: SITE.companyCity })}</p>
        <p>{t("aboutContact", { email: SITE.contactEmail })}</p>
        <p className="muted small">{t("placeholderNote")}</p>
      </div>
    </InfoPage>
  );
}
