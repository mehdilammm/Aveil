import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { InfoPage } from "@/components/info-page";
import { SITE } from "@/lib/site";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("trust"))("contactTitle"), alternates: { canonical: "/contact" } };
}

export default async function ContactPage() {
  const t = await getTranslations("trust");
  return (
    <InfoPage title={t("contactTitle")}>
      <div className="card">
        <p>{t("contactP", { email: SITE.contactEmail })}</p>
        <p><a className="button" href={`mailto:${SITE.contactEmail}`}>{SITE.contactEmail}</a></p>
      </div>
    </InfoPage>
  );
}
