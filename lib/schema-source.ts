// Who writes the JSON-LD on a product page, and the @id of its Product node, so later fixes extend that graph
// instead of adding a second Product. Read from the script tags themselves:
// - Yoast SEO: <script type="application/ld+json" class="yoast-schema-graph">
// - Rank Math: <script type="application/ld+json" class="rank-math-schema"> (or rank-math-schema-pro)
// - WooCommerce core: a plain script in the footer whose Product @id is the permalink + "#product"
//   (WC_Structured_Data, checked in WooCommerce 11.2.1)
// - anything else: theme or another plugin.
export type SchemaSource = "woocommerce" | "yoast" | "rank_math" | "theme_or_other";
export type ProductNode = { source: SchemaSource; id: string | null; type: string };
export type SchemaSources = { blocks: { source: SchemaSource; invalid: boolean }[]; products: ProductNode[]; primary: ProductNode | null; duplicate: boolean };

const SCRIPT_RE = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
const isLd = (attrs: string) => /type\s*=\s*["']?application\/ld\+json/i.test(attrs);
const classOf = (attrs: string) => /class\s*=\s*["']([^"']*)["']/i.exec(attrs)?.[1] ?? "";

type Node = Record<string, unknown>;
const typesOf = (n: Node) => (Array.isArray(n["@type"]) ? n["@type"] : [n["@type"]]).filter((t): t is string => typeof t === "string").map((t) => t.replace(/^https?:\/\/schema\.org\//, ""));

// Page-level Product / ProductGroup nodes (not variants, not items of a list).
function products(node: unknown, out: Node[]) {
  if (Array.isArray(node)) return node.forEach((n) => products(n, out));
  if (!node || typeof node !== "object") return;
  const n = node as Node;
  const t = typesOf(n);
  if (t.includes("Product") || t.includes("ProductGroup")) return void out.push(n);
  if (t.includes("ItemList")) return;
  for (const [k, v] of Object.entries(n)) if (!["hasVariant", "isVariantOf", "offers", "itemListElement"].includes(k)) products(v, out);
}

export function detectSchemaSources(html: string, pageUrl: string): SchemaSources {
  const blocks: SchemaSources["blocks"] = [];
  const found: ProductNode[] = [];
  const page = pageUrl.replace(/[#?].*$/, "");
  for (const m of html.matchAll(SCRIPT_RE)) {
    if (!isLd(m[1])) continue;
    const cls = classOf(m[1]).toLowerCase();
    let data: unknown;
    try {
      data = JSON.parse(m[2].trim());
    } catch {
      blocks.push({ source: cls.includes("yoast") ? "yoast" : cls.includes("rank-math") ? "rank_math" : "theme_or_other", invalid: true });
      continue;
    }
    const nodes: Node[] = [];
    products(data, nodes);
    let source: SchemaSource = cls.includes("yoast-schema-graph") ? "yoast" : cls.includes("rank-math-schema") ? "rank_math" : "theme_or_other";
    if (source === "theme_or_other" && !cls && nodes.some((n) => typeof n["@id"] === "string" && (n["@id"] as string).replace(/#product$/, "") === page && (n["@id"] as string).endsWith("#product"))) {
      source = "woocommerce";
    }
    blocks.push({ source, invalid: false });
    for (const n of nodes) found.push({ source, id: typeof n["@id"] === "string" ? (n["@id"] as string) : null, type: typesOf(n).includes("ProductGroup") ? "ProductGroup" : "Product" });
  }
  // Two Product nodes that are not the same @id: agents can read two different products on one page.
  const ids = new Set(found.map((p) => p.id ?? `anon:${p.source}`));
  return { blocks, products: found, primary: found[0] ?? null, duplicate: ids.size > 1 };
}

export const SOURCE_LABEL: Record<SchemaSource, string> = { woocommerce: "WooCommerce", yoast: "Yoast SEO", rank_math: "Rank Math", theme_or_other: "Theme or another plugin" };
