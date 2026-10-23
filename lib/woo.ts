import "server-only";
import type { PublicPage, Source } from "./pages";
import type { WooProduct, WooVariation } from "./rules";
import { CHECK_HEADER, checkHeaderValue } from "./check-header";
import { BlockedUrlError, guardedFetch } from "./safe-fetch";
import { COUNTED_STATUSES } from "./ai-orders";

export type WooCredentials = { consumerKey: string; consumerSecret: string };

export class WooError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
  }
}

const PER_PAGE = 100;
const MAX_PAGES = 50; // 5,000 products per scan in v0.1
const MAX_REDIRECTS = 3;
const TIMEOUT_MS = 20_000;

// Fetches over https only through the guarded client (DNS checked at connect time, see safe-fetch.ts).
// Redirects are followed here, one hop at a time, each re-checked; credentials never go to another host.
async function safeFetch(url: URL, headers: Record<string, string>): Promise<Response> {
  let current = url;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    if (current.protocol !== "https:") throw new WooError("Store redirected to a non-https address");
    const res = (await guarded(current, { headers, timeoutMs: TIMEOUT_MS })) as unknown as Response;
    const location = res.headers.get("location");
    if (res.status < 300 || res.status >= 400 || !location) return res;
    await res.body?.cancel().catch(() => {});
    const next = new URL(location, current);
    // Do not forward credentials to another host.
    if (next.host !== url.host) throw new WooError(`Store redirects to ${next.host}. Use that address as the store URL.`);
    current = next;
  }
  throw new WooError("Too many redirects");
}

// guardedFetch with WooError messages for refused targets.
async function guarded(url: URL, init: Parameters<typeof guardedFetch>[1]) {
  try {
    return await guardedFetch(url, init);
  } catch (err) {
    if (err instanceof BlockedUrlError) throw new WooError(`${url.hostname}: ${err.message}`);
    throw err;
  }
}

type Page<T> = { items: T[]; total: number; totalPages: number };

