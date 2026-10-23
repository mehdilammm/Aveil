import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { findingState } from "./history";
import { runStructuredChecks } from "./agent-checks";
import { connectionAfterScan } from "./connection";
import { checkFeedProduct, checkFeedStore } from "./feed";
import { checkStoreGate, describePage, pageGate } from "./gate";
import { JobYield, PermanentJobError, type StepContext } from "./jobs";
import { checkStorePages } from "./pages";
import { checkProduct, type Finding, type Severity, type WooProduct } from "./rules";
import { checkCheckout } from "./checkout";
import { planOf, syncOrders } from "./orders-sync";
import { PLANS } from "./plans";
import { BROWSER_UA, AI_BOTS, retryAfterMs } from "./access";
import { fetchPublicPage, MAX_PRODUCT_PAGES, WooError, type PageFetch, type WooCredentials } from "./woo";
import { wooCommerceAdapter } from "./platform/woocommerce";
import { recordVerification } from "./ownership-store";
import { runAutoFix } from "./autofix-run";
import { countRequests } from "./safe-fetch";
import { pageUrlOf, sampleProducts } from "./sampling";
import { detectSchemaSources, SOURCE_LABEL } from "./schema-source";
import { checkStructuredData, type SchemaPage } from "./structured-data";

type Store = { id: string; owner_id: string; url: string };
export type ScanTrigger = "manual" | "scheduled";

const VARIATION_CONCURRENCY = 4;
const SCHEMA_CHUNK = 10; // sampled product pages checked per step
const PAGE_GAP_MS = 1500;
// A step must fit in what is left of the tick; otherwise the job yields and the next tick continues it.
const STEP_BUDGET_MS = { products: 90_000, store: 120_000, schema: 60_000, finish: 30_000 };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = Array.from({ length: items.length });
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

// Product fields kept between steps (for the sample and the checkout checks), never the whole catalog.
export type Slim = Pick<WooProduct, "id" | "name" | "type" | "price" | "regular_price" | "sale_price" | "stock_status" | "permalink" | "virtual"> & { total_sales: number; categories: { id: number }[] };
export const slim = (p: WooProduct & { total_sales?: number | string; categories?: { id: number }[] }): Slim => ({
  id: p.id, name: p.name, type: p.type, price: p.price, regular_price: p.regular_price, sale_price: p.sale_price, stock_status: p.stock_status ?? null,
  permalink: p.permalink ?? null, virtual: p.virtual, total_sales: Number(p.total_sales ?? 0) || 0, categories: (p.categories ?? []).map((c) => ({ id: c.id })),
});

type ProductsPage = { total: number; totalPages: number; products: Slim[]; findings: number; requests: number };
type StoreStep = { currency: string | null; sample: { url: string; product: Slim }[]; basis: string; requests: number; findings: number };
type CountStep = { findings: number; requests: number; pages?: number };

// Findings of one step are replaced as a whole, so a retried step never leaves duplicates.
async function saveFindings(admin: SupabaseClient, store: Store, scanId: string, stepKey: string, findings: Finding[]) {
  const { error: delErr } = await admin.from("findings").delete().eq("scan_id", scanId).eq("job_step", stepKey);
  if (delErr) throw delErr;
  const rows = findings.map((f) => ({ ...f, scan_id: scanId, store_id: store.id, owner_id: store.owner_id, job_step: stepKey, state: null }));
  for (let i = 0; i < rows.length; i += 500) {
    const { error } = await admin.from("findings").insert(rows.slice(i, i + 500));
    if (error) throw error;
  }
}

// Schema source rows for the sampled product pages of this scan.
export function schemaRows(store: Store, scanId: string, pages: SchemaPage[]) {
  return pages.map((p) => {
    const d = p.html === null ? null : detectSchemaSources(p.html, p.url);
    return {
      scan_id: scanId, store_id: store.id, owner_id: store.owner_id, product_id: p.product.id, url: p.url,
      primary_source: d?.primary?.source ?? null, primary_id: d?.primary?.id ?? null, duplicate: d?.duplicate ?? false,
      sources: d ? [...new Set(d.blocks.map((b) => b.source))] : [], error: p.html === null ? (p.fetchError ?? "not loaded").slice(0, 300) : null,
    };
  });
}

