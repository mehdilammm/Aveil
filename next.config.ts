import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";
import { STATIC_SECURITY_HEADERS } from "./lib/security-headers";

// F7 Mode B: the app never starts Chromium; the browser test runs in browser-runner/, a separate Vercel project.
// Excluded everywhere: sharp's native image libraries (~47 MB; Vercel optimizes images itself, nothing here uses
// sharp) and files that are never read at run time (screenshots, the WordPress plugin source, test fixtures).
const nextConfig: NextConfig = {
  serverExternalPackages: ["@sparticuz/chromium", "puppeteer-core"],
  poweredByHeader: false,
  headers: async () => [{ source: "/:path*", headers: STATIC_SECURITY_HEADERS }],
  outputFileTracingExcludes: {
    "*": ["node_modules/@img/**", "node_modules/sharp/**", "audit/**", "wordpress/**", "lib/fixtures/**", "**/*.test.ts", "*.tsbuildinfo", ".git/**"],
  },
};

export default createNextIntlPlugin("./i18n/request.ts")(nextConfig);
