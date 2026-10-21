import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { AI_BOTS } from "./access";
import { askGemini, GEMINI_MODEL, geminiConfigured } from "./gemini";
import { PublicFetcher } from "./public-fetch";
import { checkShopifyProducts, detectShopify, SHOPIFY_PRODUCTS_LIMIT, shopifyProductLinks, shopifyProductSitemap } from "./shopify";
import {
  ACCESS_BOTS, knowledgeQuestion, trustedHomeHtml, topicFromHome, visibilityQuestion, type GeminiParts, agentScopeAllowed, buildPublicReport, geminiAllowedForDomain, LIMITS, productLinks, productSitemapUrl, PUBLIC_UA,
  robotsFrom, sitemapProductUrls, type GeminiPart, type PublicReport, type PublicScanInput,
} from "./public-scan";
import { brandTerms, combineAnalysis, EXTRACTION_MAX_TOKENS, EXTRACTION_SCHEMA, extractionPrompt, extractionProblem, parseExtraction, registrableDomain } from "./visibility";

const UA = Object.fromEntries(AI_BOTS.map((b) => [b.name, b.ua])) as Record<string, string>;

type Usage = { geminiRequests: number; input: number; output: number };

const LIMIT_REASON = "Daily limit reached for free Gemini checks. Try again tomorrow.";

// One question and its extraction. Both requests are reserved together in the app-wide daily budget,
// so an asked question always gets its extraction; retries beyond those two are recorded too.
async function ask(admin: SupabaseClient, usage: Usage, prompt: string, terms: ReturnType<typeof brandTerms>, label: string): Promise<GeminiPart> {
  const { data: reserved } = await admin.rpc("public_gemini_reserve_n", { p_limit: LIMITS.geminiPerDay, p_n: 2 });
  if (!reserved) return { status: "unavailable", reason: LIMIT_REASON, prompt };

  const r = await askGemini(prompt);
  let requests = r.requests;
  const finish = async () => {
    usage.geminiRequests += requests;
    if (requests > 2) await admin.rpc("public_gemini_record", { p_n: requests - 2 });
  };
  if (r.ok) {
    usage.input += r.inputTokens;
    usage.output += r.outputTokens;
  }
  if (!r.ok || !r.text) {
    await finish();
    return { status: "unavailable", reason: r.ok ? (r.blocked ? `Gemini blocked the question (${r.blocked}).` : "Gemini gave an empty answer.") : r.error, prompt };
  }

  const x = await askGemini(extractionPrompt(r.text, label, terms.host), { jsonSchema: EXTRACTION_SCHEMA, maxOutputTokens: EXTRACTION_MAX_TOKENS });
  requests += x.requests;
  if (x.ok) {
    usage.input += x.inputTokens;
    usage.output += x.outputTokens;
  }
  await finish();
  const a = combineAnalysis(r.text, terms, x.ok ? parseExtraction(x.text) : null);
  const problem = a.method === "failed" ? extractionProblem(x.ok ? { ok: true, text: x.text, finishReason: x.finishReason } : { ok: false, error: x.error }) : null;
  return { status: "ok", model: GEMINI_MODEL, prompt, answer: r.text, mentioned: a.mentioned, competitors: a.competitors, method: a.method, ...(problem ? { extractionError: problem } : {}) };
}

// Two questions per domain (each followed by a small extraction request): a general one about what the store sells,
// without its name, and "Does Gemini know this store?" by domain. Once per domain per 24 h.
async function geminiParts(admin: SupabaseClient, origin: string, host: string, homeHtml: string | null, usage: Usage): Promise<GeminiParts> {
  const terms = brandTerms(registrableDomain(host).split(".")[0], origin);
  const topic = homeHtml ? topicFromHome(homeHtml, terms.keys ?? []) : null;
  const visPrompt = topic ? visibilityQuestion(topic) : "";
  const knowPrompt = knowledgeQuestion(host);
  const off = (reason: string): GeminiParts => ({ visibility: { status: "unavailable", reason, prompt: visPrompt }, knowledge: { status: "unavailable", reason, prompt: knowPrompt } });

  if (!geminiConfigured()) return off("The Gemini check is not set up on this server.");
  const { data: recent } = await admin.from("public_reports").select("created_at").eq("host", host).gt("gemini_requests", 0).order("created_at", { ascending: false }).limit(1);
  if (!geminiAllowedForDomain(recent?.[0]?.created_at ?? null, new Date())) return off("Gemini was already asked about this domain in the last 24 hours.");

  const visibility: GeminiPart = topic
    ? await ask(admin, usage, visPrompt, terms, host)
    : {
        status: "unavailable",
        reason: homeHtml
          ? "Could not tell from the home page what the store sells, so no general question was asked."
          : "The home page could not be read (bot protection, error or placeholder page), so there is no reliable topic and no general question was asked.",
        prompt: "",
      };
  const knowledge = await ask(admin, usage, knowPrompt, terms, host);
  return { visibility, knowledge };
}

