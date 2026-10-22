import type { Metadata, Viewport } from "next";
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

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
