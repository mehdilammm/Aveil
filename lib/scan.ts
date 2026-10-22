import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { findingState } from "./history";
import { runAccessCheck, runStructuredChecks, sampleProductPages } from "./agent-checks";
import { connectionAfterScan } from "./connection";
import { checkFeedProduct, checkFeedStore } from "./feed";
import { checkStoreGate } from "./gate";
import { checkStorePages } from "./pages";
import { checkProduct, type Finding, type Severity } from "./rules";
import { checkCheckout } from "./checkout";
import { planOf, syncOrders } from "./orders-sync";
import { PLANS } from "./plans";
import { BROWSER_UA, AI_BOTS } from "./access";
import { fetchPaymentGateways, fetchPublicPage, fetchPublicPages, fetchPublishedProducts, fetchPublishedVariations, fetchComingSoon, fetchSettings, fetchShippingZones, fetchSiteName, WooError } from "./woo";

type Store = { id: string; owner_id: string; url: string };

const STALE_RUNNING_MS = 10 * 60_000;
const VARIATION_CONCURRENCY = 4;

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i]);
      }
    }),
  );
  return out;
}

// Keys of the previous complete scan, and of every earlier complete scan.
async function earlierKeys(admin: SupabaseClient, storeId: string, scanId: string) {
  const { data: scans, error } = await admin
    .from("scans")
    .select("id")
    .eq("store_id", storeId)
    .eq("status", "complete")
    .neq("id", scanId)
    .order("created_at", { ascending: false });
  if (error) throw error;

  const previous = new Set<string>();
  const ever = new Set<string>();
  if (!scans.length) return { previous, ever };

  const ids = scans.map((s) => s.id);
  for (let from = 0; ; from += 1000) {
    const { data, error: fErr } = await admin.from("findings").select("scan_id, finding_key").in("scan_id", ids).range(from, from + 999);
    if (fErr) throw fErr;
    for (const f of data) {
      ever.add(f.finding_key);
      if (f.scan_id === ids[0]) previous.add(f.finding_key);
    }
    if (data.length < 1000) break;
  }
  return { previous, ever };
}

