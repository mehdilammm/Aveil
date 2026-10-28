import "server-only";
import { classifyPages } from "./fixes/llms-txt";
import { buildFeed, type FeedInput, type FeedLink, type FeedProductIn, type FeedResult, type FeedVariationIn } from "./feed-build";
import { wooCommerceAdapter } from "./platform/woocommerce";
import { fetchPublishedProducts, fetchPublishedVariations, type WooCredentials } from "./woo";

const VARIATION_CONCURRENCY = 4;

// Policy pages as seller links (ACP Link types): the terms page from WooCommerce, the others by title or address.
export function policyLinks(pages: { title: string; url: string; kind: string }[], termsUrl: string | null): FeedLink[] {
  const out: FeedLink[] = [];
  const add = (type: FeedLink["type"], p: { title: string; url: string } | undefined) => {
    if (p && !out.some((l) => l.type === type)) out.push({ type, title: p.title, url: p.url });
  };
  const policy = pages.filter((p) => p.kind === "policy");
  add("terms_of_service", policy.find((p) => p.url === termsUrl) ?? policy.find((p) => /terms|conditions/i.test(`${p.title} ${p.url}`)));
  add("privacy_policy", policy.find((p) => /privacy/i.test(`${p.title} ${p.url}`)));
  add("refund_policy", policy.find((p) => /refund|return/i.test(`${p.title} ${p.url}`)));
  add("shipping_policy", policy.find((p) => /shipping|delivery/i.test(`${p.title} ${p.url}`)));
  return out;
}

// Reads every published product (and the variations of variable ones) with the read key, then builds the feed.
export async function buildStoreFeed(store: { id: string; url: string }, creds: WooCredentials, now = new Date()): Promise<FeedResult> {
  const adapter = wooCommerceAdapter(store.url, creds);
  const [{ items }, { settings, pages, siteName }, categories] = await Promise.all([fetchPublishedProducts(store.url, creds), adapter.fetchPolicies(), adapter.fetchCategories()]);
  const products = items as unknown as FeedProductIn[];
  const variations: Record<number, FeedVariationIn[]> = {};
  const variable = products.filter((p) => p.type === "variable");
  for (let i = 0; i < variable.length; i += VARIATION_CONCURRENCY) {
    await Promise.all(variable.slice(i, i + VARIATION_CONCURRENCY).map(async (p) => {
      variations[p.id] = (await fetchPublishedVariations(store.url, p.id, creds)) as unknown as FeedVariationIn[];
    }));
  }
  const s = settings.ok ? settings.data : null;
  const classified = pages.ok ? classifyPages(pages.data, s, store.url) : [];
  const termsId = Number(s?.woocommerce_terms_page_id ?? 0);
  const termsSlug = pages.ok ? pages.data.find((p) => p.id === termsId)?.slug : undefined;
  const input: FeedInput = {
    feedId: `agentscope-${store.id.slice(0, 8)}`,
    storeUrl: store.url,
    siteName: siteName.ok ? siteName.data : null,
    currency: s?.woocommerce_currency ?? null,
    country: (s?.woocommerce_default_country ?? "").split(":")[0].toUpperCase() || null,
    products,
    variations,
    categories: categories.ok ? categories.data : [],
    links: policyLinks(classified, termsSlug ? `${store.url}/${termsSlug}/` : null),
    now,
  };
  return buildFeed(input);
}
