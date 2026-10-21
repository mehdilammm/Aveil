// JSON-LD Product checks on product pages, compared with the WooCommerce API data.
import type { PageResult } from "./access";
import { describePage, pageGate } from "./gate";
import type { Finding, WooProduct } from "./rules";

type Json = unknown;
export type SchemaProduct = {
  name: string | null;
  image: boolean;
  price: string | null;
  currency: string | null;
  availability: string | null;
};

const LD_RE = /<script[^>]*type\s*=\s*["']?application\/ld\+json["']?[^>]*>([\s\S]*?)<\/script>/gi;

function isProduct(node: Record<string, Json>): boolean {
  const t = node["@type"];
  const types = Array.isArray(t) ? t : [t];
  return types.some((x) => x === "Product" || x === "ProductGroup");
}

function str(v: Json): string | null {
  if (typeof v === "string" && v.trim()) return v.trim();
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  return null;
}

function walk(node: Json, out: Record<string, Json>[]) {
  if (Array.isArray(node)) return node.forEach((n) => walk(n, out));
  if (!node || typeof node !== "object") return;
  const obj = node as Record<string, Json>;
  if (isProduct(obj)) out.push(obj);
  for (const [k, v] of Object.entries(obj)) if (k === "@graph" || (typeof v === "object" && k !== "offers")) walk(v, out);
}

function first<T>(v: T | T[] | undefined | null): T | undefined {
  return Array.isArray(v) ? v[0] : (v ?? undefined);
}

function readOffer(offers: Json): Pick<SchemaProduct, "price" | "currency" | "availability"> {
  const offer = first(offers as Json[] | Json) as Record<string, Json> | undefined;
  if (!offer || typeof offer !== "object") return { price: null, currency: null, availability: null };
  const spec = first(offer.priceSpecification as Json[] | Json) as Record<string, Json> | undefined;
  return {
    price: str(offer.price) ?? str(offer.lowPrice) ?? str(spec?.price) ?? str(spec?.minPrice),
    currency: str(offer.priceCurrency) ?? str(spec?.priceCurrency),
    availability: str(offer.availability),
  };
}

// Product nodes found in the page, and how many JSON-LD blocks were not valid JSON.
export function extractSchemaProducts(html: string): { products: SchemaProduct[]; invalidBlocks: number } {
  const nodes: Record<string, Json>[] = [];
  let invalidBlocks = 0;
  for (const m of html.matchAll(LD_RE)) {
    try {
      walk(JSON.parse(m[1].trim()), nodes);
    } catch {
      invalidBlocks++;
    }
  }
  const products = nodes.map((n) => {
    const image = n.image;
    return {
      name: str(n.name),
      image: Boolean(str(image) ?? str((first(image as Json[]) as Record<string, Json> | undefined)?.url) ?? str(first(image as Json[]))),
      ...readOffer(n.offers),
    };
  });
  return { products, invalidBlocks };
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
