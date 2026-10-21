// ChatGPT product feed readiness: compares WooCommerce product data with the fields of
// OpenAI's product feed (Agentic Commerce), file-upload format.
// Spec: https://developers.openai.com/commerce/specs/file-upload/products
// Required there: item_id, title, description, url, brand, seller_name, image_url, availability, price ("79.99 USD").
// item_id maps to the WooCommerce product id (always present). image_url and price are already covered by
// the product rules (image_missing and the price_* findings), so they are not repeated here.
import type { Source } from "./pages";
import { plainText, type Finding, type WooProduct } from "./rules";

export const FEED_SPEC_URL = "https://developers.openai.com/commerce/specs/file-upload/products";

// WooCommerce stock_status → feed availability (spec values: in_stock, out_of_stock, pre_order, backorder, unknown).
const AVAILABILITY: Record<string, string> = { instock: "in_stock", outofstock: "out_of_stock", onbackorder: "backorder" };

const SPEC_NOTE = `See the OpenAI product feed spec: ${FEED_SPEC_URL}`;

// GS1 check digit for GTIN-8/12/13/14.
export function isValidGtin(value: string): boolean {
  if (!/^(\d{8}|\d{12}|\d{13}|\d{14})$/.test(value)) return false;
  const digits = value.split("").map(Number);
  const check = digits.pop()!;
  const sum = digits.reverse().reduce((acc, d, i) => acc + d * (i % 2 === 0 ? 3 : 1), 0);
  return (10 - (sum % 10)) % 10 === check;
}

function attribute(product: WooProduct, name: RegExp): string | null {
  const attr = (product.attributes ?? []).find((a) => name.test(a.name.trim()));
  const value = attr?.options?.find((o) => o.trim() !== "");
  return value?.trim() ?? null;
}

function feedFinding(product: WooProduct, type: string, f: Omit<Finding, "finding_key" | "type" | "product_id">): Finding {
  return { finding_key: `${type}:${product.id}`, type, product_id: product.id, ...f };
}

export function checkFeedProduct(product: WooProduct): Finding[] {
  const findings: Finding[] = [];

  if (!(product.name ?? "").trim()) {
    findings.push(feedFinding(product, "feed_title_missing", {
      title: "Feed: title missing",
      severity: "high",
      basis: "observed",
      evidence: "The product has no name.",
      guidance: `Give the product a clear name. title is required in the ChatGPT product feed. ${SPEC_NOTE}`,
    }));
  }

  if (!plainText(product.description ?? null) && !plainText(product.short_description ?? null)) {
    findings.push(feedFinding(product, "feed_description_missing", {
      title: "Feed: description missing",
      severity: "high",
      basis: "observed",
      evidence: "Both the description and the short description are empty.",
      guidance: `Write a plain-text description. description is required in the ChatGPT product feed. ${SPEC_NOTE}`,
    }));
  }

  const url = (product.permalink ?? "").trim();
  if (!/^https?:\/\//i.test(url)) {
    findings.push(feedFinding(product, "feed_url_missing", {
      title: "Feed: product URL missing",
      severity: "high",
      basis: "observed",
      evidence: url ? `The product link "${url}" is not a full URL.` : "The API returned no public link for this product.",
      guidance: `Make sure the product is published and has a public page. url is required in the ChatGPT product feed. ${SPEC_NOTE}`,
    }));
  }

  const brandNames = (product.brands ?? []).map((b) => b.name.trim()).filter(Boolean);
  const brandAttr = attribute(product, /^brand$/i);
  if (brandNames.length === 0 && !brandAttr) {
    const brandsReadable = Array.isArray(product.brands);
    findings.push(feedFinding(product, "feed_brand_missing", {
      title: "Feed: brand missing",
      severity: "high",
      basis: brandsReadable ? "observed" : "heuristic",
      evidence: brandsReadable
        ? "No WooCommerce brand and no \"Brand\" attribute on this product."
        : "This WooCommerce version does not return brands; no \"Brand\" attribute was found either.",
      guidance: `Assign a brand (Products → Brands) or add a "Brand" attribute. brand is required in the ChatGPT product feed and must be a real name, not a placeholder. ${SPEC_NOTE}`,
    }));
  }

  const status = (product.stock_status ?? "").trim();
  if (status && !AVAILABILITY[status]) {
    findings.push(feedFinding(product, "feed_availability_unmapped", {
      title: "Feed: stock status has no feed equivalent",
      severity: "medium",
      basis: "observed",
      evidence: `Stock status is "${status}", which does not map to in_stock, out_of_stock or backorder.`,
      guidance: `Use In stock, Out of stock or On backorder. availability is required in the ChatGPT product feed. ${SPEC_NOTE}`,
    }));
  }

  const gtinReadable = typeof product.global_unique_id === "string";
  const gtin = (product.global_unique_id ?? "").trim();
  const mpn = attribute(product, /^mpn$/i);
  if (gtin && !isValidGtin(gtin)) {
    findings.push(feedFinding(product, "feed_gtin_invalid", {
      title: "Feed: GTIN is not valid",
      severity: "high",
      basis: "observed",
      evidence: `GTIN "${gtin}" must be 8, 12, 13 or 14 digits with a valid check digit.`,
      guidance: `Fix the GTIN, UPC, EAN or ISBN field in the Inventory tab, or clear it. ${SPEC_NOTE}`,
    }));
  } else if (!gtin && !mpn) {
    findings.push(feedFinding(product, "feed_identifier_missing", {
      title: "Feed: no GTIN or MPN",
      severity: "low",
      basis: gtinReadable ? "observed" : "heuristic",
      evidence: gtinReadable
        ? "The GTIN field is empty and there is no \"MPN\" attribute."
        : "This WooCommerce version does not return a GTIN field; no \"MPN\" attribute was found.",
      guidance: `Optional, but helps ChatGPT match the product. Add the barcode (GTIN/EAN/UPC) in the Inventory tab, or an "MPN" attribute from the manufacturer. Do not invent one. ${SPEC_NOTE}`,
    }));
  }

  return findings;
}

