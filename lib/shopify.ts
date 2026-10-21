// Shopify support for the public check: platform markers, product links, and the public /products.json list.
import type { Finding } from "./rules";
import { plainText } from "./rules";

export const SHOPIFY_PRODUCTS_LIMIT = 10;
export const SHOPIFY_LIST_NOTE = "Checked the first 10 products from the public Shopify product list.";

export function detectShopify(html: string, shopifyHeader = false): boolean {
  return shopifyHeader || /cdn\.shopify\.com|Shopify\.theme|Shopify\.shop\s*=|\/cdn\/shop\/|myshopify\.com/i.test(html);
}

const PRODUCT_PATH_RE = /^(?:\/collections\/[^/]+)?\/products\/([a-z0-9][a-z0-9-_%.]*)\/?$/i;

function sameSite(a: URL, b: URL) {
  return a.hostname.replace(/^www\./, "") === b.hostname.replace(/^www\./, "");
}

// /products/<handle> (also under /collections/<c>/), normalized to https://host/products/<handle>.
export function shopifyProductUrl(raw: string, base: URL): string | null {
  try {
    const u = new URL(raw.replace(/&amp;/g, "&"), base);
    if (u.protocol !== "https:" || !sameSite(u, base)) return null;
    const m = PRODUCT_PATH_RE.exec(u.pathname);
    return m ? `https://${u.host}/products/${m[1]}` : null;
  } catch {
    return null;
  }
}

