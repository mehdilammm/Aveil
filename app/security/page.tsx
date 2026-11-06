import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { Icon, type IconName } from "@/components/icons";
import { InfoPage } from "@/components/info-page";
import { SITE } from "@/lib/site";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("trust"))("secTitle"), alternates: { canonical: "/security" } };
}

const ITEMS: [string, IconName][] = [["s_read", "search"], ["s_vault", "lock"], ["s_undo", "fix"], ["s_signed", "plug"], ["s_browser", "bot"], ["s_customers", "cart"]];

export default async function SecurityPage() {
  const t = await getTranslations("trust");
  return (
    <InfoPage title={t("secTitle")} sub={t("secSub")}>
      <div className="features">
        {ITEMS.map(([k, icon]) => (
          <div key={k} className="card">
            <h3 className="row"><Icon name={icon} /> {t(k)}</h3>
            <p className="muted">{t(`${k}D`)}</p>
          </div>
        ))}
      </div>
      <p className="muted small">{t("secReport", { email: SITE.contactEmail })}</p>
    </InfoPage>
  );
}
