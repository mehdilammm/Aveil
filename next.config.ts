import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

// F7 Mode B: Chromium (@sparticuz/chromium) stays outside the bundle; its compressed binary files (~70 MB) are shipped
// with one function only, /api/jobs/browser, which the queue's tick calls for each browser test.
// Excluded everywhere: sharp's native image libraries (~47 MB; Vercel optimizes images itself, nothing here uses
// sharp) and files that are never read at run time (screenshots, the WordPress plugin source, test fixtures).
const BROWSER_FILES = ["./node_modules/@sparticuz/chromium/bin/**"];
const nextConfig: NextConfig = {
  serverExternalPackages: ["@sparticuz/chromium", "puppeteer-core"],
  outputFileTracingIncludes: { "/api/jobs/browser": BROWSER_FILES },
  outputFileTracingExcludes: {
    "*": ["node_modules/@img/**", "node_modules/sharp/**", "audit/**", "wordpress/**", "lib/fixtures/**", "**/*.test.ts", "*.tsbuildinfo", ".git/**"],
  },
};

export default createNextIntlPlugin("./i18n/request.ts")(nextConfig);