export function shopifyProductLinks(html: string, pageUrl: string, max = 2): string[] {
  const base = new URL(pageUrl);
  const out: string[] = [];
  for (const m of html.matchAll(/href\s*=\s*["']([^"'#][^"'#]*)/gi)) {
    const u = shopifyProductUrl(m[1], base);
    if (u && !out.includes(u)) out.push(u);
    if (out.length >= max) break;
  }
  return out;
}

// sitemap.xml on Shopify is an index; its product part is sitemap_products_1.xml?from=…&to=…
export function shopifyProductSitemap(indexXml: string, pageUrl: string): string | null {
  const base = new URL(pageUrl);
  for (const m of indexXml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)) {
    try {
      const u = new URL(m[1].replace(/&amp;/g, "&"));
      if (sameSite(u, base) && u.protocol === "https:" && /sitemap_products_\d+\.xml/i.test(u.pathname)) return u.toString();
    } catch {
      // skip
    }
  }
  return null;
}

type Variant = { id?: number; title?: string; price?: string | null; compare_at_price?: string | null; available?: boolean; grams?: number; requires_shipping?: boolean };
type Product = { id: number; title: string; handle: string; body_html?: string | null; vendor?: string | null; images?: unknown[]; variants?: Variant[] };

export type ShopifyListResult =
  | { status: "ok"; checked: number; findings: Finding[]; handles: string[] }
  | { status: "unavailable"; reason: string };

const num = (v: string | null | undefined) => (v === null || v === undefined || String(v).trim() === "" ? NaN : Number(v));

function variantNames(vs: Variant[]): string {
  return vs.map((v) => (v.title && v.title !== "Default Title" ? `"${v.title}"` : "the only variant")).join(", ");
}

// Reads /products.json. Anything other than a JSON product list is "unavailable", not a problem of the store.
export function checkShopifyProducts(body: string, origin: string): ShopifyListResult {
  let data: { products?: unknown };
  try {
    data = JSON.parse(body);
  } catch {
    return { status: "unavailable", reason: "the product list is not public on this store (no JSON answer)" };
  }
  if (!data || !Array.isArray(data.products)) return { status: "unavailable", reason: "the answer is not a Shopify product list" };

  const products = (data.products as Product[]).filter((p) => p && typeof p.id === "number" && typeof p.title === "string").slice(0, SHOPIFY_PRODUCTS_LIMIT);
  const findings: Finding[] = [];
  for (const p of products) {
    const variants = Array.isArray(p.variants) ? p.variants : [];
    const url = `${origin}/products/${p.handle}`;
    const add = (rule: string, x: Omit<Finding, "finding_key" | "type" | "product_id" | "fix_url">) =>
      findings.push({ finding_key: `shopify:${rule}:${p.id}`, type: `shopify_${rule}`, product_id: p.id, fix_url: url, ...x });
    const where = `Shopify admin → Products → "${p.title}"`;

    const noPrice = variants.filter((v) => !Number.isFinite(num(v.price)) || num(v.price) === 0);
    if (noPrice.length) {
      add("price_zero", {
        title: `"${p.title}": price missing or 0, may be intentional`,
        severity: "medium",
        basis: "observed",
        evidence: `${noPrice.length} of ${variants.length} variants have no price or a price of 0: ${variantNames(noPrice)}.`,
        guidance: `If it is not free on purpose, set the price in ${where} → Pricing (or per variant under Variants).`,
      });
    }

    const badCompare = variants.filter((v) => Number.isFinite(num(v.compare_at_price)) && Number.isFinite(num(v.price)) && num(v.compare_at_price) > 0 && num(v.compare_at_price) <= num(v.price));
    if (badCompare.length) {
      add("compare_at_not_higher", {
        title: `"${p.title}": "compare at" price is not higher than the price`,
        severity: "medium",
        basis: "observed",
        evidence: badCompare.map((v) => `${v.title && v.title !== "Default Title" ? `"${v.title}": ` : ""}price ${v.price}, compare at ${v.compare_at_price}`).join("; ") + ".",
        guidance: `A discount needs "Compare-at price" above "Price". Fix or clear it in ${where} → Pricing.`,
      });
    }

    if (!Array.isArray(p.images) || p.images.length === 0) {
      add("no_images", { title: `"${p.title}": no images`, severity: "medium", basis: "observed", evidence: "The product has no images.", guidance: `Add product photos in ${where} → Media.` });
    }

    const text = plainText(p.body_html ?? "");
    if (text.length < 80) {
      add("short_description", {
        title: `"${p.title}": short description`,
        severity: "low",
        basis: "heuristic",
        evidence: `The description has ${text.length} characters of text (under 80).`,
        guidance: `Describe what it is, materials, sizes and use in ${where} → Description. AI agents rely on it to match questions.`,
      });
    }

    if (!(p.vendor ?? "").trim()) {
      add("no_vendor", {
        title: `"${p.title}": vendor (brand) is empty`,
        severity: "medium",
        basis: "observed",
        evidence: "The product's vendor field is empty.",
        guidance: `Set Vendor in ${where} → Product organization. Product feeds such as ChatGPT's require a brand.`,
      });
    }

    if (variants.length && variants.every((v) => v.available === false)) {
      add("unavailable", { title: `"${p.title}": no variant can be bought (information)`, severity: "low", basis: "observed", evidence: `All ${variants.length} variants are marked unavailable.`, guidance: "Nothing to do if it is sold out on purpose. Otherwise check inventory in Shopify admin." });
    }

    const noWeight = variants.filter((v) => v.requires_shipping !== false && (v.grams ?? 0) === 0);
    if (noWeight.length) {
      add("no_weight", {
        title: `"${p.title}": shipped product with weight 0`,
        severity: "medium",
        basis: "observed",
        evidence: `${noWeight.length} of ${variants.length} variants need shipping and have a weight of 0: ${variantNames(noWeight)}.`,
        guidance: `Set the weight in ${where} → Shipping so shipping cost can be calculated.`,
      });
    }
  }
  return { status: "ok", checked: products.length, findings, handles: products.map((p) => p.handle) };
}

// Lowest variant price per handle from /products.json, the most exact price source on a Shopify store.
export function shopifyPricesByHandle(body: string): Map<string, number> {
  const out = new Map<string, number>();
  try {
    const data = JSON.parse(body) as { products?: Product[] };
    for (const p of Array.isArray(data.products) ? data.products : []) {
      const prices = (p.variants ?? []).map((v) => num(v.price)).filter((n) => Number.isFinite(n));
      if (p.handle && prices.length) out.set(p.handle, Math.min(...prices));
    }
  } catch {
    // not a product list
  }
  return out;
}

export function handleOf(url: string): string | null {
  try {
    return /\/products\/([^/?#]+)/.exec(new URL(url).pathname)?.[1] ?? null;
  } catch {
    return null;
  }
}
