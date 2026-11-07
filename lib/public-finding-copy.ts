// Which catalog entry (messages: checkFindings.<id>.title / .fix) shows a /check finding in the visitor's language.
// Built from the stored finding_key and type, so reports saved before translation are shown translated too; the
// few values a sentence needs (a bot, a product name, a protection vendor) come from the key or the stored title.
// Evidence stays as measured (URLs, HTTP answers, quotes). Unknown ids fall back to the stored English text. Pure.
type Stored = { finding_key: string; type: string; title: string; guidance: string };
export type FindingCopy = { id: string; values: Record<string, string> };

const KEYED: Record<string, string> = {
  "robots:unavailable": "robots_unavailable",
  "robots:server_error": "robots_server_error",
  "robots:no_sitemap": "robots_no_sitemap",
  "llms_txt:missing": "llms_txt_missing",
  "agentscope:blocked": "agentscope_blocked",
  "protection:unavailable": "protection_unavailable",
  "platform:shopify": "platform_shopify",
  "shopify:not_checked": "shopify_not_checked",
  "shopify:list_unavailable": "shopify_list_unavailable",
  "access:not_checked": "access_not_checked",
  "schema:no_product_pages": "schema_no_product_pages",
  "mistral:not_named": "mistral_not_named",
  "gemini:unavailable": "gemini_unavailable",
  "gemini:not_named": "gemini_not_named",
};
const BY_TYPE = new Set([
  "store_maintenance_mode", "store_coming_soon", "schema_product_missing", "schema_unparsed", "schema_fields_missing", "access_check_unavailable",
  "wcstore_price_zero", "wcstore_sale_not_lower", "wcstore_no_images", "wcstore_short_description",
  "shopify_price_zero", "shopify_compare_at_not_higher", "shopify_no_images", "shopify_short_description", "shopify_no_vendor", "shopify_unavailable", "shopify_no_weight",
]);

// Every id findingCopy can return (each must be in the catalog).
export const COPY_IDS = [...Object.values(KEYED), ...BY_TYPE, "robots_blocks_bot", "bot_protection_blocked", "access_blocked", "access_rate_limited", "access_degraded", "price_mismatch_store", "price_mismatch_page", "schema_unavailable", "schema_unavailable_protected"];

const after = (key: string, prefix: string) => key.slice(prefix.length);
const quoted = (title: string) => /^"(.+)":/.exec(title)?.[1] ?? "";

export function findingCopy(f: Stored): FindingCopy | null {
  if (KEYED[f.finding_key]) return { id: KEYED[f.finding_key], values: {} };
  if (f.type === "robots_blocks_bot") return { id: "robots_blocks_bot", values: { bot: after(f.finding_key, "robots:") } };
  if (f.type === "bot_protection_blocked") return { id: "bot_protection_blocked", values: { vendor: /\(([^)]+)\)\s*$/.exec(f.title)?.[1] ?? "" } };
  if (["access_blocked", "access_rate_limited", "access_degraded"].includes(f.type)) return { id: f.type, values: { bot: after(f.finding_key, "access:") } };
  if (f.type === "price_mismatch") return { id: /store's product price/.test(f.title) ? "price_mismatch_store" : "price_mismatch_page", values: {} };
  if (f.finding_key.startsWith("schema:unavailable:")) return { id: f.guidance.startsWith("Allow") ? "schema_unavailable_protected" : "schema_unavailable", values: {} };
  if (BY_TYPE.has(f.type)) return { id: f.type, values: f.type.startsWith("wcstore_") || f.type.startsWith("shopify_") ? { product: quoted(f.title) } : {} };
  return null;
}
