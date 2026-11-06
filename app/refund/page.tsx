import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { InfoPage } from "@/components/info-page";
import { SITE } from "@/lib/site";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("trust"))("refTitle"), alternates: { canonical: "/refund" } };
}

// Placeholder until the refund rule is decided (Paddle needs a published policy before paid plans open).
export default async function RefundPage() {
  const t = await getTranslations("trust");
  return (
    <InfoPage title={t("refTitle")} sub={t("refSub")}>
      <div className="card">
        <p>{t("refPlaceholder")}</p>
        <p className="muted small">{t("refContact", { email: SITE.contactEmail })}</p>
      </div>
    </InfoPage>
  );
}
