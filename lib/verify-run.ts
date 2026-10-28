import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { AI_BOTS, BROWSER_UA } from "./access";
import { runAccessCheck } from "./agent-checks";
import { checkCheckout } from "./checkout";
import { checkFeedProduct, checkFeedStore } from "./feed";
import { checkFeedServed, FEED_PATHS } from "./feed-build";
import { checkStoreGate } from "./gate";
import { checkStorePages } from "./pages";
import { wooCommerceAdapter } from "./platform/woocommerce";
import { checkLlmsTxt, checkRobots, type RobotsFetch } from "./robots";
import { checkProduct, type Finding } from "./rules";
import { pageUrlOf, sampleProducts } from "./sampling";
import { duplicateSchemaFindings, politePage, schemaPage, slim } from "./scan";
import { checkStructuredData } from "./structured-data";
import { bust, groupOf, judge, type VerifyResult } from "./verify";
import { fetchPublicPage, fetchPublishedProduct, WooError, type WooCredentials } from "./woo";
import type { Source } from "./pages";

const CHECKER_UA = "AgentScope/0.3 (+fix verification)";
type Store = { id: string; owner_id: string; url: string };
type Target = { finding_key: string; type: string; product_id: number | null };

// Runs the check that produced the finding again, on just what it covers, with caches bypassed.
export async function recheck(admin: SupabaseClient, store: Store, creds: WooCredentials, target: Target, token: string): Promise<Finding[] | { unavailable: string }> {
  const adapter = wooCommerceAdapter(store.url, creds);
  const { data: connector } = await admin.rpc("get_traffic_connector_secret", { p_store_id: store.id }).maybeSingle<{ token: string }>();
  const checkToken = connector?.token ?? null;
  const text = async (url: string): Promise<Source<RobotsFetch>> => {
    const r = await fetchPublicPage(bust(url, token), CHECKER_UA, checkToken, true);
    if (!r.ok) return { ok: false, reason: `${url} could not be loaded: ${r.error}.` };
    return { ok: true, data: r.redirectedTo ? { status: 404, text: "" } : { status: r.status, text: r.body } };
  };
  try {
    switch (groupOf(target)) {
      case "product":
      case "product_page": {
        const p = await fetchPublishedProduct(store.url, creds, target.product_id!);
        if (!p) return { unavailable: `Product #${target.product_id} is not published any more, so the fix cannot be checked.` };
        if (groupOf(target) === "product") return [...checkProduct(p, p.type === "variable" ? await adapter.fetchVariations(p.id) : []), ...checkFeedProduct(p)];
        const url = pageUrlOf(store.url, p);
        if (!url) return { unavailable: `Product #${p.id} has no page on ${new URL(store.url).host}.` };
        const { settings } = await adapter.fetchPolicies();
        const currency = settings.ok && /^[A-Z]{3}$/.test(settings.data.woocommerce_currency ?? "") ? settings.data.woocommerce_currency : null;
        const page = schemaPage(slim(p), url, await fetchPublicPage(bust(url, token), BROWSER_UA, checkToken, true));
        return [...checkStructuredData([page], currency), ...duplicateSchemaFindings([page])];
      }
      case "robots": {
        const first = sampleProducts(store.url, (await adapter.fetchProductsPage(1)).items, 1).items[0];
        const productPath = first ? new URL(pageUrlOf(store.url, first)!).pathname : null;
        const [robots, llms] = [await text(`${store.url}/robots.txt`), await text(`${store.url}/llms.txt`)];
        return [...checkRobots(store.url, robots, productPath), ...checkLlmsTxt(store.url, llms)];
      }
      case "store_pages": {
        if (target.type === "feed_not_served" || target.type === "feed_check_unavailable") return checkFeedServed(store.url, await text(`${store.url}${FEED_PATHS.jsonl}`));
        const { settings, pages, siteName } = await adapter.fetchPolicies();
        return [...checkStorePages({ storeUrl: store.url, settings, pages }), ...checkFeedStore({ storeUrl: store.url, siteName, settings })];
      }
      case "checkout": {
        const [{ settings, pages }, { zones, gateways }, products] = await Promise.all([adapter.fetchPolicies(), adapter.fetchCheckoutSetup(), adapter.fetchProducts()]);
        const checkoutId = settings.ok ? Number(settings.data.woocommerce_checkout_page_id ?? 0) : 0;
        const slug = pages.ok ? pages.data.find((p) => p.id === checkoutId)?.slug : undefined;
        let checkoutPage = null;
        if (slug) {
          const url = bust(`${store.url}/${slug}/`, token);
          const browser = await politePage(url, BROWSER_UA, checkToken);
          const bot = await politePage(url, AI_BOTS.find((b) => b.name === "GPTBot")!.ua, checkToken);
          checkoutPage = { url: `${store.url}/${slug}/`, browser: browser.res, bot: bot.res, botRetried: bot.retried };
        }
        return checkCheckout({
          storeUrl: store.url, settings, zones, gateways, checkoutPage,
          products: { total: products.items.length, outOfStock: products.items.filter((p) => p.stock_status === "outofstock").length, needShipping: products.items.filter((p) => !p.virtual).length },
        });
      }
      case "access": {
        const { comingSoon } = await adapter.fetchPolicies();
        const first = sampleProducts(store.url, (await adapter.fetchProductsPage(1)).items, 1).items[0];
        const access = await runAccessCheck(store.url, first ? [pageUrlOf(store.url, first)!] : [], comingSoon, checkToken);
        return [...access.findings, ...checkStoreGate(store.url, comingSoon, access.gated)];
      }
    }
  } catch (err) {
    return { unavailable: err instanceof WooError ? err.message : "The re-check could not run. Please try again." };
  }
}

export async function verifyOnce(admin: SupabaseClient, store: Store, creds: WooCredentials, target: Target, token: string): Promise<VerifyResult> {
  return judge(target, await recheck(admin, store, creds, target, token));
}
