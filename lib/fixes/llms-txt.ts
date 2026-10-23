// llms.txt (llmstxt.org format) written only from the store's own data: its name and tagline, its published
// pages, categories and products as WooCommerce returns them. Nothing is invented: a missing field is left out,
// and the missing parts are listed so the merchant can add them.
export type LlmsInput = {
  storeUrl: string;
  siteName: string | null;
  tagline: string | null;
  currency: string | null;
  pages: { title: string; url: string; kind: "shop" | "policy" | "page" }[];
  categories: { name: string; url: string | null; count: number }[];
  products: { name: string; url: string; price: string | null; category: string | null }[];
};

const clean = (t: string) => t.replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/&#8217;/g, "’").replace(/&#8211;/g, "–").replace(/&quot;/g, '"').replace(/\s+/g, " ").trim();
const md = (t: string) => clean(t).replace(/([[\]])/g, "\\$1");

export function buildLlmsTxt(i: LlmsInput): { text: string; missing: string[] } {
  const missing: string[] = [];
  const name = i.siteName ? clean(i.siteName) : null;
  if (!name) missing.push("site title");
  const out: string[] = [`# ${name ?? new URL(i.storeUrl).hostname}`, ""];
  if (i.tagline && clean(i.tagline)) out.push(`> ${clean(i.tagline)}`, "");
  else missing.push("site tagline (Settings → General)");

  const section = (title: string, rows: string[]) => {
    if (rows.length) out.push(`## ${title}`, "", ...rows, "");
  };
  section("Shop", i.pages.filter((p) => p.kind === "shop").map((p) => `- [${md(p.title)}](${p.url})`));
  const cats = i.categories.filter((c) => c.count > 0 && c.url);
  section("Categories", cats.map((c) => `- [${md(c.name)}](${c.url}): ${c.count} product${c.count === 1 ? "" : "s"}`));
  section(
    "Products",
    i.products.map((p) => {
      const notes = [p.price && i.currency ? `${p.price} ${i.currency}` : p.price ? p.price : null, p.category ? clean(p.category) : null].filter(Boolean);
      return `- [${md(p.name)}](${p.url})${notes.length ? `: ${notes.join(", ")}` : ""}`;
    }),
  );
  const policies = i.pages.filter((p) => p.kind === "policy");
  section("Policies", policies.map((p) => `- [${md(p.title)}](${p.url})`));
  if (!policies.length) missing.push("published policy pages (returns, privacy, terms)");
  section("Optional", i.pages.filter((p) => p.kind === "page").map((p) => `- [${md(p.title)}](${p.url})`));
  if (i.products.some((p) => !p.price)) missing.push(`price on ${i.products.filter((p) => !p.price).length} listed product(s)`);
  return { text: out.join("\n").replace(/\n+$/, "\n"), missing };
}

// Which published page is which: the WooCommerce page settings first, then policy words in the title or address.
export function classifyPages(pages: { id: number; slug: string; title: string }[], settings: Record<string, string> | null, storeUrl: string) {
  const ids = (keys: string[]) => new Set(keys.map((k) => Number(settings?.[k] ?? 0)).filter((n) => n > 0));
  const shop = ids(["woocommerce_shop_page_id"]);
  const skip = ids(["woocommerce_cart_page_id", "woocommerce_checkout_page_id", "woocommerce_myaccount_page_id"]);
  const terms = ids(["woocommerce_terms_page_id"]);
  return pages
    .filter((p) => !skip.has(p.id))
    .map((p) => ({
      title: clean(p.title) || p.slug,
      url: `${storeUrl}/${p.slug}/`,
      kind: (shop.has(p.id) ? "shop" : terms.has(p.id) || /privacy|refund|return|shipping|terms|delivery/i.test(`${p.slug} ${p.title}`) ? "policy" : "page") as "shop" | "policy" | "page",
    }));
}
