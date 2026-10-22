// One contract for every store platform (WooCommerce now, Shopify later). Each method returns what the platform
// gave us, or a Source with the exact reason it could not be read. Nothing here writes to a store unless the store
// is ownership-verified and the merchant opted in to writes (see canWrite).
import type { PageResult } from "../access";
import type { ComingSoonSetting, Gate } from "../gate";
import type { PublicPage, Source } from "../pages";
import type { Finding, WooProduct, WooVariation } from "../rules";
import type { PageFetch } from "../woo";

export type Platform = "woocommerce" | "shopify";

export type ProductList = { items: WooProduct[]; total: number; truncated: boolean };
export type Category = { id: number; name: string; parent: number; count: number };
export type Attribute = { id: number; name: string; slug: string; terms: string[] };
export type Policies = {
  // Platform settings by id (WooCommerce: woocommerce_* settings of the general, products, advanced, account groups).
  settings: Source<Record<string, string>>;
  // Published pages, as anyone on the internet sees them.
  pages: Source<PublicPage[]>;
  siteName: Source<string>;
  comingSoon: Source<ComingSoonSetting>;
};
export type CheckoutSetup = { zones: Source<import("../checkout").ShippingZone[]>; gateways: Source<import("../checkout").Gateway[]> };
export type ProductSchemaPage = { url: string; page: PageFetch };
export type BotAccess = { findings: Finding[]; pages: PageResult[]; gated: { label: string; gate: Gate }[] };
export type OwnershipMethod = "api_key" | "dns_txt" | "meta_tag" | "well_known_file" | "plugin" | "oauth";
export type Ownership = { verified: boolean; method: OwnershipMethod | null; evidence: string };

export type FixRequest = { fixId: string; kind: string; target: string; payload: unknown };
export type FixResult = { ok: true; before: unknown; after: unknown } | { ok: false; reason: string };

export interface StorePlatformAdapter {
  readonly platform: Platform;
  readonly storeUrl: string;
  fetchProducts(): Promise<ProductList>;
  // One page of the catalog (1-based) with the platform's page count, for scans that run page by page.
  fetchProductsPage(page: number): Promise<{ items: WooProduct[]; total: number; totalPages: number }>;
  fetchVariations(productId: number): Promise<WooVariation[]>;
  fetchCategories(): Promise<Source<Category[]>>;
  fetchAttributes(): Promise<Source<Attribute[]>>;
  fetchPolicies(): Promise<Policies>;
  fetchCheckoutSetup(): Promise<CheckoutSetup>;
  fetchProductSchema(url: string, checkToken: string | null): Promise<ProductSchemaPage>;
  checkBotAccess(productUrls: string[], comingSoon: Source<ComingSoonSetting>, checkToken: string | null): Promise<BotAccess>;
  verifyOwnership(): Promise<Ownership>;
  // Writes only with an ownership-verified store and a separate write credential the merchant added.
  applyFix(fix: FixRequest): Promise<FixResult>;
  revertFix(fixId: string): Promise<FixResult>;
}

export const WRITES_DISABLED = "Writing to the store is not enabled: it needs an ownership-verified store and a separate write key added by the merchant. Use the copyable fix instead.";
