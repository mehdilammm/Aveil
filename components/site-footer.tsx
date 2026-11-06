import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { LanguageSwitch } from "@/components/language-switch";
import { SITE } from "@/lib/site";

export async function SiteFooter() {
  const t = await getTranslations("footer");
  return (
    <footer className="site-footer">
      <nav aria-label={t("navLabel")} className="row">
        <Link href="/check">{t("check")}</Link>
        <Link href="/pricing">{t("pricing")}</Link>
        <Link href="/case-study">{t("caseStudy")}</Link>
        <Link href="/security">{t("security")}</Link>
        <Link href="/about">{t("about")}</Link>
        <Link href="/glossary">{t("glossary")}</Link>
        <Link href="/bot">{t("bot")}</Link>
        <Link href="/terms">{t("terms")}</Link>
        <Link href="/privacy">{t("privacy")}</Link>
        <Link href="/refund">{t("refund")}</Link>
      </nav>
      <p className="small"><Link href="/contact">{t("contact", { email: SITE.contactEmail })}</Link></p>
      <LanguageSwitch />
      <p className="muted small">{t("note", { year: new Date().getUTCFullYear(), name: SITE.name })}</p>
    </footer>
  );
}
