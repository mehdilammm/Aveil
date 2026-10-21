// JSON-LD Product checks on product pages, compared with the WooCommerce API data.
import type { PageResult } from "./access";
import { describePage, pageGate } from "./gate";
import type { Finding, WooProduct } from "./rules";

type Json = unknown;
type Node = Record<string, Json>;

export type SchemaProduct = {
  kind: "Product" | "ProductGroup";
  name: string | null;
  image: boolean;
  price: string | null; // lowest offer price
  currency: string | null;
  availability: string | null;
  readable: boolean; // false when a Product node exists but none of its fields could be read
};

const LD_RE = /<script[^>]*type\s*=\s*["']?application\/ld\+json["']?[^>]*>([\s\S]*?)<\/script>/gi;

function types(node: Node): string[] {
  const t = node["@type"];
  return (Array.isArray(t) ? t : [t]).filter((x): x is string => typeof x === "string").map((x) => x.replace(/^https?:\/\/schema\.org\//, ""));
}

const isProductType = (node: Node) => types(node).some((t) => t === "Product" || t === "ProductGroup");

function str(v: Json): string | null {
  if (typeof v === "string" && v.trim()) return v.trim();
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  return null;
}

const asArray = <T,>(v: T | T[] | undefined | null): T[] => (Array.isArray(v) ? v : v === undefined || v === null ? [] : [v]);
const objects = (v: Json): Node[] => asArray(v as Json[] | Json).filter((x): x is Node => !!x && typeof x === "object" && !Array.isArray(x));

// Products at the page level: inside @graph, arrays and nested objects, but not variants (hasVariant) or
// products in lists (ItemList of related products), which are not the page's product.
function walk(node: Json, out: Node[]) {
  if (Array.isArray(node)) return node.forEach((n) => walk(n, out));
  if (!node || typeof node !== "object") return;
  const obj = node as Node;
  if (isProductType(obj)) {
    out.push(obj);
    return;
  }
  if (types(obj).includes("ItemList")) return;
  for (const [k, v] of Object.entries(obj)) {
    if (k === "hasVariant" || k === "isVariantOf" || k === "offers" || k === "itemListElement") continue;
    if (v && typeof v === "object") walk(v, out);
  }
}

function hasImage(v: Json): boolean {
  return asArray(v as Json[] | Json).some((x) => !!str(x) || (!!x && typeof x === "object" && (!!str((x as Node).url) || !!str((x as Node).contentUrl))));
}

type OfferRead = { price: number | null; priceText: string | null; currency: string | null; availability: string | null };

// Offer, list of offers, AggregateOffer (lowPrice) or priceSpecification.
function readOffers(offers: Json): OfferRead[] {
  return objects(offers).map((o) => {
    const spec = objects(o.priceSpecification)[0];
    const priceText = str(o.price) ?? str(o.lowPrice) ?? str(spec?.price) ?? str(spec?.minPrice);
    const n = priceText === null ? NaN : Number(priceText.replace(/,/g, ""));
    return { price: Number.isFinite(n) ? n : null, priceText, currency: str(o.priceCurrency) ?? str(spec?.priceCurrency), availability: str(o.availability) };
  });
}

function summarize(node: Node): SchemaProduct {
  const kind = types(node).includes("ProductGroup") ? "ProductGroup" : "Product";
  // A ProductGroup carries its offers on the variants (hasVariant); a Product can also list offers per variant.
  const variants = objects(node.hasVariant);
  const offers = [...readOffers(node.offers), ...variants.flatMap((v) => readOffers(v.offers))];
  const priced = offers.filter((o) => o.price !== null).sort((a, b) => a.price! - b.price!);
  const lowest = priced[0] ?? offers[0];
  const inStock = offers.find((o) => /InStock/i.test(o.availability ?? ""));
  const name = str(node.name) ?? str(variants[0]?.name);
  const image = hasImage(node.image) || variants.some((v) => hasImage(v.image));
  const result = {
    kind,
    name,
    image,
    price: lowest?.priceText ?? null,
    currency: lowest?.currency ?? offers.find((o) => o.currency)?.currency ?? null,
    availability: (inStock ?? offers.find((o) => o.availability))?.availability ?? null,
  } as const;
  const readable = Boolean(result.name || result.image || result.price || result.currency || result.availability);
  return { ...result, readable };
}

// The page's product (ProductGroup first, then a Product with offers), and how many JSON-LD blocks were not valid JSON.
export function extractSchemaProducts(html: string): { products: SchemaProduct[]; invalidBlocks: number } {
  const nodes: Node[] = [];
  let invalidBlocks = 0;
  for (const m of html.matchAll(LD_RE)) {
    try {
      walk(JSON.parse(m[1].trim()), nodes);
    } catch {
      invalidBlocks++;
    }
  }
  const ranked = [...nodes].sort((a, b) => score(b) - score(a));
  return { products: ranked.map(summarize), invalidBlocks };
}

function score(n: Node): number {
  return (types(n).includes("ProductGroup") ? 2 : 0) + (n.offers || n.hasVariant ? 1 : 0);
}

const AVAILABILITY_MAP: Record<string, string> = { instock: "InStock", outofstock: "OutOfStock", onbackorder: "BackOrder" };

function schemaAvailability(v: string | null): string | null {
  return v ? v.replace(/^https?:\/\/schema\.org\//i, "") : null;
}

// seen: short description of the response (status, title, markers), added to the evidence.
export type SchemaPage = { product: WooProduct; url: string; html: string | null; fetchError?: string; seen?: string };

export function checkStructuredData(pages: SchemaPage[], storeCurrency: string | null): Finding[] {
  const findings: Finding[] = [];
  for (const page of pages) {
    const p = page.product;
    const f = (type: string, x: Omit<Finding, "finding_key" | "type" | "product_id">): Finding => ({ finding_key: `${type}:${p.id}`, type, product_id: p.id, ...x });

    if (page.html === null) {
      findings.push(f("schema_unavailable", {
        title: "Could not check structured data",
        severity: "low",
        basis: "unavailable",
        evidence: `The product page ${page.url} could not be checked: ${page.fetchError ?? "unknown error"}.`,
        guidance: "Check that the product page loads for visitors. The next scan will try again.",
        fix_url: page.url,
      }));
      continue;
    }

    const { products, invalidBlocks } = extractSchemaProducts(page.html);
    const schema = products[0];
    if (!schema) {
      findings.push(f("schema_product_missing", {
        title: "No Product structured data",
        severity: "medium",
        basis: "observed",
        evidence: `${invalidBlocks
          ? `${page.url} has ${invalidBlocks} JSON-LD block(s) that are not valid JSON, and no Product.`
          : `${page.url} has no JSON-LD Product.`}${page.seen ? ` Page: ${page.seen}.` : ""}`,
        guidance: "WooCommerce adds Product structured data by default. Check that a theme, SEO or cache plugin does not remove or break it.",
        fix_url: page.url,
      }));
      continue;
    }

    if (!schema.readable) {
      findings.push(f("schema_unparsed", {
        title: "Product structured data could not be read",
        severity: "low",
        basis: "unavailable",
        evidence: `${page.url} has a JSON-LD ${schema.kind}, but none of its fields could be read by this check.${page.seen ? ` Page: ${page.seen}.` : ""}`,
        guidance: "Nothing to fix for now: this is a limit of the check, not necessarily of your page.",
        fix_url: page.url,
      }));
      continue;
    }

    const missing = [
      !schema.name && "name",
      !schema.price && "offers.price",
      !schema.currency && "priceCurrency",
      !schema.availability && "availability",
      !schema.image && "image",
    ].filter(Boolean) as string[];
    if (missing.length) {
      findings.push(f("schema_fields_missing", {
        title: "Product structured data is incomplete",
        severity: "medium",
        basis: "observed",
        evidence: `The JSON-LD Product on ${page.url} has no ${missing.join(", ")}.`,
        guidance: "Fill these in the product (price, stock, image) or fix the SEO plugin that writes the structured data.",
        fix_url: page.url,
      }));
    }

    const apiPrice = Number(p.price);
    const schemaPrice = Number(schema.price);
    if (schema.price && (p.price ?? "").trim() !== "" && Number.isFinite(apiPrice) && Number.isFinite(schemaPrice) && Math.abs(apiPrice - schemaPrice) > 0.005) {
      findings.push(f("schema_price_mismatch", {
        title: "Price on the page differs from the store price",
        severity: "high",
        basis: "observed",
        evidence: `Structured data says ${schema.price}${schema.currency ? ` ${schema.currency}` : ""}; WooCommerce says ${p.price}.`,
        guidance: "Agents may quote the wrong price. Clear the page cache and check the plugin that writes structured data, then rescan.",
        fix_url: page.url,
      }));
    }

    if (schema.currency && storeCurrency && schema.currency.toUpperCase() !== storeCurrency.toUpperCase()) {
      findings.push(f("schema_currency_mismatch", {
        title: "Currency on the page differs from the store currency",
        severity: "high",
        basis: "observed",
        evidence: `Structured data says ${schema.currency}; the store currency is ${storeCurrency}.`,
        guidance: "Fix the currency in the plugin that writes structured data, or in WooCommerce → Settings → General.",
        fix_url: page.url,
      }));
    }

    const expected = AVAILABILITY_MAP[(p.stock_status ?? "").trim()];
    const actual = schemaAvailability(schema.availability);
    if (expected && actual && actual.toLowerCase() !== expected.toLowerCase()) {
      findings.push(f("schema_availability_mismatch", {
        title: "Stock status on the page differs from the store",
        severity: "medium",
        basis: "observed",
        evidence: `Structured data says ${actual}; WooCommerce stock status is ${p.stock_status}.`,
        guidance: "Clear the page cache and check the plugin that writes structured data, then rescan.",
        fix_url: page.url,
      }));
    }
  }
  return findings;
}

// Product pages for the JSON-LD check, from the pages the access check loaded as a browser.
// A page closed to visitors (gate from the setting or the page) has no usable HTML.
export function schemaPagesFrom(samples: { url: string; product: WooProduct }[], accessPages: PageResult[]): SchemaPage[] {
  return samples.map((s) => {
    const page = accessPages.find((p) => p.url === s.url);
    const loaded = page?.browser;
    const gate = page?.gate ? { reason: page.gate } : loaded ? pageGate(loaded) : null;
    const usable = loaded?.ok && loaded.status >= 200 && loaded.status < 300 && !loaded.redirectedTo && !gate;
    let fetchError: string | undefined;
    if (!loaded) fetchError = "not loaded";
    else if (!loaded.ok) fetchError = loaded.error;
    else if (gate) fetchError = gate.reason;
    else if (loaded.redirectedTo) fetchError = `redirected to ${loaded.redirectedTo}`;
    else if (!usable) fetchError = `HTTP ${loaded.status}`;
    return {
      product: s.product,
      url: s.url,
      html: usable && loaded.ok ? loaded.body : null,
      seen: loaded ? describePage(loaded) : undefined,
      fetchError,
    };
  });
}