async function saveSchemaPages(admin: SupabaseClient, store: Store, scanId: string, pages: SchemaPage[]) {
  const rows = schemaRows(store, scanId, pages);
  if (!rows.length) return;
  const { error } = await admin.from("scan_schema_pages").upsert(rows, { onConflict: "scan_id,product_id" });
  if (error) throw error;
}

// Two Product nodes on one page that are not the same @id: agents can read two different products.
export function duplicateSchemaFindings(pages: SchemaPage[]): Finding[] {
  const out: Finding[] = [];
  for (const p of pages) {
    if (p.html === null) continue;
    const d = detectSchemaSources(p.html, p.url);
    if (!d.duplicate) continue;
    const list = d.products.map((n) => `${SOURCE_LABEL[n.source]} (${n.id ?? "no @id"})`).join(" and ");
    out.push({
      finding_key: `schema_duplicate_product:${p.product.id}`,
      type: "schema_duplicate_product",
      product_id: p.product.id,
      title: "Two Product descriptions on one page",
      severity: "medium",
      basis: "observed",
      evidence: `${p.url} has ${d.products.length} Product nodes: ${list}.`,
      guidance: "Keep one: turn off product schema in the SEO plugin, or WooCommerce's own, so agents read one product with one price. AgentScope fixes extend the existing Product instead of adding another.",
      fix_url: p.url,
    });
  }
  return out;
}

export function schemaPage(product: Slim, url: string, res: PageFetch): SchemaPage {
  const gate = res.ok ? pageGate(res) : null;
  const usable = res.ok && res.status >= 200 && res.status < 300 && !res.redirectedTo && !gate;
  return {
    product: product as unknown as WooProduct,
    url,
    html: usable && res.ok ? res.body : null,
    seen: res.ok ? describePage(res) : undefined,
    fetchError: !res.ok ? res.error : gate ? gate.reason : res.redirectedTo ? `redirected to ${res.redirectedTo}` : usable ? undefined : `HTTP ${res.status}`,
  };
}

// Waits between requests and retries a 429 once (Retry-After honoured), like the access test.
export async function politePage(url: string, ua: string, checkToken: string | null): Promise<{ res: PageFetch; retried: boolean }> {
  await sleep(PAGE_GAP_MS);
  const res = await fetchPublicPage(url, ua, checkToken);
  if (res.ok && res.status === 429) {
    await sleep(retryAfterMs(res.retryAfter));
    return { res: await fetchPublicPage(url, ua, checkToken), retried: true };
  }
  return { res, retried: false };
}

async function credentialsOf(admin: SupabaseClient, store: Store): Promise<WooCredentials> {
  const { data: creds, error } = await admin
    .rpc("get_store_credentials", { p_store_id: store.id, p_owner_id: store.owner_id })
    .maybeSingle<{ consumer_key: string; consumer_secret: string }>();
  if (error) throw error;
  if (!creds) throw new WooError("No API key is saved for this store. Add the store again with its API key.");
  return { consumerKey: creds.consumer_key, consumerSecret: creds.consumer_secret };
}

const OPEN_JOB_MS = 30 * 60_000;

// Queues a scan job for the store (one at a time). The job runs in the background (see app/api/jobs/tick).
export async function enqueueScan(admin: SupabaseClient, store: Store & { workspace_id: string }, trigger: ScanTrigger, userId: string | null): Promise<{ jobId: string; error?: string }> {
  const { data: open } = await admin
    .from("jobs")
    .select("id")
    .eq("store_id", store.id)
    .eq("kind", "scan")
    .in("status", ["queued", "running"])
    .gte("created_at", new Date(Date.now() - OPEN_JOB_MS).toISOString())
    .limit(1);
  if (open?.length) return { jobId: open[0].id, error: "A scan is already running for this store." };
  const { data, error } = await admin.from("jobs").insert({ workspace_id: store.workspace_id, store_id: store.id, kind: "scan", progress: { trigger }, created_by: userId }).select("id").single();
  if (error || !data) throw error ?? new Error("could not queue the scan");
  return { jobId: data.id };
}

