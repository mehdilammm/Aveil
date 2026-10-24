import Link from "next/link";
import { useTranslations } from "next-intl";
import { SITE } from "@/lib/site";

export function PublicHeader() {
  const t = useTranslations("landing.nav");
  return (
    <header className="sidebar public-header">
      <div className="brand-row">
        <Link href="/" className="brand">{SITE.name}</Link>
        <nav aria-label="Public" className="public-nav">
          <Link href="/check">{t("check")}</Link>
          <Link href="/pricing">{t("pricing")}</Link>
          <Link href="/login">{t("login")}</Link>
        </nav>
      </div>
    </header>
  );
}
