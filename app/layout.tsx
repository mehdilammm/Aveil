import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "AgentScope",
  description: "Check whether your WooCommerce store is ready for AI shopping agents.",
};

export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: "#0d3b2e" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
