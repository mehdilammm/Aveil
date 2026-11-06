import Link from "next/link";
import { useId } from "react";
import { useTranslations } from "next-intl";

export const GLOSSARY = ["gtin", "llms_txt", "robots_txt", "structured_data", "product_feed", "oai_searchbot", "chatgpt_user", "order_attribution", "ucp_acp"] as const;
export type GlossaryKey = (typeof GLOSSARY)[number];

// A technical word with a small "?" that opens its plain definition (HTML popover: no JavaScript, works on phones).
export function Term({ k, children }: { k: GlossaryKey; children?: React.ReactNode }) {
  const t = useTranslations("glossary");
  const id = `term-${k}-${useId().replace(/[^a-zA-Z0-9]/g, "")}`;
  const term = t(`${k}.term`);
  return (
    <span className="term">
      {children ?? term}
      <button type="button" className="term-q" popoverTarget={id} aria-label={t("what", { term })}>?</button>
      <span id={id} popover="auto" className="term-pop" role="note">
        <strong>{term}</strong> {t(`${k}.def`)} <Link href={`/glossary#${k}`}>{t("more")}</Link>
      </span>
    </span>
  );
}
