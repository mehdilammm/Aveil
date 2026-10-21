// WooCommerce Store API (public, no key): /wp-json/wc/store/v1/products?per_page=10, one request in the public check.
// Prices are strings in minor units (currency_minor_unit decimals): "2500" with 2 → 25.00.
import type { Finding } from "./rules";
import { plainText } from "./rules";

export const STORE_API_PATH = "/wp-json/wc/store/v1/products?per_page=10";
export const STORE_API_NOTE = "Checked the first 10 products from the public WooCommerce Store API.";

type Prices = { price?: string; regular_price?: string; sale_price?: string; currency_code?: string; currency_minor_unit?: number };
type StoreProduct = {
  id: number;
  name: string;
  permalink?: string;
  short_description?: string;
  description?: string;
  on_sale?: boolean;
  prices?: Prices;
  images?: unknown[];
  is_in_stock?: boolean;
  is_purchasable?: boolean;
};

export type StoreApiResult =
  | { status: "ok"; checked: number; findings: Finding[]; permalinks: string[]; prices: Map<string, number> }
  | { status: "unavailable"; reason: string };

export function minorToMajor(value: string | undefined, minorUnit = 2): number | null {
  if (value === undefined || value === null || String(value).trim() === "" || !/^-?\d+$/.test(String(value).trim())) return null;
  return Number(value) / 10 ** minorUnit;
}

export function pathOf(url: string): string | null {
  try {
    return new URL(url).pathname.replace(/\/+$/, "") || "/";
  } catch {
    return null;
  }
}

export function checkStoreApiProducts(body: string): StoreApiResult {
  let data: unknown;
  try {
    data = JSON.parse(body);
  } catch {
    return { status: "unavailable", reason: "the Store API did not answer with JSON" };
  }
  if (!Array.isArray(data)) return { status: "unavailable", reason: "the answer is not a Store API product list" };

  const products = (data as StoreProduct[]).filter((p) => p && typeof p.id === "number" && typeof p.name === "string").slice(0, 10);
  const findings: Finding[] = [];
  const prices = new Map<string, number>();
  for (const p of products) {
    const minor = p.prices?.currency_minor_unit ?? 2;
    const price = minorToMajor(p.prices?.price, minor);
    const regular = minorToMajor(p.prices?.regular_price, minor);
    const sale = minorToMajor(p.prices?.sale_price, minor);
    const cur = p.prices?.currency_code ?? "";
    const path = p.permalink ? pathOf(p.permalink) : null;
    if (path && price !== null) prices.set(path, price);
    const add = (rule: string, x: Omit<Finding, "finding_key" | "type" | "product_id" | "fix_url">) =>
      findings.push({ finding_key: `wcstore:${rule}:${p.id}`, type: `wcstore_${rule}`, product_id: p.id, fix_url: p.permalink ?? null, ...x });
    const where = `WooCommerce → Products → "${p.name}"`;

    if (price === null || price === 0) {
      add("price_zero", {
        title: `"${p.name}": price missing or 0, may be intentional`,
        severity: "medium",
        basis: "observed",
        evidence: price === null ? "The Store API shows no price." : `The Store API shows a price of 0 ${cur}.`.trim(),
        guidance: `If it is not free on purpose, set the regular price in ${where} → General (or on each variation).`,
      });
    }
    if (p.on_sale && sale !== null && regular !== null && regular > 0 && sale >= regular) {
      add("sale_not_lower", {
        title: `"${p.name}": sale price is not lower than the regular price`,
        severity: "medium",
        basis: "observed",
        evidence: `Regular price ${regular} ${cur}, sale price ${sale} ${cur}.`.replace(/\s+\./g, "."),
        guidance: `Make the sale price lower than the regular price, or clear it, in ${where} → General.`,
      });
    }
    if (!Array.isArray(p.images) || p.images.length === 0) {
      add("no_images", { title: `"${p.name}": no images`, severity: "medium", basis: "observed", evidence: "The product has no images.", guidance: `Set a product image in ${where} (Product image, in the sidebar).` });
    }
    const text = plainText(p.short_description || p.description || "");
    if (text.length < 80) {
      add("short_description", {
        title: `"${p.name}": short description`,
        severity: "low",
        basis: "heuristic",
        evidence: `The short description has ${text.length} characters of text (under 80).`,
        guidance: `Describe what it is, materials, sizes and use in ${where} → Product short description.`,
      });
    }
  }
  return { status: "ok", checked: products.length, findings, permalinks: products.map((p) => p.permalink).filter((u): u is string => !!u), prices };
}