async function getPage<T>(baseUrl: string, path: string, params: Record<string, string>, creds: WooCredentials): Promise<Page<T>> {
  const url = new URL(`${baseUrl}/wp-json/wc/v3${path}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const basic = Buffer.from(`${creds.consumerKey}:${creds.consumerSecret}`).toString("base64");

  let res = await safeFetch(url, { Authorization: `Basic ${basic}`, Accept: "application/json" });
  if (res.status === 401) {
    // Some hosts strip the Authorization header; WooCommerce also accepts keys as query params over https.
    url.searchParams.set("consumer_key", creds.consumerKey);
    url.searchParams.set("consumer_secret", creds.consumerSecret);
    res = await safeFetch(url, { Accept: "application/json" });
  }
  if (res.status === 401 || res.status === 403) throw new WooError("WooCommerce rejected the API key. Check it is correct and has Read access.", res.status);
  if (res.status === 404) throw new WooError("WooCommerce REST API not found at this URL. Check the store URL and that permalinks are enabled.", 404);
  if (!res.ok) throw new WooError(`WooCommerce returned HTTP ${res.status}`, res.status);

  const body = await res.json().catch(() => {
    throw new WooError("WooCommerce returned a response that is not JSON");
  });
  if (!Array.isArray(body)) throw new WooError("Unexpected WooCommerce response");
  return {
    items: body as T[],
    total: Number(res.headers.get("x-wp-total") ?? body.length),
    totalPages: Number(res.headers.get("x-wp-totalpages") ?? 1),
  };
}

async function getAll<T>(baseUrl: string, path: string, params: Record<string, string>, creds: WooCredentials) {
  const items: T[] = [];
  let total = 0;
  let totalPages = 1;
  for (let page = 1; page <= Math.min(totalPages, MAX_PAGES); page++) {
    const res = await getPage<T>(baseUrl, path, { ...params, per_page: String(PER_PAGE), page: String(page) }, creds);
    items.push(...res.items);
    total = res.total;
    totalPages = res.totalPages;
  }
  return { items, total, totalPages, truncated: totalPages > MAX_PAGES };
}

// One page (100) of published products, for scans that run page by page.
export function fetchPublishedProductsPage(baseUrl: string, creds: WooCredentials, page: number) {
  return getPage<WooProduct>(baseUrl, "/products", { status: "publish", orderby: "id", order: "asc", per_page: String(PER_PAGE), page: String(page) }, creds);
}
export const MAX_PRODUCT_PAGES = MAX_PAGES;

export function fetchPublishedProducts(baseUrl: string, creds: WooCredentials) {
  return getAll<WooProduct>(baseUrl, "/products", { status: "publish", orderby: "id", order: "asc" }, creds);
}

export async function fetchPublishedVariations(baseUrl: string, productId: number, creds: WooCredentials) {
  const { items } = await getAll<WooVariation>(baseUrl, `/products/${productId}/variations`, { orderby: "id", order: "asc" }, creds);
  return items.filter((v) => (v.status ?? "publish") === "publish");
}

type SettingRow = { id: string; value: unknown };

// Reads WooCommerce settings groups. Needs a key owned by an admin or shop manager.
export async function fetchSettings(baseUrl: string, groups: string[], creds: WooCredentials): Promise<Source<Record<string, string>>> {
  const values: Record<string, string> = {};
  try {
    for (const group of groups) {
      const { items } = await getPage<SettingRow>(baseUrl, `/settings/${group}`, {}, creds);
      for (const row of items) values[row.id] = typeof row.value === "string" ? row.value : String(row.value ?? "");
    }
    return { ok: true, data: values };
  } catch (err) {
    if (err instanceof WooError && (err.status === 401 || err.status === 403)) {
      return { ok: false, reason: "This API key is not allowed to read WooCommerce settings, so page assignments could not be checked." };
    }
    return { ok: false, reason: `WooCommerce settings could not be read: ${err instanceof WooError ? err.message : "request failed"}.` };
  }
}

const MAX_PAGE_LIST_PAGES = 5;

// Published pages from the public WordPress API. No credentials are sent.
export async function fetchPublicPages(baseUrl: string): Promise<Source<PublicPage[]>> {
  const pages: PublicPage[] = [];
  try {
    for (let page = 1, totalPages = 1; page <= Math.min(totalPages, MAX_PAGE_LIST_PAGES); page++) {
      const url = new URL(`${baseUrl}/wp-json/wp/v2/pages`);
      url.searchParams.set("per_page", "100");
      url.searchParams.set("page", String(page));
      url.searchParams.set("_fields", "id,slug,title");
      const res = await safeFetch(url, { Accept: "application/json" });
      if (!res.ok) {
        return { ok: false, reason: `The public WordPress pages list answered HTTP ${res.status}, so published pages could not be checked.` };
      }
      const body = (await res.json()) as { id: number; slug: string; title?: { rendered?: string } }[];
      if (!Array.isArray(body)) return { ok: false, reason: "The public WordPress pages list returned an unexpected response." };
      for (const p of body) pages.push({ id: p.id, slug: p.slug ?? "", title: p.title?.rendered ?? "" });
      totalPages = Number(res.headers.get("x-wp-totalpages") ?? 1);
    }
    return { ok: true, data: pages };
  } catch (err) {
    return { ok: false, reason: `Published pages could not be read: ${err instanceof WooError ? err.message : "request failed"}.` };
  }
}

// Site title from the public WordPress API index. No credentials are sent.
export async function fetchSiteName(baseUrl: string): Promise<Source<string>> {
  try {
    const url = new URL(`${baseUrl}/wp-json/`);
    url.searchParams.set("_fields", "name");
    const res = await safeFetch(url, { Accept: "application/json" });
    if (!res.ok) return { ok: false, reason: `The public WordPress API answered HTTP ${res.status}, so the site title could not be read.` };
    const body = (await res.json()) as { name?: unknown };
    return typeof body.name === "string" ? { ok: true, data: body.name } : { ok: false, reason: "The public WordPress API did not return a site title." };
  } catch (err) {
    return { ok: false, reason: `The site title could not be read: ${err instanceof WooError ? err.message : "request failed"}.` };
  }
}

export type PageFetch =
  | { ok: true; status: number; finalUrl: string; redirectedTo: string | null; bytes: number; body: string; challengeHeader: boolean; retryAfter?: string | null; vendorHint?: string | null; shopifyHeader?: boolean }
  | { ok: false; error: string; skipped?: boolean }

const PAGE_TIMEOUT_MS = 12_000;
const MAX_BODY_BYTES = 1_500_000;

async function readCapped(res: Response): Promise<{ text: string; bytes: number }> {
  if (!res.body) return { text: "", bytes: 0 };
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  while (bytes < MAX_BODY_BYTES) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    bytes += value.byteLength;
  }
  await reader.cancel().catch(() => {});
  return { text: new TextDecoder().decode(Buffer.concat(chunks).subarray(0, MAX_BODY_BYTES)), bytes };
}

// Fetches a public page with a given User-Agent, like a visitor would. No credentials are sent.
// Follows same-host redirects; a redirect to another host is reported, not followed.
// checkToken: the store's traffic connection token, to sign X-AgentScope-Check so the plugin skips this request.
export async function fetchPublicPage(target: string, userAgent: string, checkToken: string | null = null): Promise<PageFetch> {
  try {
    let current = new URL(target);
    const startHost = current.host;
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      if (current.protocol !== "https:") return { ok: false, error: "redirected to a non-https address" };
      const res = (await guarded(current, {
        headers: { "User-Agent": userAgent, Accept: "text/html,application/xhtml+xml,*/*;q=0.8", "Accept-Language": "en", [CHECK_HEADER]: checkHeaderValue(checkToken) },
        timeoutMs: PAGE_TIMEOUT_MS,
      })) as unknown as Response;
      const location = res.headers.get("location");
      if (res.status >= 300 && res.status < 400 && location) {
        await res.body?.cancel().catch(() => {});
        const next = new URL(location, current);
        if (next.host !== startHost) {
          return { ok: true, status: res.status, finalUrl: current.toString(), redirectedTo: next.toString(), bytes: 0, body: "", challengeHeader: false };
        }
        current = next;
        continue;
      }
      const { text, bytes } = await readCapped(res);
      return {
        ok: true,
        status: res.status,
        finalUrl: current.toString(),
        redirectedTo: null,
        bytes,
        body: text,
        challengeHeader: (res.headers.get("cf-mitigated") ?? "").toLowerCase() === "challenge",
        retryAfter: res.headers.get("retry-after"),
        vendorHint: vendorFromHeaders(res.headers),
      };
    }
    return { ok: false, error: "too many redirects" };
  } catch (err) {
    if (err instanceof Error && err.name === "TimeoutError") return { ok: false, error: "no response within 12 seconds" };
    return { ok: false, error: err instanceof WooError ? err.message : "request failed" };
  }
}

// WooCommerce "Coming soon" mode, from the wc-admin options endpoint (needs a key that can manage WooCommerce).
export async function fetchComingSoon(baseUrl: string, creds: WooCredentials): Promise<Source<{ comingSoon: boolean; storePagesOnly: boolean }>> {
  try {
    const url = new URL(`${baseUrl}/wp-json/wc-admin/options`);
    url.searchParams.set("options", "woocommerce_coming_soon,woocommerce_store_pages_only");
    const basic = Buffer.from(`${creds.consumerKey}:${creds.consumerSecret}`).toString("base64");
    const res = await safeFetch(url, { Authorization: `Basic ${basic}`, Accept: "application/json" });
    if (!res.ok) return { ok: false, reason: `The site visibility setting could not be read (HTTP ${res.status}).` };
    const body = (await res.json()) as Record<string, unknown>;
    if (!body || typeof body !== "object" || !("woocommerce_coming_soon" in body)) {
      return { ok: false, reason: "This WooCommerce version does not report the Coming soon setting." };
    }
    return { ok: true, data: { comingSoon: body.woocommerce_coming_soon === "yes", storePagesOnly: body.woocommerce_store_pages_only === "yes" } };
  } catch (err) {
    return { ok: false, reason: `The site visibility setting could not be read: ${err instanceof WooError ? err.message : "request failed"}.` };
  }
}

export type ProductSample = { name: string; price: string | null; categories: string[] };

// Up to 30 published products (best sellers first) with price and categories, for question suggestions.
export async function fetchProductSample(baseUrl: string, creds: WooCredentials, n = 30): Promise<ProductSample[]> {
  const { items } = await getPage<{ name: string; price?: string; categories?: { name: string }[] }>(
    baseUrl, "/products", { status: "publish", per_page: String(n), orderby: "popularity", order: "desc", _fields: "name,price,categories" }, creds,
  );
  const decode = (t: string) => t.replace(/&amp;/g, "&").replace(/&#8217;/g, "’").replace(/&quot;/g, '"').replace(/<[^>]+>/g, "").trim();
  return items.filter((p) => p?.name).map((p) => ({ name: decode(p.name), price: p.price ? String(p.price) : null, categories: (p.categories ?? []).map((c) => decode(c.name)) }));
}

// Biggest product categories by product count, for question suggestions.
export async function fetchTopCategories(baseUrl: string, creds: WooCredentials): Promise<string[]> {
  const { items } = await getPage<{ name: string; count: number }>(baseUrl, "/products/categories", { per_page: "20", orderby: "count", order: "desc", hide_empty: "true" }, creds);
  return items.filter((c) => c.count > 0).map((c) => c.name.replace(/&amp;/g, "&"));
}

// Which bot protection service answered, from response headers (cf-ray, x-sucuri-id, ...), if any.
export function vendorFromHeaders(h: { get(name: string): string | null }): string | null {
  const server = (h.get("server") ?? "").toLowerCase();
  if (h.get("cf-ray") || server.includes("cloudflare")) return "Cloudflare";
  if (h.get("x-sucuri-id") || server.includes("sucuri")) return "Sucuri";
  if (h.get("x-iinfo") || (h.get("x-cdn") ?? "").toLowerCase().includes("incapsula")) return "Imperva";
  if (h.get("x-datadome") || h.get("x-dd-b")) return "DataDome";
  if (server.includes("akamaighost") || h.get("akamai-grn")) return "Akamai";
  return null;
}

// Shopify answers carry headers such as x-shopify-stage, x-shopid or "powered-by: Shopify".
export function shopifyFromHeaders(h: { get(name: string): string | null }): boolean {
  return Boolean(h.get("x-shopify-stage") || h.get("x-shopid") || h.get("x-shardid") || /shopify/i.test(h.get("powered-by") ?? ""));
}

// Shipping zones with their locations and methods (at most 20 zones).
export async function fetchShippingZones(baseUrl: string, creds: WooCredentials): Promise<Source<import("./checkout").ShippingZone[]>> {
  try {
    const { items } = await getPage<{ id: number; name: string }>(baseUrl, "/shipping/zones", {}, creds);
    const zones = [];
    for (const z of items.slice(0, 20)) {
      const [locations, methods] = await Promise.all([
        getPage<{ code: string; type: string }>(baseUrl, `/shipping/zones/${z.id}/locations`, {}, creds),
        getPage<{ method_id: string; enabled: boolean }>(baseUrl, `/shipping/zones/${z.id}/methods`, {}, creds),
      ]);
      zones.push({
        id: z.id,
        name: z.name,
        locations: locations.items.map((l) => ({ code: String(l.code), type: String(l.type) })),
        methods: methods.items.map((m) => ({ method_id: String(m.method_id), enabled: m.enabled === true })),
      });
    }
    return { ok: true, data: zones };
  } catch (err) {
    return { ok: false, reason: `Shipping zones could not be read: ${err instanceof WooError ? err.message : "request failed"}.` };
  }
}

export async function fetchPaymentGateways(baseUrl: string, creds: WooCredentials): Promise<Source<import("./checkout").Gateway[]>> {
  try {
    const { items } = await getPage<{ id: string; title?: string; enabled?: boolean }>(baseUrl, "/payment_gateways", { _fields: "id,title,enabled" }, creds);
    return { ok: true, data: items.map((g) => ({ id: String(g.id), title: String(g.title ?? g.id), enabled: g.enabled === true })) };
  } catch (err) {
    return { ok: false, reason: `Payment methods could not be read: ${err instanceof WooError ? err.message : "request failed"}.` };
  }
}

// Orders of the last `days` days: only id, date, total, currency, status, created_via and the Order Attribution keys.
// No billing, shipping, customer or line-item fields are requested.
export async function fetchRecentOrders(baseUrl: string, creds: WooCredentials, days: number, max: number, metaKeys: string[]): Promise<Source<import("./ai-orders").WooOrder[]>> {
  const after = new Date(Date.now() - days * 86_400_000).toISOString();
  const orders: import("./ai-orders").WooOrder[] = [];
  try {
    for (let page = 1; orders.length < max; page++) {
      const res = await getPage<import("./ai-orders").WooOrder>(baseUrl, "/orders", {
        after,
        per_page: "100",
        page: String(page),
        orderby: "date",
        order: "desc",
        status: COUNTED_STATUSES.join(","),
        _fields: "id,date_created_gmt,total,currency,status,created_via,meta_data,refunds",
        include_meta: metaKeys.join(","),
      }, creds);
      orders.push(...res.items);
      if (page >= res.totalPages || !res.items.length) break;
    }
    return { ok: true, data: orders.slice(0, max) };
  } catch (err) {
    if (err instanceof WooError && (err.status === 401 || err.status === 403)) {
      return { ok: false, reason: "This API key is not allowed to read orders. Give the key Read permission (WooCommerce → Settings → Advanced → REST API)." };
    }
    return { ok: false, reason: `Orders could not be read: ${err instanceof WooError ? err.message : "request failed"}.` };
  }
}

const reason = (what: string, err: unknown) =>
  err instanceof WooError && (err.status === 401 || err.status === 403)
    ? `This API key is not allowed to read ${what}.`
    : `${what[0].toUpperCase()}${what.slice(1)} could not be read: ${err instanceof WooError ? err.message : "request failed"}.`;
const decodeName = (t: string) => t.replace(/&amp;/g, "&").replace(/&#8217;/g, "’").replace(/&quot;/g, '"').replace(/<[^>]+>/g, "").trim();

// All product categories (id, name, parent, product count).
export async function fetchCategories(baseUrl: string, creds: WooCredentials): Promise<Source<import("./platform/adapter").Category[]>> {
  try {
    const { items } = await getAll<{ id: number; name: string; parent?: number; count?: number }>(baseUrl, "/products/categories", { _fields: "id,name,parent,count" }, creds);
    return { ok: true, data: items.map((c) => ({ id: c.id, name: decodeName(c.name ?? ""), parent: Number(c.parent ?? 0), count: Number(c.count ?? 0) })) };
  } catch (err) {
    return { ok: false, reason: reason("product categories", err) };
  }
}

const MAX_ATTRIBUTES = 30;

// Global product attributes (Size, Color, ...) with their terms (first 100 per attribute).
export async function fetchAttributes(baseUrl: string, creds: WooCredentials): Promise<Source<import("./platform/adapter").Attribute[]>> {
  try {
    const { items } = await getPage<{ id: number; name: string; slug: string }>(baseUrl, "/products/attributes", {}, creds);
    const out = [];
    for (const a of items.slice(0, MAX_ATTRIBUTES)) {
      const terms = await getPage<{ name: string }>(baseUrl, `/products/attributes/${a.id}/terms`, { per_page: "100", _fields: "name" }, creds);
      out.push({ id: a.id, name: decodeName(a.name ?? ""), slug: String(a.slug ?? ""), terms: terms.items.map((t) => decodeName(t.name ?? "")) });
    }
    return { ok: true, data: out };
  } catch (err) {
    return { ok: false, reason: reason("product attributes", err) };
  }
}

// One authenticated request: proves the saved key is accepted by WooCommerce on this host.
export async function verifyReadKey(baseUrl: string, creds: WooCredentials): Promise<Source<true>> {
  try {
    await getPage<{ id: number }>(baseUrl, "/products", { per_page: "1", _fields: "id" }, creds);
    return { ok: true, data: true };
  } catch (err) {
    return { ok: false, reason: err instanceof WooError ? err.message : "The WooCommerce API could not be reached." };
  }
}

// Site title and tagline from the public WordPress API index. No credentials are sent.
export async function fetchSiteInfo(baseUrl: string): Promise<Source<{ name: string | null; description: string | null }>> {
  try {
    const url = new URL(`${baseUrl}/wp-json/`);
    url.searchParams.set("_fields", "name,description");
    const res = await safeFetch(url, { Accept: "application/json" });
    if (!res.ok) return { ok: false, reason: `The public WordPress API answered HTTP ${res.status}.` };
    const b = (await res.json()) as { name?: unknown; description?: unknown };
    return { ok: true, data: { name: typeof b.name === "string" ? b.name : null, description: typeof b.description === "string" ? b.description : null } };
  } catch (err) {
    return { ok: false, reason: `The site title could not be read: ${err instanceof WooError ? err.message : "request failed"}.` };
  }
}

// Product categories with their public links, from the public WordPress API (product_cat). No credentials are sent.
export async function fetchPublicCategories(baseUrl: string): Promise<Source<{ id: number; name: string; count: number; link: string }[]>> {
  try {
    const url = new URL(`${baseUrl}/wp-json/wp/v2/product_cat`);
    url.searchParams.set("per_page", "100");
    url.searchParams.set("_fields", "id,name,count,link");
    const res = await safeFetch(url, { Accept: "application/json" });
    if (!res.ok) return { ok: false, reason: `The public category list answered HTTP ${res.status}.` };
    const body = (await res.json()) as { id: number; name: string; count: number; link: string }[];
    if (!Array.isArray(body)) return { ok: false, reason: "The public category list returned an unexpected response." };
    const host = new URL(baseUrl).host;
    return { ok: true, data: body.filter((c) => { try { return new URL(c.link).host === host; } catch { return false; } }).map((c) => ({ id: c.id, name: decodeName(c.name ?? ""), count: Number(c.count ?? 0), link: c.link })) };
  } catch (err) {
    return { ok: false, reason: `Categories could not be read: ${err instanceof WooError ? err.message : "request failed"}.` };
  }
}
