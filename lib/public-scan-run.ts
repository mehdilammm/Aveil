import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { AI_BOTS } from "./access";
import { emptyUsage, extractNames } from "./engines";
import { askGemini, GEMINI_MODEL, geminiConfigured } from "./gemini";
import { askMistral, MISTRAL_MODEL, mistralConfigured } from "./mistral";
import { PublicFetcher } from "./public-fetch";
import { checkShopifyProducts, detectShopify, SHOPIFY_PRODUCTS_LIMIT, shopifyProductLinks, shopifyProductSitemap } from "./shopify";
import { checkStoreApiProducts, STORE_API_PATH } from "./woo-store-api";
import {
  ACCESS_BOTS, detectPlatform, knowledgeQuestion, titleTopic, topicPrompt, trustedHomeHtml, topicFromHome, validateTopic, visibilityQuestion, type GeminiParts, type Topic, agentScopeAllowed, buildPublicReport, geminiAllowedForDomain, LIMITS, productLinks, productSitemapUrl, PUBLIC_UA,
  robotsFrom, sitemapProductUrls, type GeminiPart, type PublicReport, type PublicScanInput,
} from "./public-scan";
import { brandTerms, combineAnalysis, EXTRACTION_MAX_TOKENS, EXTRACTION_SCHEMA, extractionPrompt, extractionProblem, parseExtraction, registrableDomain } from "./visibility";

const UA = Object.fromEntries(AI_BOTS.map((b) => [b.name, b.ua])) as Record<string, string>;

type Usage = { geminiRequests: number; input: number; output: number; mistral: { requests: number; input: number; output: number } };

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

const MISTRAL_LIMIT_REASON = "Daily limit reached for free Mistral checks. Try again tomorrow.";

// The general question to Mistral: 2 requests reserved in the app-wide daily Mistral budget (question + extraction).
// Mistral extracts names from its own answer (json_schema); if that fails, Gemini does (recorded as extractor).
async function askMistralPart(admin: SupabaseClient, usage: Usage, prompt: string, terms: ReturnType<typeof brandTerms>, label: string): Promise<GeminiPart> {
  if (!mistralConfigured()) return { status: "unavailable", reason: "The Mistral check is not set up on this server.", prompt, engine: "mistral" };
  const { data: reserved } = await admin.rpc("public_mistral_reserve_n", { p_limit: LIMITS.geminiPerDay, p_n: 2 });
  if (!reserved) return { status: "unavailable", reason: MISTRAL_LIMIT_REASON, prompt, engine: "mistral" };

  const r = await askMistral(prompt);
  usage.mistral.requests += r.requests;
  if (r.ok) {
    usage.mistral.input += r.inputTokens;
    usage.mistral.output += r.outputTokens;
  }
  const waitNote = (ms: number) => (ms > 0 ? `Waited ${(ms / 1000).toFixed(1)} s for Mistral's rate limit.` : undefined);
  if (!r.ok || !r.text) {
    if (r.requests > 2) await admin.rpc("public_mistral_record", { p_n: r.requests - 2 });
    return { status: "unavailable", reason: r.ok ? "Mistral gave an empty answer." : r.error, prompt, engine: "mistral", note: waitNote(r.waitedMs ?? 0) };
  }
  const x = emptyUsage();
  const extracted = await extractNames("mistral", r.text, terms, label, x);
  usage.mistral.requests += x.mistral.requests;
  usage.mistral.input += x.mistral.input;
  usage.mistral.output += x.mistral.output;
  usage.geminiRequests += x.gemini.requests;
  usage.input += x.gemini.input;
  usage.output += x.gemini.output;
  const extra = r.requests + x.mistral.requests - 2;
  if (extra > 0) await admin.rpc("public_mistral_record", { p_n: extra });
  if (x.gemini.requests) await admin.rpc("public_gemini_record", { p_n: x.gemini.requests });
  const a = extracted.analysis;
  return {
    status: "ok",
    engine: "mistral",
    model: MISTRAL_MODEL,
    prompt,
    answer: r.text,
    mentioned: a.mentioned,
    competitors: a.competitors,
    method: a.method,
    extractor: extracted.extractor,
    note: waitNote((r.waitedMs ?? 0) + (x.mistral.waitedMs ?? 0)),
    ...(extracted.problem && a.method === "failed" ? { extractionError: extracted.problem } : {}),
  };
}

