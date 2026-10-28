// G1: the product feed for AI shopping agents, built only from the store's own WooCommerce data.
//
// JSON: the Agentic Commerce Protocol product feed (maintained by OpenAI and Stripe), released version 2026-04-17,
// file ingestion format: metadata.json (FeedMetadata) and products.jsonl (one Product per line, full replacement).
//   Schema: https://github.com/agentic-commerce-protocol/agentic-commerce-protocol/blob/main/spec/2026-04-17/json-schema/schema.feed.json
//   RFC:    https://github.com/agentic-commerce-protocol/agentic-commerce-protocol/blob/main/rfcs/rfc.product_feeds.md
//   OpenAI: https://developers.openai.com/commerce/
//   (copy of the schema in lib/specs/acp-2026-04-17, read 2026-10-28). ACP feeds are a push model: the merchant
//   uploads or pushes them to the agent; the URLs the plugin serves are what to submit. Nothing here says a feed
//   was accepted by anyone.
// CSV: the Google Merchant Center product fields that overlap (id, title, description, link, image_link,
//   additional_image_link, availability, price, sale_price, brand, gtin, mpn, item_group_id, product_type).
//   Fields: googleapis google/shopping/merchant/products/v1/products_common.proto (ProductAttributes);
//   https://support.google.com/merchants/answer/7052112
// A value the store does not have is left out, never filled in; the health page lists what is missing.
import Ajv2020 from "ajv/dist/2020";
import addFormats from "ajv-formats";
import { decodeEntities } from "./consistency";
import { isValidGtin } from "./feed";
import schema from "./specs/acp-2026-04-17/schema.feed.json";

export const FEED_SPEC = { name: "ACP product feed", version: "2026-04-17", url: "https://github.com/agentic-commerce-protocol/agentic-commerce-protocol/blob/main/spec/2026-04-17/json-schema/schema.feed.json" } as const;
export const FEED_PATHS = { jsonl: "/agentscope-feed/products.jsonl", metadata: "/agentscope-feed/metadata.json", csv: "/agentscope-feed.csv" } as const;
export const FEED_MAX_BYTES = 4 * 1024 * 1024; // one signed push to the plugin

// ISO 4217 minor units (digits after the decimal point) that are not 2. Every other code has 2.
const MINOR: Record<string, number> = { BIF: 0, CLP: 0, DJF: 0, GNF: 0, ISK: 0, JPY: 0, KMF: 0, KRW: 0, PYG: 0, RWF: 0, UGX: 0, UYI: 0, VND: 0, VUV: 0, XAF: 0, XOF: 0, XPF: 0, BHD: 3, IQD: 3, JOD: 3, KWD: 3, LYD: 3, OMR: 3, TND: 3, CLF: 4, UYW: 4 };
export const minorUnits = (currency: string) => MINOR[currency.toUpperCase()] ?? 2;

export type FeedImage = { id?: number; src: string; alt?: string | null };
export type FeedVariationIn = {
  id: number;
  status?: string;
  price: string | null;
  regular_price: string | null;
  sale_price: string | null;
  on_sale?: boolean;
  purchasable?: boolean;
  stock_status?: string | null;
  sku?: string | null;
  global_unique_id?: string | null;
  permalink?: string | null;
  image?: FeedImage | null;
  attributes?: { name: string; option: string }[];
};
export type FeedProductIn = {
  id: number;
  name: string;
  type: string;
  status?: string;
  catalog_visibility?: string;
  permalink?: string | null;
  description?: string | null;
  short_description?: string | null;
  price: string | null;
  regular_price: string | null;
  sale_price: string | null;
  on_sale?: boolean;
  purchasable?: boolean;
  stock_status?: string | null;
  sku?: string | null;
  global_unique_id?: string | null;
  images?: FeedImage[] | null;
  categories?: { id: number; name: string }[] | null;
  brands?: { id: number; name: string }[] | null;
  attributes?: { name: string; options?: string[] }[] | null;
};
export type FeedLink = { type: "privacy_policy" | "terms_of_service" | "refund_policy" | "shipping_policy"; title: string; url: string };
export type FeedInput = {
  feedId: string;
  storeUrl: string;
  siteName: string | null;
  currency: string | null;
  country: string | null;
  products: FeedProductIn[];
  variations: Record<number, FeedVariationIn[]>;
  categories: { id: number; name: string; parent: number }[];
  links: FeedLink[];
  now: Date;
};
export type FeedRow = { id: number; name: string; json: "included" | "excluded"; jsonReason: string | null; csv: "included" | "excluded"; csvMissing: string[]; variants: number; missing: string[] };
export type FeedResult = {
  metadata: { id: string; target_country?: string; updated_at: string };
  jsonl: string;
  csv: string;
  rows: FeedRow[];
  counts: { products: number; variants: number; excluded: number; csvRows: number; csvExcluded: number };
  bytes: number;
};

