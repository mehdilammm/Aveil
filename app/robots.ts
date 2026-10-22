import type { MetadataRoute } from "next";
import { robotsRules } from "@/lib/seo";
import { SITE } from "@/lib/site";

export default function robots(): MetadataRoute.Robots {
  return { rules: robotsRules(), sitemap: `${SITE.url}/sitemap.xml`, host: SITE.url };
}