// What the store sells, for the general question: a short phrase from Gemini (title, description and full category
// names as input), checked to be 2-8 words without the brand; else the title without the brand; else category links.
async function buildTopic(admin: SupabaseClient, html: string, brandKeys: string[], usage: Usage): Promise<Topic | null> {
  const prompt = topicPrompt(html);
  if (prompt && geminiConfigured()) {
    const { data: reserved } = await admin.rpc("public_gemini_reserve_n", { p_limit: LIMITS.geminiPerDay, p_n: 1 });
    if (reserved) {
      const r = await askGemini(prompt, { maxOutputTokens: 60 });
      usage.geminiRequests += r.requests;
      if (r.requests > 1) await admin.rpc("public_gemini_record", { p_n: r.requests - 1 });
      if (r.ok) {
        usage.input += r.inputTokens;
        usage.output += r.outputTokens;
        const text = validateTopic(r.text, brandKeys);
        if (text) return { text, source: "gemini" };
      }
    }
  }
  const fromTitle = titleTopic(html, brandKeys);
  if (fromTitle) return { text: fromTitle, source: "title" };
  const fromLinks = topicFromHome(html, brandKeys);
  return fromLinks ? { text: fromLinks, source: "category links" } : null;
}

// Two questions per domain (each followed by a small extraction request): a general one about what the store sells,
// without its name, and "Does Gemini know this store?" by domain. Once per domain per 24 h.
async function geminiParts(admin: SupabaseClient, origin: string, host: string, homeHtml: string | null, usage: Usage): Promise<GeminiParts> {
  const terms = brandTerms(registrableDomain(host).split(".")[0], origin);
  const topicInfo = homeHtml ? await buildTopic(admin, homeHtml, terms.keys ?? [], usage) : null;
  const topic = topicInfo?.text ?? null;
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

  // Mistral gets the general question only (the visibility signal), once per domain per 24 h.
  let visibilityMistral: GeminiPart;
  if (!topic) visibilityMistral = { status: "unavailable", reason: visibility.status === "unavailable" ? visibility.reason : "not asked", prompt: "", engine: "mistral" };
  else {
    const { data: recentMistral } = await admin.from("public_reports").select("created_at").eq("host", host).gt("mistral_requests", 0).order("created_at", { ascending: false }).limit(1);
    visibilityMistral = geminiAllowedForDomain(recentMistral?.[0]?.created_at ?? null, new Date())
      ? await askMistralPart(admin, usage, visPrompt, terms, host)
      : { status: "unavailable", reason: "Mistral was already asked about this domain in the last 24 hours.", prompt: visPrompt, engine: "mistral" };
  }
  return { visibility, knowledge, visibilityMistral, topic: topicInfo };
}