const plain = (html: string | null | undefined, max = 5000) => decodeEntities(String(html ?? "").replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ").replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ").trim().slice(0, max);
const httpsUrl = (u: string | null | undefined) => {
  try {
    const x = new URL(String(u ?? ""));
    return x.protocol === "https:" ? x.toString() : null;
  } catch {
    return null;
  }
};

// "800" or "799.9" in the store currency → ISO 4217 minor units, exactly (null when it would need rounding).
export function toMinor(price: string | null | undefined, currency: string): number | null {
  const s = String(price ?? "").trim();
  const m = /^(\d{1,12})(?:\.(\d+))?$/.exec(s);
  if (!m) return null;
  const digits = minorUnits(currency);
  const frac = (m[2] ?? "").replace(/0+$/, "");
  if (frac.length > digits) return null;
  return Number(m[1]) * 10 ** digits + Number(frac.padEnd(digits, "0") || "0");
}
const major = (minor: number, currency: string) => `${(minor / 10 ** minorUnits(currency)).toFixed(minorUnits(currency))} ${currency}`;

const STATUS: Record<string, string> = { instock: "in_stock", outofstock: "out_of_stock", onbackorder: "backorder" };

function categoryPaths(ids: { id: number; name: string }[], all: FeedInput["categories"]): string[] {
  const byId = new Map(all.map((c) => [c.id, c]));
  return ids.map((c) => {
    const names: string[] = [];
    let cur: FeedInput["categories"][number] | undefined = byId.get(c.id) ?? { id: c.id, name: c.name, parent: 0 };
    for (let i = 0; cur && i < 10; i++) {
      names.unshift(plain(cur.name, 200));
      cur = cur.parent ? byId.get(cur.parent) : undefined;
    }
    return names.filter(Boolean).join(" > ");
  }).filter(Boolean);
}

const attributeValue = (p: FeedProductIn, name: RegExp) => (p.attributes ?? []).find((a) => name.test(a.name.trim()))?.options?.find((o) => o.trim())?.trim() ?? null;

const ajv = new Ajv2020({ strict: false, allErrors: true });
addFormats(ajv);
ajv.addSchema(schema);
const validateProduct = ajv.getSchema(`${schema.$id}#/$defs/Product`)!;
const validateMetadata = ajv.getSchema(`${schema.$id}#/$defs/FeedMetadata`)!;
export const schemaErrors = (v: typeof validateProduct) => (v.errors ?? []).map((e) => `${e.instancePath || "/"} ${e.message}`).join("; ");
export { validateMetadata, validateProduct };

