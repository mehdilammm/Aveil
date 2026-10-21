import "server-only";
import { lookup } from "node:dns/promises";
import type { PublicPage, Source } from "./pages";
import type { WooProduct, WooVariation } from "./rules";
import { isPrivateAddress } from "./url";

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

async function assertPublicHost(url: URL) {
  const addresses = await lookup(url.hostname, { all: true }).catch(() => {
    throw new WooError(`Could not resolve ${url.hostname}`);
  });
  if (addresses.some((a) => isPrivateAddress(a.address))) {
    throw new WooError(`${url.hostname} points to a private address`);
  }
}

// Fetches over https only, checking every redirect hop against private addresses.
async function safeFetch(url: URL, headers: Record<string, string>): Promise<Response> {
  let current = url;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    if (current.protocol !== "https:") throw new WooError("Store redirected to a non-https address");
    await assertPublicHost(current);
    const res = await fetch(current, { headers, redirect: "manual", signal: AbortSignal.timeout(TIMEOUT_MS), cache: "no-store" });
    const location = res.headers.get("location");
    if (res.status < 300 || res.status >= 400 || !location) return res;
    const next = new URL(location, current);
    // Do not forward credentials to another host.
    if (next.host !== url.host) throw new WooError(`Store redirects to ${next.host}. Use that address as the store URL.`);
    current = next;
  }
  throw new WooError("Too many redirects");
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
