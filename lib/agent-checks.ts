import "server-only";
import { accessPlan, AI_BOTS, BROWSER_UA, checkAccess, retryAfterMs, type PageResult } from "./access";
import { resolveGate, type ComingSoonSetting, type Gate } from "./gate";
import type { Source } from "./pages";
import { checkLlmsTxt, checkRobots, type RobotsFetch } from "./robots";
import type { Finding, WooProduct } from "./rules";
import { checkStructuredData, schemaPagesFrom } from "./structured-data";
import { fetchPublicPage, type PageFetch } from "./woo";

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

const REQUEST_GAP_MS = 1500;
const MAX_RETRIES = 2;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Spaces requests out and retries a 429 once (at most MAX_RETRIES per scan), honouring Retry-After.
function politeFetcher(checkToken: string | null) {
  let first = true;
  let retries = 0;
  return async (url: string, userAgent: string): Promise<PageFetch> => {
    if (!first) await sleep(REQUEST_GAP_MS);
    first = false;
    const res = await fetchPublicPage(url, userAgent, checkToken);
    if (res.ok && res.status === 429 && retries < MAX_RETRIES) {
      retries++;
      await sleep(retryAfterMs(res.retryAfter));
      return fetchPublicPage(url, userAgent, checkToken);
    }
    return res;
  };
}

// Runs the access test one request at a time: 10 requests plus at most 2 retries after a 429.
// Pages that show a Coming soon or maintenance screen are not tested with the bots.
export async function runAccessCheck(
  storeUrl: string,
  productUrls: string[],
  comingSoon: Source<ComingSoonSetting>,
  checkToken: string | null = null,
): Promise<{ findings: Finding[]; pages: PageResult[]; gated: { label: string; gate: Gate }[] }> {
  const get = politeFetcher(checkToken);
  const pages: PageResult[] = [];
  const gated: { label: string; gate: Gate }[] = [];
  for (const item of accessPlan(`${storeUrl}/`, productUrls)) {
    const result: PageResult = { label: item.label, url: item.url, browser: await get(item.url, BROWSER_UA), bots: {} };
    const gate = resolveGate(result.browser, comingSoon, item.label === "home page" ? "home" : "product");
    if (gate) {
      gated.push({ label: item.label, gate });
      result.gate = gate.reason;
    } else {
      for (const bot of item.bots) result.bots[bot] = await get(item.url, UA[bot]);
    }
    pages.push(result);
  }
  return { findings: checkAccess(storeUrl, pages), pages, gated };
}

const CHECKER_UA = "AgentScope/0.3 (+store readiness check)";

async function fetchText(url: string, checkToken: string | null): Promise<Source<RobotsFetch>> {
  const res = await fetchPublicPage(url, CHECKER_UA, checkToken);
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
  checkToken: string | null = null,
): Promise<Finding[]> {
  const robots = await fetchText(`${storeUrl}/robots.txt`, checkToken);
  const llms = await fetchText(`${storeUrl}/llms.txt`, checkToken);
  const productPath = samples[0] ? new URL(samples[0].url).pathname : null;

  const schemaPages = schemaPagesFrom(samples, accessPages);

  return [...checkRobots(storeUrl, robots, productPath), ...checkStructuredData(schemaPages, storeCurrency), ...checkLlmsTxt(storeUrl, llms)];
}
