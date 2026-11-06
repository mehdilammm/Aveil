import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { InfoPage } from "@/components/info-page";
import { GLOSSARY } from "@/components/term";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("glossary"))("title"), alternates: { canonical: "/glossary" } };
}

export default async function GlossaryPage() {
  const t = await getTranslations("glossary");
  return (
    <InfoPage title={t("title")} sub={t("sub")}>
      <dl className="glossary">
        {GLOSSARY.map((k) => (
          <div key={k} id={k} className="card">
            <dt><strong>{t(`${k}.term`)}</strong></dt>
            <dd>{t(`${k}.def`)}</dd>
          </div>
        ))}
      </dl>
    </InfoPage>
  );
}
