import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { wooCommerceAdapter } from "../platform/woocommerce";
import { pageUrlOf, sampleProducts } from "../sampling";
import { fetchPublicCategories, fetchPublicPage, fetchSiteInfo, type WooCredentials } from "../woo";
import { classifyPages, type LlmsInput } from "./llms-txt";
import type { WafInput } from "./waf";

const CHECKER_UA = "AgentScope/0.3 (+fix generators)";
const LLMS_PRODUCTS = 20;

export type GeneratorInputs = {
  robots: { text: string; status: number | null; reason: string | null };
  productPath: string | null;
  llms: LlmsInput;
  waf: WafInput;
  unavailable: string[];
};

// Everything the generators use, read now from the store (public pages, its API) and from the last scan.
export async function generatorInputs(admin: SupabaseClient, store: { id: string; owner_id: string; url: string }, creds: WooCredentials): Promise<GeneratorInputs> {
  const adapter = wooCommerceAdapter(store.url, creds);
  const unavailable: string[] = [];
  const [robotsRes, home, info, cats, policies, firstPage] = await Promise.all([
    fetchPublicPage(`${store.url}/robots.txt`, CHECKER_UA),
    fetchPublicPage(`${store.url}/`, CHECKER_UA),
    fetchSiteInfo(store.url),
    fetchPublicCategories(store.url),
    adapter.fetchPolicies(),
    adapter.fetchProductsPage(1),
  ]);
  const robots = robotsRes.ok
    ? robotsRes.status === 200 && !robotsRes.redirectedTo ? { text: robotsRes.body, status: 200, reason: null } : { text: "", status: robotsRes.status, reason: `robots.txt answered HTTP ${robotsRes.status}${robotsRes.redirectedTo ? ` (redirect to ${robotsRes.redirectedTo})` : ""}; the patch starts from an empty file.` }
    : { text: "", status: null, reason: `robots.txt could not be loaded: ${robotsRes.error}.` };
  if (robots.reason) unavailable.push(robots.reason);
  if (!info.ok) unavailable.push(info.reason);
  if (!cats.ok) unavailable.push(cats.reason);
  if (!policies.pages.ok) unavailable.push(policies.pages.reason);

  const products = sampleProducts(store.url, firstPage.items, LLMS_PRODUCTS).items;
  const settings = policies.settings.ok ? policies.settings.data : null;
  const currency = settings && /^[A-Z]{3}$/.test(settings.woocommerce_currency ?? "") ? settings.woocommerce_currency : null;

  // Access results of the last complete scan.
  const { data: scan } = await admin.from("scans").select("id").eq("store_id", store.id).eq("status", "complete").order("created_at", { ascending: false }).limit(1).maybeSingle();
  const { data: access } = scan ? await admin.from("findings").select("finding_key, type").eq("scan_id", scan.id).like("finding_key", "access:%") : { data: [] };
  const bots = (type: string) => (access ?? []).filter((f) => f.type === type).map((f) => String(f.finding_key).slice("access:".length));

  return {
    robots,
    productPath: products[0] ? new URL(pageUrlOf(store.url, products[0])!).pathname : null,
    llms: {
      storeUrl: store.url,
      siteName: info.ok ? info.data.name : null,
      tagline: info.ok ? info.data.description : null,
      currency,
      pages: policies.pages.ok ? classifyPages(policies.pages.data, settings, store.url) : [],
      categories: cats.ok ? cats.data.map((c) => ({ name: c.name, url: c.link, count: c.count })) : [],
      products: products.map((p) => ({ name: p.name, url: pageUrlOf(store.url, p)!, price: p.price && p.price.trim() ? p.price : null, category: (p as { categories?: { name?: string }[] }).categories?.[0]?.name ?? null })),
    },
    waf: { vendor: home.ok ? home.vendorHint ?? null : null, blocked: bots("access_blocked"), rateLimited: bots("access_rate_limited"), challenged: bots("access_degraded") },
    unavailable,
  };
}