// Runs one public check: at most 10 HTTP requests to the store, plus up to 2 Gemini requests.
export async function runPublicScan(
  admin: SupabaseClient,
  origin: string,
  host: string,
  fetcher: PublicFetcher = new PublicFetcher(),
): Promise<{ report: PublicReport; usage: Usage; requests: number }> {
  const usage: Usage = { geminiRequests: 0, input: 0, output: 0, mistral: { requests: 0, input: 0, output: 0 } };

  // Order by importance, so the request limit only ever drops the least useful checks:
  // robots.txt (read first so a block on AgentScopeBot is obeyed before any page is loaded) → home page →
  // product list or sitemap → product page 1 → GPTBot → ClaudeBot → PerplexityBot → OAI-SearchBot → llms.txt → product page 2.
  const robotsFetch = await fetcher.get(`${origin}/robots.txt`, PUBLIC_UA, "robots.txt");
  const { robots } = robotsFrom(robotsFetch);

  const input: PublicScanInput = {
    url: `${origin}/`,
    host,
    checkedAt: new Date().toISOString(),
    requests: 0,
    robots: robotsFetch,
    llms: null,
    home: null,
    bots: {},
    products: [],
    productSource: "none",
    gemini: { visibility: { status: "unavailable", reason: "not run", prompt: "" }, knowledge: { status: "unavailable", reason: "not run", prompt: "" } },
  };

  if (agentScopeAllowed(robots, "/")) {
    const home = await fetcher.get(`${origin}/`, PUBLIC_UA, "home page");
    input.home = home;
    // Skip bots and product pages when the home page is a placeholder or a bot-protection page: they would only see it too.
    if (home.ok && trustedHomeHtml(home) !== null) {
      const site = new URL(home.finalUrl).origin;
      let urls: string[] = [];
      if (detectShopify(home.body, home.shopifyHeader)) {
        // Shopify: the public product list (1 request, first 10 products, no pagination).
        input.shopifyProducts = agentScopeAllowed(robots, "/products.json")
          ? await fetcher.get(`${site}/products.json?limit=${SHOPIFY_PRODUCTS_LIMIT}`, PUBLIC_UA, "Shopify product list (/products.json)")
          : null;
        urls = shopifyProductLinks(home.body, home.finalUrl);
        if (urls.length) input.productSource = "home page links";
        else {
          const sp = input.shopifyProducts;
          const list = sp?.ok && sp.status === 200 ? checkShopifyProducts(sp.body, site) : null;
          if (list?.status === "ok" && list.handles.length) {
            urls = list.handles.slice(0, 2).map((h) => `${site}/products/${h}`);
            input.productSource = "products.json";
          } else {
            const index = await fetcher.get(`${site}/sitemap.xml`, PUBLIC_UA, "sitemap index");
            const productsMap = index.ok && index.status === 200 ? shopifyProductSitemap(index.body, home.finalUrl) : null;
            const sitemap = productsMap ? await fetcher.get(productsMap, PUBLIC_UA, "product sitemap") : null;
            urls = sitemap?.ok && sitemap.status === 200 ? sitemapProductUrls(sitemap.body, home.finalUrl, 2, "shopify") : [];
            if (urls.length) input.productSource = "sitemap";
          }
        }
      } else {
        urls = productLinks(home.body, home.finalUrl);
        if (urls.length) input.productSource = "home page links";
        else if (detectPlatform(home.body, home.shopifyHeader).woocommerce && agentScopeAllowed(robots, "/wp-json/wc/store/v1/products")) {
          // WooCommerce without /product/ links: the public Store API lists products (1 request, 10 products).
          input.wooStoreApi = await fetcher.get(`${site}${STORE_API_PATH}`, PUBLIC_UA, "WooCommerce Store API (products)");
          const w = input.wooStoreApi;
          const list = w.ok && w.status === 200 ? checkStoreApiProducts(w.body) : null;
          if (list?.status === "ok" && list.permalinks.length) {
            urls = list.permalinks.filter((u) => {
              try {
                return new URL(u).hostname.replace(/^www\./, "") === new URL(site).hostname.replace(/^www\./, "");
              } catch {
                return false;
              }
            });
            if (urls.length) input.productSource = "Store API";
          }
        }
        if (!urls.length && input.productSource === "none") {
          const sitemap = await fetcher.get(productSitemapUrl(robots?.sitemaps ?? [], site), PUBLIC_UA, "product sitemap");
          urls = sitemap.ok && sitemap.status === 200 ? sitemapProductUrls(sitemap.body, home.finalUrl) : [];
          if (urls.length) input.productSource = "sitemap";
        }
      }
      const productUrls = urls.filter((u) => agentScopeAllowed(robots, new URL(u).pathname)).slice(0, 2);

      if (productUrls[0]) input.products.push({ url: productUrls[0], fetch: await fetcher.get(productUrls[0], PUBLIC_UA, "product page 1") });
      for (const bot of ACCESS_BOTS) input.bots[bot] = await fetcher.get(`${site}/`, UA[bot], `home page as ${bot}`);
      if (agentScopeAllowed(robots, "/llms.txt")) input.llms = await fetcher.get(`${site}/llms.txt`, PUBLIC_UA, "llms.txt");
      if (productUrls[1]) input.products.push({ url: productUrls[1], fetch: await fetcher.get(productUrls[1], PUBLIC_UA, "product page 2") });
    } else if (agentScopeAllowed(robots, "/llms.txt")) {
      input.llms = await fetcher.get(`${origin}/llms.txt`, PUBLIC_UA, "llms.txt");
    }
  }

  input.gemini = await geminiParts(admin, origin, host, trustedHomeHtml(input.home), usage);
  input.requests = fetcher.requests;
  input.requestLog = fetcher.log;
  return { report: buildPublicReport(input), usage, requests: fetcher.requests };
}
