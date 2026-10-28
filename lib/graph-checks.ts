// Milestone G (G2, G3, G5, G6, G7): what the store's pages already say in JSON-LD, whatever printed it (WooCommerce,
// an SEO plugin, the theme, AgentScope). A part that no source prints is a finding with its fix; a part another
// source prints is left alone (never a duplicate). Observed: read from the page as a browser gets it.
import type { Finding } from "./rules";
import { ancestors } from "./schema-vocab";

type Node = Record<string, unknown>;

// Every JSON-LD node of a page: top-level nodes and @graph members, with their nested nodes.
export function jsonLdNodes(html: string): Node[] {
  const out: Node[] = [];
  const walk = (v: unknown) => {
    if (Array.isArray(v)) return v.forEach(walk);
    if (!v || typeof v !== "object") return;
    const n = v as Node;
    if (n["@type"]) out.push(n);
    for (const [k, x] of Object.entries(n)) if (k !== "@context" && typeof x === "object") walk(x);
  };
  for (const m of html.matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      walk(JSON.parse(m[1].trim()));
    } catch {
      // a broken block is reported by the structured-data check
    }
  }
  return out;
}

const types = (n: Node) => (Array.isArray(n["@type"]) ? (n["@type"] as unknown[]) : [n["@type"]]).map((t) => String(t).replace(/^https?:\/\/schema\.org\//, ""));
const isType = (n: Node, target: string) => types(n).some((t) => ancestors(t).has(target));
const offersOf = (product: Node): Node[] => {
  const o = product.offers;
  return (Array.isArray(o) ? o : o ? [o] : []).filter((x): x is Node => Boolean(x) && typeof x === "object");
};

export type GraphPage = { url: string; html: string | null };
export type GraphInput = {
  storeUrl: string;
  home: GraphPage | null;
  product: (GraphPage & { id: number; needsShipping: boolean }) | null;
  variable: (GraphPage & { id: number; variations: number }) | null;
  // Active SEO plugins that print their own Organization, WebSite and BreadcrumbList (Yoast SEO, Rank Math).
  seoPlugin: string | null;
};

const f = (key: string, type: string, product_id: number | null, title: string, evidence: string, guidance: string, url: string, severity: Finding["severity"] = "medium"): Finding => ({ finding_key: key, type, product_id, title, severity, basis: "observed", evidence, guidance, fix_url: url });

export function graphFindings(i: GraphInput): Finding[] {
  const out: Finding[] = [];
  const seo = i.seoPlugin ? ` ${i.seoPlugin} is active and prints its own; turn it on in its settings rather than adding a second one.` : "";
  const seoNote = i.seoPlugin ? ` (seo plugin: ${i.seoPlugin})` : "";
  if (i.home?.html) {
    const nodes = jsonLdNodes(i.home.html);
    if (!nodes.some((n) => isType(n, "Organization"))) {
      out.push(f("jsonld:org", "jsonld_org_missing", null, "No Organization in the home page's structured data", `${i.home.url}: ${nodes.length ? `JSON-LD types ${[...new Set(nodes.flatMap(types))].join(", ")}, no Organization` : "no JSON-LD at all"}.${seoNote}`, `Auto-fix: the AgentScope plugin adds an OnlineStore node with your site's name, address and logo, and only the phone, email and profile links published on your site.${seo}`, i.home.url));
    }
    if (!nodes.some((n) => isType(n, "WebSite"))) {
      out.push(f("jsonld:website", "jsonld_website_missing", null, "No WebSite in the home page's structured data", `${i.home.url}: no WebSite node.${seoNote}`, `Auto-fix: the plugin adds a WebSite node; a search box only when your store's search address answers with products.${seo}`, i.home.url, "low"));
    }
  }
  if (i.product?.html) {
    const nodes = jsonLdNodes(i.product.html);
    const product = nodes.find((n) => isType(n, "Product"));
    if (!nodes.some((n) => isType(n, "BreadcrumbList"))) {
      out.push(f("jsonld:breadcrumbs", "jsonld_breadcrumb_missing", null, "No BreadcrumbList on product pages", `${i.product.url}: no BreadcrumbList node.${seoNote}`, `Auto-fix: the plugin adds a BreadcrumbList from each product's real category path.${seo}`, i.product.url, "low"));
    }
    const offers = product ? offersOf(product) : [];
    if (product && i.product.needsShipping && offers.length && !offers.some((o) => o.shippingDetails)) {
      out.push(f("jsonld:shipping", "jsonld_shipping_missing", null, "Product offers have no shipping details", `${i.product.url}: the Product's offers have no shippingDetails.`, "Auto-fix: the plugin adds the rates of your WooCommerce shipping zones that can be written exactly; delivery times only when you give them.", i.product.url));
    }
    const policy = offers.some((o) => o.hasMerchantReturnPolicy) || Boolean(product?.hasMerchantReturnPolicy) || nodes.some((n) => isType(n, "Organization") && n.hasMerchantReturnPolicy);
    if (product && offers.length && !policy) {
      out.push(f("jsonld:returns", "jsonld_returns_missing", null, "No return policy in the structured data", `${i.product.url}: no hasMerchantReturnPolicy on the Product, its offers or the Organization.`, "One click: AgentScope reads your returns page and WooCommerce settings, shows the exact text it used, and adds the policy to all products after you confirm. When the page is unclear it asks you.", i.product.url));
    }
  }
  if (i.variable?.html && i.variable.variations > 1) {
    const product = jsonLdNodes(i.variable.html).find((n) => isType(n, "Product"));
    const offers = product ? offersOf(product) : [];
    const perVariation = product && (Array.isArray(product.hasVariant) || offers.length > 1 || offers.some((o) => Array.isArray(o.offers) && (o.offers as unknown[]).length > 1));
    if (product && !perVariation) {
      out.push(f(`jsonld:variants:${i.variable.id}`, "jsonld_variants_missing", i.variable.id, "Variations are not in the structured data", `${i.variable.url}: ${i.variable.variations} variations, the Product has ${offers.length} offer${offers.length === 1 ? "" : "s"}${offers[0]?.["@type"] ? ` (${types(offers[0]).join("/")})` : ""} and no per-variation offer.`, "Auto-fix: the plugin adds one Offer per variation (price, stock, SKU and GTIN when set) inside the product's AggregateOffer, on the same Product.", i.variable.url, "low"));
    }
  }
  return out;
}