// Runs one public check: at most 10 HTTP requests to the store, plus up to 2 Gemini requests.
export async function runPublicScan(admin: SupabaseClient, origin: string, host: string): Promise<{ report: PublicReport; usage: Usage; requests: number }> {
  const fetcher = new PublicFetcher();
  const usage: Usage = { geminiRequests: 0, input: 0, output: 0 };

  const robotsFetch = await fetcher.get(`${origin}/robots.txt`, PUBLIC_UA);
  const llms = await fetcher.get(`${origin}/llms.txt`, PUBLIC_UA);
  const { robots } = robotsFrom(robotsFetch);

  const input: PublicScanInput = {
    url: `${origin}/`,
    host,
    checkedAt: new Date().toISOString(),
    requests: 0,
    robots: robotsFetch,
    llms,
    home: null,
    bots: {},
    products: [],
    productSource: "none",
    gemini: { visibility: { status: "unavailable", reason: "not run", prompt: "" }, knowledge: { status: "unavailable", reason: "not run", prompt: "" } },
  };

  if (agentScopeAllowed(robots, "/")) {
    const home = await fetcher.get(`${origin}/`, PUBLIC_UA);
    input.home = home;
    // Skip bots and product pages when the home page is a placeholder or a bot-protection page: they would only see it too.
    if (home.ok && trustedHomeHtml(home) !== null) {
      for (const bot of ACCESS_BOTS) input.bots[bot] = await fetcher.get(`${origin}/`, UA[bot]);

      let urls: string[] = [];
      if (detectShopify(home.body, home.shopifyHeader)) {
        // Shopify: the public product list (1 request, first 10 products, no pagination), then product pages.
        input.shopifyProducts = agentScopeAllowed(robots, "/products.json") ? await fetcher.get(`${origin}/products.json?limit=${SHOPIFY_PRODUCTS_LIMIT}`, PUBLIC_UA) : null;
        urls = shopifyProductLinks(home.body, home.finalUrl);
        if (urls.length) input.productSource = "home page links";
        else {
          const sp = input.shopifyProducts;
          const list = sp?.ok && sp.status === 200 ? checkShopifyProducts(sp.body, origin) : null;
          if (list?.status === "ok" && list.handles.length) {
            urls = list.handles.slice(0, 2).map((h) => `${origin}/products/${h}`);
            input.productSource = "products.json";
          } else if (fetcher.remaining >= 3) {
            const index = await fetcher.get(`${origin}/sitemap.xml`, PUBLIC_UA);
            const productsMap = index.ok && index.status === 200 ? shopifyProductSitemap(index.body, home.finalUrl) : null;
            const sitemap = productsMap ? await fetcher.get(productsMap, PUBLIC_UA) : null;
            urls = sitemap?.ok && sitemap.status === 200 ? sitemapProductUrls(sitemap.body, home.finalUrl, 2, "shopify") : [];
            if (urls.length) input.productSource = "sitemap";
          }
        }
      } else {
        urls = productLinks(home.body, home.finalUrl);
        if (urls.length) input.productSource = "home page links";
        else if (fetcher.remaining >= 2) {
          const sitemap = await fetcher.get(productSitemapUrl(robots?.sitemaps ?? [], origin), PUBLIC_UA);
          urls = sitemap.ok && sitemap.status === 200 ? sitemapProductUrls(sitemap.body, home.finalUrl) : [];
          if (urls.length) input.productSource = "sitemap";
        }
      }
      for (const url of urls.filter((u) => agentScopeAllowed(robots, new URL(u).pathname))) {
        if (fetcher.remaining < 1) break;
        input.products.push({ url, fetch: await fetcher.get(url, PUBLIC_UA) });
      }
    }
  }

  input.gemini = await geminiParts(admin, origin, host, trustedHomeHtml(input.home), usage);
  input.requests = fetcher.requests;
  return { report: buildPublicReport(input), usage, requests: fetcher.requests };
}
