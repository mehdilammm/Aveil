import "server-only";
import { accessPlan, AI_BOTS, BROWSER_UA, checkAccess, type PageResult } from "./access";
import type { Finding, WooProduct } from "./rules";
import { fetchPublicPage } from "./woo";

const UA = Object.fromEntries(AI_BOTS.map((b) => [b.name, b.ua])) as Record<(typeof AI_BOTS)[number]["name"], string>;

// Public product pages on the store's own host, from the API permalinks.
export function sampleProductPages(storeUrl: string, products: WooProduct[]): { id: number; url: string; product: WooProduct }[] {
  const host = new URL(storeUrl).host;
  const out: { id: number; url: string; product: WooProduct }[] = [];
  for (const p of products) {
    try {
      const u = new URL(p.permalink ?? "");
      if (u.protocol === "https:" && u.host === host) out.push({ id: p.id, url: u.toString(), product: p });
    } catch {
      // no usable permalink
    }
    if (out.length === 2) break;
  }
  return out;
}

// Runs the 10-request access test one request at a time, so the store is never hit in parallel.
export async function runAccessCheck(storeUrl: string, productUrls: string[]): Promise<{ findings: Finding[]; pages: PageResult[] }> {
  const pages: PageResult[] = [];
  for (const item of accessPlan(`${storeUrl}/`, productUrls)) {
    const result: PageResult = { label: item.label, url: item.url, browser: await fetchPublicPage(item.url, BROWSER_UA), bots: {} };
    for (const bot of item.bots) result.bots[bot] = await fetchPublicPage(item.url, UA[bot]);
    pages.push(result);
  }
  return { findings: checkAccess(storeUrl, pages), pages };
}