export type FeedStoreInput = {
  storeUrl: string;
  siteName: Source<string>;
  // WooCommerce general settings (woocommerce_currency).
  settings: Source<Record<string, string>>;
};

// Store-level feed fields: seller_name and the currency used in "79.99 USD" prices.
export function checkFeedStore({ storeUrl, siteName, settings }: FeedStoreInput): Finding[] {
  const findings: Finding[] = [];
  const store = (type: string, f: Omit<Finding, "finding_key" | "type" | "product_id">): Finding => ({ finding_key: `${type}:store`, type, product_id: null, ...f });

  if (!siteName.ok) {
    findings.push(store("feed_seller_name_unavailable", {
      title: "Feed: could not read the store name",
      severity: "low",
      basis: "unavailable",
      evidence: siteName.reason,
      guidance: `seller_name is required in the ChatGPT product feed. Check Settings → General → Site Title by hand. ${SPEC_NOTE}`,
      fix_url: `${storeUrl}/wp-admin/options-general.php`,
    }));
  } else if (!siteName.data.trim()) {
    findings.push(store("feed_seller_name_missing", {
      title: "Feed: store name missing",
      severity: "high",
      basis: "observed",
      evidence: "The site title is empty.",
      guidance: `Set Settings → General → Site Title to the real store name. seller_name is required in the ChatGPT product feed. ${SPEC_NOTE}`,
      fix_url: `${storeUrl}/wp-admin/options-general.php`,
    }));
  }

  const currencyUrl = `${storeUrl}/wp-admin/admin.php?page=wc-settings&tab=general`;
  if (!settings.ok) {
    findings.push(store("feed_currency_unavailable", {
      title: "Feed: could not read the store currency",
      severity: "low",
      basis: "unavailable",
      evidence: settings.reason,
      guidance: `Feed prices need a currency code, for example "79.99 USD". Check WooCommerce → Settings → General by hand. ${SPEC_NOTE}`,
      fix_url: currencyUrl,
    }));
  } else if (!/^[A-Z]{3}$/.test((settings.data.woocommerce_currency ?? "").trim())) {
    findings.push(store("feed_currency_missing", {
      title: "Feed: store currency not set",
      severity: "high",
      basis: "observed",
      evidence: `woocommerce_currency is "${settings.data.woocommerce_currency ?? ""}", not a 3-letter currency code.`,
      guidance: `Choose the store currency in WooCommerce → Settings → General. ${SPEC_NOTE}`,
      fix_url: currencyUrl,
    }));
  }
  return findings;
}
