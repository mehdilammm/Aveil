import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

// F7 Mode B: Chromium (@sparticuz/chromium) stays outside the bundle; its compressed binary files are shipped
// only with the functions that run the job queue's browser tests (the cron tick, and the route that starts a test).
const BROWSER_FILES = ["./node_modules/@sparticuz/chromium/bin/**"];
const nextConfig: NextConfig = {
  serverExternalPackages: ["@sparticuz/chromium", "puppeteer-core"],
  outputFileTracingIncludes: { "/api/jobs/tick": BROWSER_FILES, "/api/stores/*/simulate": BROWSER_FILES },
};

export default createNextIntlPlugin("./i18n/request.ts")(nextConfig);
