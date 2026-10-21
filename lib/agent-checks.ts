import "server-only";
import { accessPlan, AI_BOTS, BROWSER_UA, checkAccess, type PageResult } from "./access";
import type { Source } from "./pages";
import { checkLlmsTxt, checkRobots, type RobotsFetch } from "./robots";
import type { Finding, WooProduct } from "./rules";
import { checkStructuredData } from "./structured-data";
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

const CHECKER_UA = "AgentScope/0.3 (+store readiness check)";

async function fetchText(url: string): Promise<Source<RobotsFetch>> {
  const res = await fetchPublicPage(url, CHECKER_UA);
  if (!res.ok) return { ok: false, reason: `${url} could not be loaded: ${res.error}.` };
  if (res.redirectedTo) return { ok: true, data: { status: 404, text: "" } };
  return { ok: true, data: { status: res.status, text: res.body } };
}

// robots.txt, llms.txt (2 requests) and JSON-LD on the product pages already loaded by the access check.
export async function runStructuredChecks(
  storeUrl: string,
  samples: { url: string; product: WooProduct }[],
  accessPages: PageResult[],
  storeCurrency: string | null,
): Promise<Finding[]> {
  const robots = await fetchText(`${storeUrl}/robots.txt`);
  const llms = await fetchText(`${storeUrl}/llms.txt`);
  const productPath = samples[0] ? new URL(samples[0].url).pathname : null;

  const schemaPages = samples.map((s) => {
    const loaded = accessPages.find((p) => p.url === s.url)?.browser;
    const usable = loaded?.ok && loaded.status >= 200 && loaded.status < 300 && !loaded.redirectedTo;
    return {
      product: s.product,
      url: s.url,
      html: usable && loaded.ok ? loaded.body : null,
      fetchError: !loaded ? "not loaded" : !loaded.ok ? loaded.error : loaded.redirectedTo ? `redirected to ${loaded.redirectedTo}` : `HTTP ${loaded.status}`,
    };
  });

  return [...checkRobots(storeUrl, robots, productPath), ...checkStructuredData(schemaPages, storeCurrency), ...checkLlmsTxt(storeUrl, llms)];
}