// Runs one scan for a store the caller has already verified belongs to the user.
export async function runScan(
  admin: SupabaseClient,
  store: Store,
  trigger: "manual" | "scheduled" = "manual",
): Promise<{ scanId: string; error?: string }> {
  const { data: running } = await admin
    .from("scans")
    .select("id, started_at")
    .eq("store_id", store.id)
    .in("status", ["queued", "running"])
    .gte("created_at", new Date(Date.now() - STALE_RUNNING_MS).toISOString())
    .limit(1);
  if (running?.length) return { scanId: running[0].id, error: "A scan is already running for this store." };

  const { data: scan, error: scanErr } = await admin
    .from("scans")
    .insert({ store_id: store.id, owner_id: store.owner_id, status: "running", trigger, started_at: new Date().toISOString() })
    .select("id")
    .single();
  if (scanErr) throw scanErr;

  try {
    const { data: creds, error: credErr } = await admin
      .rpc("get_store_credentials", { p_store_id: store.id, p_owner_id: store.owner_id })
      .maybeSingle<{ consumer_key: string; consumer_secret: string }>();
    if (credErr) throw credErr;
    if (!creds) throw new WooError("No API key is saved for this store. Add the store again with its API key.");

    const wooCreds = { consumerKey: creds.consumer_key, consumerSecret: creds.consumer_secret };
    const products = await fetchPublishedProducts(store.url, wooCreds);

    const findings: Finding[] = (
      await mapLimit(products.items, VARIATION_CONCURRENCY, async (p) =>
        [
          ...checkProduct(p, p.type === "variable" ? await fetchPublishedVariations(store.url, p.id, wooCreds) : []),
          ...checkFeedProduct(p),
        ],
      )
    ).flat();

    const [settings, pages, siteName, comingSoon] = await Promise.all([
      fetchSettings(store.url, ["general", "products", "advanced", "account"], wooCreds),
      fetchPublicPages(store.url),
      fetchSiteName(store.url),
      fetchComingSoon(store.url, wooCreds),
    ]);
    findings.push(...checkStorePages({ storeUrl: store.url, settings, pages }));
    findings.push(...checkFeedStore({ storeUrl: store.url, siteName, settings }));

    // The traffic connection token signs X-AgentScope-Check, so the plugin does not count these test requests.
    const { data: connector } = await admin.rpc("get_traffic_connector_secret", { p_store_id: store.id }).maybeSingle<{ token: string }>();
    const checkToken = connector?.token ?? null;
    const samples = sampleProductPages(store.url, products.items);
    const access = await runAccessCheck(store.url, samples.map((s) => s.url), comingSoon, checkToken);
    findings.push(...access.findings);
    findings.push(...checkStoreGate(store.url, comingSoon, access.gated));
    const currency = settings.ok && /^[A-Z]{3}$/.test(settings.data.woocommerce_currency ?? "") ? settings.data.woocommerce_currency : null;
    findings.push(...(await runStructuredChecks(store.url, samples, access.pages, currency, checkToken)));

    // Checkout: guest checkout, shipping, payment, the checkout page for a browser and for GPTBot, stock.
    const [zones, gateways] = await Promise.all([fetchShippingZones(store.url, wooCreds), fetchPaymentGateways(store.url, wooCreds)]);
    const checkoutId = settings.ok ? Number(settings.data.woocommerce_checkout_page_id ?? 0) : 0;
    const checkoutSlug = pages.ok ? pages.data.find((p) => p.id === checkoutId)?.slug : undefined;
    let checkoutPage = null;
    if (checkoutSlug) {
      const url = `${store.url}/${checkoutSlug}/`;
      const gptbot = AI_BOTS.find((b) => b.name === "GPTBot")!.ua;
      checkoutPage = { url, browser: await fetchPublicPage(url, BROWSER_UA, checkToken), bot: await fetchPublicPage(url, gptbot, checkToken) };
    }
    findings.push(...checkCheckout({
      storeUrl: store.url,
      settings,
      zones,
      gateways,
      checkoutPage,
      products: {
        total: products.items.length,
        outOfStock: products.items.filter((p) => p.stock_status === "outofstock").length,
        needShipping: products.items.filter((p) => !p.virtual).length,
      },
    }));

    const { previous, ever } = await earlierKeys(admin, store.id, scan.id);
    const rows = findings.map((f) => ({
      ...f,
      scan_id: scan.id,
      store_id: store.id,
      owner_id: store.owner_id,
      state: findingState(f.finding_key, previous, ever),
    }));
    for (let i = 0; i < rows.length; i += 500) {
      const { error } = await admin.from("findings").insert(rows.slice(i, i + 500));
      if (error) throw error;
    }

    const severity_counts: Record<Severity, number> = { high: 0, medium: 0, low: 0 };
    for (const f of findings) severity_counts[f.severity]++;

    await admin
      .from("scans")
      .update({
        status: "complete",
        finished_at: new Date().toISOString(),
        published_products: products.total,
        scanned_products: products.items.length,
        findings_count: findings.length,
        severity_counts,
        error: products.truncated ? `Only the first ${products.items.length} of ${products.total} products were scanned.` : null,
      })
      .eq("id", scan.id);
    await admin.from("stores").update(connectionAfterScan({ ok: true })).eq("id", store.id);

    // AI-referred orders (Pro and Agency). A failure here never fails the scan.
    try {
      if (PLANS[await planOf(admin, store.id)].aiRevenue) await syncOrders(admin, store, wooCreds);
    } catch (err) {
      console.error("order sync failed", store.id, err instanceof Error ? err.message : "unknown");
    }
    return { scanId: scan.id };
  } catch (err) {
    const message = err instanceof WooError ? err.message : "The scan failed. Please try again.";
    if (!(err instanceof WooError)) console.error("scan failed", scan.id, err);
    await admin.from("stores").update(connectionAfterScan({ ok: false, message })).eq("id", store.id);
    // Drop partial findings so a failed scan never counts in history.
    await admin.from("findings").delete().eq("scan_id", scan.id);
    await admin.from("scans").update({ status: "failed", finished_at: new Date().toISOString(), error: message }).eq("id", scan.id);
    return { scanId: scan.id, error: message };
  }
}
