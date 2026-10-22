import "server-only";
import { runAccessCheck } from "../agent-checks";
import {
  fetchAttributes,
  fetchCategories,
  fetchComingSoon,
  fetchPublicPage,
  fetchPublicPages,
  fetchPublishedProducts,
  fetchPaymentGateways,
  fetchPublishedVariations,
  fetchShippingZones,
  fetchSettings,
  fetchSiteName,
  verifyReadKey,
  type WooCredentials,
} from "../woo";
import { WRITES_DISABLED, type StorePlatformAdapter } from "./adapter";

export const SETTINGS_GROUPS = ["general", "products", "advanced", "account"];
const CHECKER_UA = "AgentScope/0.3 (+store readiness check)";

// The WooCommerce side of the contract: the same calls the scan made before, behind one interface.
export type WooDeps = {
  fetchPublishedProducts: typeof fetchPublishedProducts;
  fetchPublishedVariations: typeof fetchPublishedVariations;
  fetchCategories: typeof fetchCategories;
  fetchAttributes: typeof fetchAttributes;
  fetchSettings: typeof fetchSettings;
  fetchPublicPages: typeof fetchPublicPages;
  fetchSiteName: typeof fetchSiteName;
  fetchComingSoon: typeof fetchComingSoon;
  fetchPublicPage: typeof fetchPublicPage;
  runAccessCheck: typeof runAccessCheck;
  verifyReadKey: typeof verifyReadKey;
  fetchShippingZones: typeof fetchShippingZones;
  fetchPaymentGateways: typeof fetchPaymentGateways;
};

const REAL: WooDeps = {
  fetchPublishedProducts, fetchPublishedVariations, fetchCategories, fetchAttributes, fetchSettings, fetchPublicPages,
  fetchSiteName, fetchComingSoon, fetchPublicPage, runAccessCheck, verifyReadKey, fetchShippingZones, fetchPaymentGateways,
};

export function wooCommerceAdapter(storeUrl: string, creds: WooCredentials, deps: WooDeps = REAL): StorePlatformAdapter {
  return {
    platform: "woocommerce",
    storeUrl,
    async fetchProducts() {
      const r = await deps.fetchPublishedProducts(storeUrl, creds);
      return { items: r.items, total: r.total, truncated: r.truncated };
    },
    fetchVariations: (productId) => deps.fetchPublishedVariations(storeUrl, productId, creds),
    fetchCategories: () => deps.fetchCategories(storeUrl, creds),
    fetchAttributes: () => deps.fetchAttributes(storeUrl, creds),
    async fetchPolicies() {
      const [settings, pages, siteName, comingSoon] = await Promise.all([
        deps.fetchSettings(storeUrl, SETTINGS_GROUPS, creds),
        deps.fetchPublicPages(storeUrl),
        deps.fetchSiteName(storeUrl),
        deps.fetchComingSoon(storeUrl, creds),
      ]);
      return { settings, pages, siteName, comingSoon };
    },
    async fetchCheckoutSetup() {
      const [zones, gateways] = await Promise.all([deps.fetchShippingZones(storeUrl, creds), deps.fetchPaymentGateways(storeUrl, creds)]);
      return { zones, gateways };
    },
    async fetchProductSchema(url, checkToken) {
      return { url, page: await deps.fetchPublicPage(url, CHECKER_UA, checkToken) };
    },
    checkBotAccess: (productUrls, comingSoon, checkToken) => deps.runAccessCheck(storeUrl, productUrls, comingSoon, checkToken),
    async verifyOwnership() {
      const r = await deps.verifyReadKey(storeUrl, creds);
      return r.ok
        ? { verified: true, method: "api_key", evidence: `WooCommerce at ${new URL(storeUrl).host} accepted this store's API key.` }
        : { verified: false, method: null, evidence: r.reason };
    },
    async applyFix() {
      return { ok: false, reason: WRITES_DISABLED };
    },
    async revertFix() {
      return { ok: false, reason: WRITES_DISABLED };
    },
  };
}