// The scan as job steps: start → products page by page → store-wide checks → sampled product pages → finish.
// Same requests and findings as the one-request scan it replaces, plus the plan's sample of product pages.
export async function scanJob(ctx: StepContext, store: Store, trigger: ScanTrigger) {
  const { admin, step, timeLeft, job } = ctx;
  const need = (ms: number) => {
    if (timeLeft() < ms) throw new JobYield();
  };

  const { scanId } = await step("start", async () => {
    const { data: scan, error } = await admin
      .from("scans")
      .insert({ store_id: store.id, owner_id: store.owner_id, status: "running", trigger, started_at: new Date().toISOString() })
      .select("id")
      .single();
    if (error) throw error;
    return { scanId: scan.id as string };
  });
  const progress = (s: string, extra: Record<string, unknown> = {}) => admin.from("jobs").update({ progress: { trigger, scan_id: scanId, step: s, ...extra } }).eq("id", job.id);

  const fail = async (message: string) => {
    await admin.from("stores").update(connectionAfterScan({ ok: false, message })).eq("id", store.id);
    // Drop partial findings so a failed scan never counts in history.
    await admin.from("findings").delete().eq("scan_id", scanId);
    await admin.from("scan_schema_pages").delete().eq("scan_id", scanId);
    await admin.from("scans").update({ status: "failed", finished_at: new Date().toISOString(), error: message }).eq("id", scanId);
  };

  try {
    const creds = await credentialsOf(admin, store);
    const adapter = wooCommerceAdapter(store.url, creds);
    const { data: connector } = await admin.rpc("get_traffic_connector_secret", { p_store_id: store.id }).maybeSingle<{ token: string }>();
    // The traffic connection token signs X-AgentScope-Check, so the plugin does not count these test requests.
    const checkToken = connector?.token ?? null;

    // Products, 100 per step: product rules, variation prices and feed fields.
    const pages: ProductsPage[] = [];
    for (let page = 1; ; page++) {
      const key = `products:page:${page}`;
      const r = await step<ProductsPage>(key, async () => {
        need(STEP_BUDGET_MS.products);
        await progress("products", { page });
        const { result, requests } = await countRequests(async () => {
          const res = await adapter.fetchProductsPage(page);
          const findings = (
            await mapLimit(res.items, VARIATION_CONCURRENCY, async (p) => [
              ...checkProduct(p, p.type === "variable" ? await adapter.fetchVariations(p.id) : []),
              ...checkFeedProduct(p),
            ])
          ).flat();
          await saveFindings(admin, store, scanId, key, findings);
          return { total: res.total, totalPages: res.totalPages, products: res.items.map(slim), findings: findings.length };
        });
        return { ...result, requests };
      });
      pages.push(r);
      if (page >= Math.min(r.totalPages, MAX_PRODUCT_PAGES) || !r.products.length) break;
    }
    const products = pages.flatMap((p) => p.products);
    const total = pages[0]?.total ?? 0;
    const truncated = (pages[0]?.totalPages ?? 1) > MAX_PRODUCT_PAGES;

    // Store-wide: pages and policies, feed, bot access (2 product pages), robots/llms, JSON-LD on those 2, checkout.
    const plan = await planOf(admin, store.id);
    const storeStep = await step<StoreStep>("store", async () => {
      need(STEP_BUDGET_MS.store);
      await progress("store");
      const { result, requests } = await countRequests(async () => {
        const findings: Finding[] = [];
        const { settings, pages: publicPages, siteName, comingSoon } = await adapter.fetchPolicies();
        findings.push(...checkStorePages({ storeUrl: store.url, settings, pages: publicPages }));
        findings.push(...checkFeedStore({ storeUrl: store.url, siteName, settings }));

        const picked = sampleProducts(store.url, products, PLANS[plan].sampleProducts);
        const sample = picked.items.map((p) => ({ url: pageUrlOf(store.url, p)!, product: p }));
        const firstTwo = sample.slice(0, 2);
        const access = await adapter.checkBotAccess(firstTwo.map((s) => s.url), comingSoon, checkToken);
        findings.push(...access.findings);
        findings.push(...checkStoreGate(store.url, comingSoon, access.gated));
        const currency = settings.ok && /^[A-Z]{3}$/.test(settings.data.woocommerce_currency ?? "") ? settings.data.woocommerce_currency : null;
        const asWoo = firstTwo.map((s) => ({ url: s.url, product: s.product as unknown as WooProduct }));
        findings.push(...(await runStructuredChecks(store.url, asWoo, access.pages, currency, checkToken)));
        const firstPages = firstTwo.map((s) => {
          const loaded = access.pages.find((p) => p.url === s.url)?.browser;
          return loaded ? schemaPage(s.product, s.url, loaded) : { product: s.product as unknown as WooProduct, url: s.url, html: null, fetchError: "not loaded" };
        });
        findings.push(...duplicateSchemaFindings(firstPages));
        await saveSchemaPages(admin, store, scanId, firstPages);

        // Checkout: guest checkout, shipping, payment, the checkout page for a browser and for GPTBot, stock.
        const { zones, gateways } = await adapter.fetchCheckoutSetup();
        const checkoutId = settings.ok ? Number(settings.data.woocommerce_checkout_page_id ?? 0) : 0;
        const checkoutSlug = publicPages.ok ? publicPages.data.find((p) => p.id === checkoutId)?.slug : undefined;
        let checkoutPage = null;
        if (checkoutSlug) {
          const url = `${store.url}/${checkoutSlug}/`;
          const gptbot = AI_BOTS.find((b) => b.name === "GPTBot")!.ua;
          const browser = await politePage(url, BROWSER_UA, checkToken);
          const bot = await politePage(url, gptbot, checkToken);
          checkoutPage = { url, browser: browser.res, bot: bot.res, botRetried: bot.retried };
        }
        findings.push(...checkCheckout({
          storeUrl: store.url,
          settings,
          zones,
          gateways,
          checkoutPage,
          products: {
            total: products.length,
            outOfStock: products.filter((p) => p.stock_status === "outofstock").length,
            needShipping: products.filter((p) => !p.virtual).length,
          },
        }));
        await saveFindings(admin, store, scanId, "store", findings);
        return { currency, sample, basis: picked.basis, findings: findings.length };
      });
      return { ...result, requests };
    });

    // The rest of the sample (plan: Free 5, Pro 50 product pages), as a browser, one page every 1.5 s.
    const rest = storeStep.sample.slice(2);
    const schemaSteps: CountStep[] = [];
    for (let i = 0; i < rest.length; i += SCHEMA_CHUNK) {
      const key = `schema:${i / SCHEMA_CHUNK}`;
      schemaSteps.push(await step<CountStep>(key, async () => {
        need(STEP_BUDGET_MS.schema);
        await progress("product pages", { checked: 2 + i, of: storeStep.sample.length });
        const { result, requests } = await countRequests(async () => {
          const chunk: SchemaPage[] = [];
          for (const [j, s] of rest.slice(i, i + SCHEMA_CHUNK).entries()) {
            if (j > 0) await sleep(PAGE_GAP_MS);
            chunk.push(schemaPage(s.product, s.url, (await adapter.fetchProductSchema(s.url, checkToken)).page));
          }
          const findings = [...checkStructuredData(chunk, storeStep.currency), ...duplicateSchemaFindings(chunk)];
          await saveFindings(admin, store, scanId, key, findings);
          await saveSchemaPages(admin, store, scanId, chunk);
          return { findings: findings.length, pages: chunk.length };
        });
        return { ...result, requests };
      }));
    }

    await step("finish", async () => {
      need(STEP_BUDGET_MS.finish);
      // History state per finding (new / ongoing / recurred), set once every step is in.
      const { previous, ever } = await earlierKeys(admin, store.id, scanId);
      const keys: { finding_key: string; severity: Severity }[] = [];
      for (let from = 0; ; from += 1000) {
        const { data, error } = await admin.from("findings").select("finding_key, severity").eq("scan_id", scanId).range(from, from + 999);
        if (error) throw error;
        keys.push(...(data as typeof keys));
        if (data.length < 1000) break;
      }
      const byState = new Map<string, string[]>();
      for (const k of keys) {
        const s = findingState(k.finding_key, previous, ever);
        byState.set(s, [...(byState.get(s) ?? []), k.finding_key]);
      }
      for (const [state, list] of byState) {
        for (let i = 0; i < list.length; i += 200) {
          const { error } = await admin.from("findings").update({ state }).eq("scan_id", scanId).in("finding_key", list.slice(i, i + 200));
          if (error) throw error;
        }
      }
      const severity_counts: Record<Severity, number> = { high: 0, medium: 0, low: 0 };
      for (const k of keys) severity_counts[k.severity]++;
      const requests = pages.reduce((n, p) => n + p.requests, 0) + storeStep.requests + schemaSteps.reduce((n, s) => n + s.requests, 0);
      const { error } = await admin
        .from("scans")
        .update({
          status: "complete",
          finished_at: new Date().toISOString(),
          published_products: total,
          scanned_products: products.length,
          findings_count: keys.length,
          severity_counts,
          requests_count: requests,
          cost_usd_micros: 0, // a scan calls no paid service: the store's API and its public pages only
          sampled_products: storeStep.sample.length,
          sample_basis: storeStep.basis,
          error: truncated ? `Only the first ${products.length} of ${total} products were scanned.` : null,
        })
        .eq("id", scanId);
      if (error) throw error;
      await admin.from("stores").update(connectionAfterScan({ ok: true })).eq("id", store.id);
      return { findings: keys.length, requests };
    });

    // The key just read the store's products on its own host: ownership by API key, re-confirmed by each scan.
    try {
      await recordVerification(admin, store, "api_key", { verified: true, evidence: `WooCommerce at ${new URL(store.url).host} accepted this store's API key during the scan.` });
    } catch (err) {
      console.error("ownership record failed", store.id, err instanceof Error ? err.message : "unknown");
    }
    // AI-referred orders (Pro and Agency). A failure here never fails the scan.
    try {
      if (PLANS[plan].aiRevenue) await syncOrders(admin, store, creds);
    } catch (err) {
      console.error("order sync failed", store.id, err instanceof Error ? err.message : "unknown");
    }
    // Auto-fix (only when the merchant turned it on after the preview): technical fixes, verified, logged.
    await step("autofix", async () => {
      const { data: setting } = await admin.from("stores").select("auto_fix_enabled").eq("id", store.id).maybeSingle();
      if (!setting?.auto_fix_enabled) return { skipped: "off" };
      need(STEP_BUDGET_MS.store);
      await progress("autofix");
      return runAutoFix(admin, store, scanId);
    });
    await progress("done");
  } catch (err) {
    if (err instanceof JobYield) throw err;
    if (err instanceof WooError) {
      // The store answered with a clear refusal (key, URL, redirect): a retry will not help.
      await fail(err.message);
      throw new PermanentJobError(err.message);
    }
    console.error("scan step failed", scanId, err instanceof Error ? err.message : "unknown");
    if (job.attempt >= job.max_attempts) await fail("The scan failed. Please try again.");
    throw err;
  }
}
