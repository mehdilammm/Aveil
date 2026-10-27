// Cross-source consistency (F4): the same product as WooCommerce stores it (the reference), as the product page
// shows it, as its JSON-LD describes it, as the Store API returns it (what agents that buy through WooCommerce
// read) and as llms.txt lists it. A difference is a finding naming both sources and both values [Observed].
// JSON-LD price, currency and stock are already compared by the structured-data check, so only its name is here.
import type { Finding } from "./rules";
import type { SchemaProduct } from "./structured-data";
import { minorToMajor } from "./woo-store-api";

export type StoreApiItem = { id: number; name?: string; is_in_stock?: boolean; prices?: { price?: string; currency_code?: string; currency_minor_unit?: number } };
export type ConsistencyProduct = { id: number; name: string; type: string; price: string | null; stock_status: string | null; url: string };
export type ConsistencyInput = {
  product: ConsistencyProduct;
  html: string | null;
  schema: SchemaProduct | null;
  storeApi: StoreApiItem | null;
  llmsPrice: number | null;
};
export type StoreFormat = { currency: string | null; decimalSep: string; thousandSep: string; taxes: boolean };

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", ndash: "–", mdash: "—", rsquo: "’", lsquo: "‘", rdquo: "”", ldquo: "“", times: "×" };
export function decodeEntities(s: string): string {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&([a-z]+);/gi, (m, n) => ENTITIES[n.toLowerCase()] ?? m);
}
const textOf = (html: string) => decodeEntities(html.replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ").trim();
export const sameName = (a: string, b: string) => textOf(a).toLowerCase() === textOf(b).toLowerCase();

// A shown amount ("د.م.1,200.00", "1.200,00 €") as a number, with the store's separators.
export function parseAmount(text: string, decimalSep: string, thousandSep: string): number | null {
  const digits = text.replace(/[^\d.,\s '’]/g, "").trim();
  const m = /\d[\d.,\s '’]*/.exec(digits);
  if (!m) return null;
  let s = m[0].replace(/[\s '’]/g, "");
  if (thousandSep && thousandSep !== decimalSep) s = s.split(thousandSep).join("");
  if (decimalSep && decimalSep !== ".") s = s.replace(decimalSep, ".");
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

// What a buyer sees on the product page: the product title, and the main price (a sale price when there is one).
// Classic templates (<h1 class="product_title">, <p class="price">) and block themes (post-title, product-price).
export function visibleProduct(html: string, f: Pick<StoreFormat, "decimalSep" | "thousandSep">): { name: string | null; price: number | null } {
  const body = html.slice(Math.max(0, html.search(/<body[\s>]/i)));
  const h1 = /<h1[^>]*class=["'][^"']*(?:product_title|wp-block-post-title)[^"']*["'][^>]*>([\s\S]*?)<\/h1>/i.exec(body);
  const start = body.search(/class=["'](?:wp-block-woocommerce-product-price|price)["']/i);
  let price: number | null = null;
  if (start >= 0) {
    const seg = body.slice(start, start + 2000);
    const ins = /<ins[^>]*>([\s\S]*?)<\/ins>/i.exec(seg);
    const src = ins ? ins[1] : seg;
    const at = src.search(/woocommerce-Price-amount/i);
    if (at >= 0) {
      // The amount span's own text, without its currency symbol span: up to the span that closes it.
      const rest = src.slice(src.indexOf(">", at) + 1, at + 600).replace(/<span[^>]*woocommerce-Price-currencySymbol[^>]*>[\s\S]*?<\/span>/gi, "");
      price = parseAmount(textOf(rest.slice(0, rest.search(/<\/span>/i) >= 0 ? rest.search(/<\/span>/i) : rest.length)), f.decimalSep, f.thousandSep);
    }
  }
  return { name: h1 ? textOf(h1[1]) || null : null, price };
}

// The price llms.txt lists for a product URL ("- [Name](url): 800 MAD, Category"), or null.
export function llmsPriceFor(llms: string, url: string): number | null {
  const line = llms.split(/\r?\n/).find((l) => l.includes(`](${url})`) || l.includes(`(${url.replace(/\/$/, "")})`));
  if (!line) return null;
  const after = line.slice(line.indexOf(")") + 1);
  const m = /(\d+(?:[.,]\d+)?)/.exec(after.replace(/,(?=\d{3}\b)/g, ""));
  return m ? Number(m[1].replace(",", ".")) : null;
}

const money = (n: number, currency: string | null) => `${Number.isInteger(n) ? n : n.toFixed(2)}${currency ? ` ${currency}` : ""}`;
const SOURCE = { page: "on the product page", jsonld: "in the JSON-LD", store_api: "in the Store API", llms: "in llms.txt" } as const;
type Source = keyof typeof SOURCE;
const GUIDANCE: Record<Source, string> = {
  page: "The page shows what the theme, a plugin or a cache prints. Clear the page cache and the CDN cache, then rescan. If it stays, a pricing, currency or theme setting changes what is shown.",
  jsonld: "The structured data comes from WooCommerce or an SEO plugin. Clear the page cache, then check that plugin's product settings, and rescan.",
  store_api: "The Store API is what agents that buy through WooCommerce read. A pricing, currency or stock plugin may change it; check those plugins, then rescan.",
  llms: "llms.txt is a static list. Generate it again from the store data (Fix generators → llms.txt); when the AgentScope plugin serves it, auto-fix updates it.",
};

export function consistencyFindings(items: ConsistencyInput[], f: StoreFormat): Finding[] {
  const out: Finding[] = [];
  for (const it of items) {
    const p = it.product;
    const add = (field: "name" | "price" | "stock" | "currency", source: Source, ours: string, theirs: string, severity: Finding["severity"], heuristic = false) =>
      out.push({
        finding_key: `consistency:${field}:${source}:${p.id}`,
        type: source === "llms" ? "consistency_llms_mismatch" : `consistency_${field}_mismatch`,
        product_id: p.id,
        title: `${field === "name" ? "Name" : field === "price" ? "Price" : field === "stock" ? "Stock" : "Currency"} differs between WooCommerce and ${source === "page" ? "the product page" : source === "jsonld" ? "the JSON-LD" : source === "store_api" ? "the Store API" : "llms.txt"}`,
        severity,
        basis: heuristic ? "heuristic" : "observed",
        evidence: `${field === "name" ? "Name" : field === "price" ? "Price" : field === "stock" ? "Stock" : "Currency"} is ${ours} in WooCommerce but ${theirs} ${SOURCE[source]} (${p.url}).${heuristic ? " Taxes are on in this store, so a shown price can include tax; check before changing anything." : ""}`.slice(0, 1000),
        guidance: GUIDANCE[source],
        fix_url: p.url,
      });

    const wooPrice = p.price !== null && p.price.trim() !== "" && Number.isFinite(Number(p.price)) ? Number(p.price) : null;
    const comparePrice = wooPrice !== null && p.type === "simple"; // variable / grouped products show a range
    const differs = (a: number, b: number) => Math.abs(a - b) > 0.005;

    if (it.html) {
      const v = visibleProduct(it.html, f);
      if (v.name && !sameName(v.name, p.name)) add("name", "page", `"${textOf(p.name)}"`, `"${v.name}"`, "medium");
      if (comparePrice && v.price !== null && differs(v.price, wooPrice!)) add("price", "page", money(wooPrice!, f.currency), money(v.price, f.currency), "high", f.taxes);
    }
    if (it.schema?.name && !sameName(it.schema.name, p.name)) add("name", "jsonld", `"${textOf(p.name)}"`, `"${textOf(it.schema.name)}"`, "medium");
    const s = it.storeApi;
    if (s) {
      if (s.name && !sameName(s.name, p.name)) add("name", "store_api", `"${textOf(p.name)}"`, `"${textOf(s.name)}"`, "medium");
      const minor = s.prices?.currency_minor_unit ?? 2;
      const apiPrice = minorToMajor(s.prices?.price, minor);
      if (comparePrice && apiPrice !== null && differs(apiPrice, wooPrice!)) add("price", "store_api", money(wooPrice!, f.currency), money(apiPrice, s.prices?.currency_code ?? f.currency), "high", f.taxes);
      const code = s.prices?.currency_code;
      if (code && f.currency && code.toUpperCase() !== f.currency.toUpperCase()) add("currency", "store_api", f.currency, code, "high");
      if (typeof s.is_in_stock === "boolean" && p.stock_status) {
        const wooIn = p.stock_status !== "outofstock";
        if (wooIn !== s.is_in_stock) add("stock", "store_api", wooIn ? "in stock" : "out of stock", s.is_in_stock ? "in stock" : "out of stock", "high");
      }
    }
    if (comparePrice && it.llmsPrice !== null && differs(it.llmsPrice, wooPrice!)) add("price", "llms", money(wooPrice!, f.currency), money(it.llmsPrice, f.currency), "medium");
  }
  return out;
}
