import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { LanguageSwitch } from "@/components/language-switch";
import { SITE } from "@/lib/site";

export async function SiteFooter() {
  const t = await getTranslations("footer");
  return (
    <footer className="site-footer">
      <nav aria-label="Footer" className="row">
        <Link href="/check">{t("check")}</Link>
        <Link href="/pricing">{t("pricing")}</Link>
        <Link href="/bot">{t("bot")}</Link>
        <Link href="/terms">{t("terms")}</Link>
        <Link href="/privacy">{t("privacy")}</Link>
      </nav>
      <LanguageSwitch />
      <p className="muted small">{t("note", { year: new Date().getUTCFullYear(), name: SITE.name })}</p>
    </footer>
  );
}
