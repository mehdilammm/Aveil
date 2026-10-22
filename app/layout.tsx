import type { Metadata, Viewport } from "next";
import { NextIntlClientProvider } from "next-intl";
import { getLocale } from "next-intl/server";
import { dirOf, isLocale, DEFAULT_LOCALE } from "@/i18n/config";
import { SEO_DESCRIPTION } from "@/lib/seo";
import { SITE } from "@/lib/site";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL(SITE.url),
  title: { default: `${SITE.name}: AI shopping agent readiness for WooCommerce`, template: `%s – ${SITE.name}` },
  description: SEO_DESCRIPTION,
  applicationName: SITE.name,
  openGraph: { type: "website", siteName: SITE.name, title: SITE.tagline, description: SEO_DESCRIPTION, url: "/" },
  twitter: { card: "summary_large_image", title: SITE.tagline, description: SEO_DESCRIPTION },
};

export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: "#0d3b2e" };

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const current = await getLocale();
  const locale = isLocale(current) ? current : DEFAULT_LOCALE;
  return (
    <html lang={locale} dir={dirOf(locale)}>
      <body>
        <NextIntlClientProvider>{children}</NextIntlClientProvider>
      </body>
    </html>
  );
}