// RFC 4180: quote a field when it has a comma, a quote or a line break.
const csvField = (v: string) => (/[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
export const CSV_COLUMNS = ["id", "item_group_id", "title", "description", "link", "image_link", "additional_image_link", "availability", "price", "sale_price", "brand", "gtin", "mpn", "product_type"] as const;
const CSV_REQUIRED: (typeof CSV_COLUMNS)[number][] = ["title", "description", "link", "image_link", "availability", "price"];

export function buildFeed(input: FeedInput): FeedResult {
  const currency = input.currency && /^[A-Z]{3}$/.test(input.currency) ? input.currency : null;
  const seller = input.siteName?.trim() ? { name: plain(input.siteName, 200), ...(input.links.length ? { links: input.links.map((l) => ({ type: l.type, title: plain(l.title, 200), url: l.url })) } : {}) } : null;
  const lines: string[] = [];
  const csvRows: string[][] = [];
  const rows: FeedRow[] = [];

  for (const p of input.products) {
    const name = plain(p.name, 500);
    const row: FeedRow = { id: p.id, name: name || `#${p.id}`, json: "excluded", jsonReason: null, csv: "excluded", csvMissing: [], variants: 0, missing: [] };
    rows.push(row);
    const url = httpsUrl(p.permalink);
    if (p.status && p.status !== "publish") row.jsonReason = "not published";
    else if (p.catalog_visibility === "hidden") row.jsonReason = "hidden in the catalog (Catalog visibility: Hidden)";
    else if (p.type === "grouped") row.jsonReason = "grouped product: the products in it are listed one by one";
    else if (p.type === "external") row.jsonReason = "external / affiliate product: sold on another site";
    else if (!name) row.jsonReason = "no product name";
    else if (!url) row.jsonReason = "no public https page";
    if (row.jsonReason || !url) {
      row.csvMissing = [row.jsonReason ?? "no public https page"];
      continue;
    }

    const description = plain(p.description) || plain(p.short_description);
    const images = (p.images ?? []).map((i) => ({ ...i, src: httpsUrl(i.src) })).filter((i): i is FeedImage & { src: string } => Boolean(i.src));
    const brand = (p.brands ?? []).map((b) => plain(b.name, 200)).find(Boolean) ?? attributeValue(p, /^brand$/i);
    const mpn = attributeValue(p, /^mpn$/i);
    const paths = categoryPaths(p.categories ?? [], input.categories);
    const categories = paths.map((value) => ({ value, taxonomy: "merchant" }));
    if (!description) row.missing.push("description");
    if (!images.length) row.missing.push("image");
    if (!brand) row.missing.push("brand");
    if (!currency) row.missing.push("store currency");

    const units: { v: FeedProductIn | FeedVariationIn; id: number; title: string; url: string; options: { name: string; value: string }[]; image: (FeedImage & { src: string }) | null }[] = [];
    if (p.type === "variable") {
      for (const v of (input.variations[p.id] ?? []).filter((x) => (x.status ?? "publish") === "publish")) {
        const options = (v.attributes ?? []).filter((a) => a.option?.trim()).map((a) => ({ name: plain(a.name, 100), value: plain(a.option, 100) }));
        const vImage = v.image?.src && httpsUrl(v.image.src) ? { ...v.image, src: httpsUrl(v.image.src)! } : null;
        units.push({ v, id: v.id, title: options.length ? `${name} - ${options.map((o) => o.value).join(" / ")}` : name, url: httpsUrl(v.permalink) ?? url, options, image: vImage });
      }
      if (!units.length) {
        row.jsonReason = "variable product without published variations";
        row.csvMissing = [row.jsonReason];
        continue;
      }
    } else units.push({ v: p, id: p.id, title: name, url, options: [], image: null });

    const variants = units.map((u) => {
      const minor = currency ? toMinor(u.v.price, currency) : null;
      const regular = currency ? toMinor(u.v.regular_price, currency) : null;
      const gtin = (u.v.global_unique_id ?? "").replace(/\s/g, "");
      const status = STATUS[String(u.v.stock_status ?? "")];
      if (minor === null && !row.missing.includes("price")) row.missing.push("price");
      return {
        id: String(u.id),
        title: u.title,
        url: u.url,
        ...(gtin && isValidGtin(gtin) ? { barcodes: [{ type: "GTIN", value: gtin }] } : {}),
        ...(minor !== null ? { price: { amount: minor, currency: currency! } } : {}),
        ...(minor !== null && regular !== null && regular > minor ? { list_price: { amount: regular, currency: currency! } } : {}),
        ...(status ? { availability: { available: u.v.purchasable !== false && status !== "out_of_stock", status } } : {}),
        ...(categories.length ? { categories } : {}),
        ...(u.options.length ? { variant_options: u.options } : {}),
        ...(u.image ? { media: [{ type: "image", url: u.image.src, ...(u.image.alt?.trim() ? { alt_text: plain(u.image.alt, 300) } : {}) }] } : {}),
        ...(seller ? { seller } : {}),
      };
    });
    const product = {
      id: String(p.id),
      title: name,
      ...(description ? { description: { plain: description } } : {}),
      url,
      ...(images.length ? { media: images.map((i) => ({ type: "image", url: i.src, ...(i.alt?.trim() ? { alt_text: plain(i.alt, 300) } : {}) })) } : {}),
      variants,
    };
    if (!validateProduct(product)) {
      row.jsonReason = `does not match the feed schema: ${schemaErrors(validateProduct)}`.slice(0, 300);
      row.csvMissing = [row.jsonReason];
      continue;
    }
    lines.push(JSON.stringify(product));
    row.json = "included";
    row.variants = variants.length;

    // CSV: one row per variant; a row is left out when Google's required fields are missing.
    let csvIncluded = 0;
    units.forEach((u, i) => {
      const v = variants[i];
      const image = u.image?.src ?? images[0]?.src ?? "";
      const extra = images.filter((x) => x.src !== image).slice(0, 10).map((x) => x.src);
      const onSale = v.list_price && v.price ? `${major(v.price.amount, currency!)}` : "";
      const cells: Record<(typeof CSV_COLUMNS)[number], string> = {
        id: v.id,
        item_group_id: p.type === "variable" ? String(p.id) : "",
        title: u.title.slice(0, 150),
        description,
        link: u.url,
        image_link: image,
        additional_image_link: extra.join(","),
        availability: v.availability?.status === "out_of_stock" ? "out_of_stock" : v.availability?.status === "backorder" ? "backorder" : v.availability ? "in_stock" : "",
        price: v.list_price ? major(v.list_price.amount, currency!) : v.price ? major(v.price.amount, currency!) : "",
        sale_price: onSale,
        brand: brand ?? "",
        gtin: v.barcodes?.[0]?.value ?? "",
        mpn: mpn ?? "",
        product_type: paths[0] ?? "",
      };
      const missing = CSV_REQUIRED.filter((c) => !cells[c]);
      if (missing.length) {
        for (const m of missing) if (!row.csvMissing.includes(m)) row.csvMissing.push(m);
        return;
      }
      csvRows.push(CSV_COLUMNS.map((c) => csvField(cells[c])));
      csvIncluded++;
    });
    row.csv = csvIncluded ? "included" : "excluded";
  }

  const metadata = { id: input.feedId, ...(input.country && /^[A-Z]{2}$/.test(input.country) ? { target_country: input.country } : {}), updated_at: input.now.toISOString().replace(/\.\d{3}Z$/, "Z") };
  if (!validateMetadata(metadata)) throw new Error(`Feed metadata does not match the schema: ${schemaErrors(validateMetadata)}`);
  const jsonl = lines.length ? `${lines.join("\n")}\n` : "";
  const csv = `${[CSV_COLUMNS.join(","), ...csvRows.map((r) => r.join(","))].join("\r\n")}\r\n`;
  const bytes = Buffer.byteLength(jsonl) + Buffer.byteLength(csv) + Buffer.byteLength(JSON.stringify(metadata));
  return {
    metadata,
    jsonl,
    csv,
    rows,
    counts: { products: lines.length, variants: rows.reduce((n, r) => n + r.variants, 0), excluded: rows.filter((r) => r.json === "excluded").length, csvRows: csvRows.length, csvExcluded: rows.filter((r) => r.csv === "excluded").length },
    bytes,
  };
}

// Whether the store serves a product feed at the plugin's address (scan and fix verification). A feed counts
// when the address answers 200 with JSON lines that each hold a product id and its variants.
export function checkFeedServed(storeUrl: string, fetched: { ok: true; data: { status: number; text: string } } | { ok: false; reason: string }): import("./rules").Finding[] {
  const url = `${storeUrl}${FEED_PATHS.jsonl}`;
  if (!fetched.ok) return [{ finding_key: "feed:unavailable", type: "feed_check_unavailable", product_id: null, title: "Could not check the product feed", severity: "low", basis: "unavailable", evidence: `${url}: ${fetched.reason}`, guidance: "Open the address in a browser to check it.", fix_url: url }];
  const lines = fetched.data.status === 200 ? fetched.data.text.split("\n").filter((l) => l.trim()) : [];
  const valid = lines.length > 0 && lines.every((l) => {
    try {
      const p = JSON.parse(l) as { id?: unknown; variants?: unknown };
      return typeof p.id === "string" && Array.isArray(p.variants);
    } catch {
      return false;
    }
  });
  if (valid) return [];
  return [{
    finding_key: "feed:not_served",
    type: "feed_not_served",
    product_id: null,
    title: "No product feed for AI shopping agents",
    severity: "medium",
    basis: "observed",
    evidence: fetched.data.status === 200 ? `${url} answered HTTP 200, but not with product feed lines (JSON per line with id and variants).` : `${url} answered HTTP ${fetched.data.status}.`,
    guidance: `Auto-fix: the AgentScope plugin serves a feed built from your products (${FEED_SPEC.name} ${FEED_SPEC.version}, and a CSV with the Google Merchant fields), refreshed when a product changes and every day. Sending it to a shopping platform is your choice; AgentScope does not submit it, and no platform has approved it.`,
    fix_url: url,
  }];
}
