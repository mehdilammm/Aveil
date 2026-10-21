import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { AI_BOTS } from "./access";
import { pageGate } from "./gate";
import { askGemini, GEMINI_MODEL, geminiConfigured } from "./gemini";
import { PublicFetcher } from "./public-fetch";
import {
  ACCESS_BOTS, knowledgeQuestion, topicFromHome, visibilityQuestion, type GeminiParts, agentScopeAllowed, buildPublicReport, geminiAllowedForDomain, LIMITS, productLinks, productSitemapUrl, PUBLIC_UA,
  robotsFrom, sitemapProductUrls, type GeminiPart, type PublicReport, type PublicScanInput,
} from "./public-scan";
import { brandTerms, combineAnalysis, EXTRACTION_SCHEMA, extractionPrompt, parseExtraction, registrableDomain } from "./visibility";

const UA = Object.fromEntries(AI_BOTS.map((b) => [b.name, b.ua])) as Record<string, string>;

type Usage = { geminiRequests: number; input: number; output: number };

// Reserves one request in the app-wide daily Gemini budget, then asks; extra retries are counted too.
async function askCounted(admin: SupabaseClient, usage: Usage, prompt: string, options?: Parameters<typeof askGemini>[1]) {
  const { data: reserved } = await admin.rpc("public_gemini_reserve", { p_limit: LIMITS.geminiPerDay });
  if (!reserved) return null;
  const r = await askGemini(prompt, options);
  usage.geminiRequests += r.requests;
  for (let i = 1; i < r.requests; i++) await admin.rpc("public_gemini_reserve", { p_limit: LIMITS.geminiPerDay });
  if (r.ok) {
    usage.input += r.inputTokens;
    usage.output += r.outputTokens;
  }
  return r;
}

const LIMIT_REASON = "Daily limit reached for free Gemini checks. Try again tomorrow.";

async function ask(admin: SupabaseClient, usage: Usage, prompt: string, terms: ReturnType<typeof brandTerms>, label: string): Promise<GeminiPart> {
  const r = await askCounted(admin, usage, prompt);
  if (!r) return { status: "unavailable", reason: LIMIT_REASON, prompt };
  if (!r.ok || !r.text) return { status: "unavailable", reason: r.ok ? (r.blocked ? `Gemini blocked the question (${r.blocked}).` : "Gemini gave an empty answer.") : r.error, prompt };
  const x = await askCounted(admin, usage, extractionPrompt(r.text, label, terms.host), { jsonSchema: EXTRACTION_SCHEMA, maxOutputTokens: 512 });
  const a = combineAnalysis(r.text, terms, x?.ok ? parseExtraction(x.text) : null);
  return { status: "ok", model: GEMINI_MODEL, prompt, answer: r.text, mentioned: a.mentioned, competitors: a.competitors, method: a.method };
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
    : { status: "unavailable", reason: "Could not tell from the home page what the store sells, so no general question was asked.", prompt: "" };
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
    const gate = home.ok ? pageGate(home) : null;
    if (home.ok && home.status >= 200 && home.status < 300 && !gate) {
      for (const bot of ACCESS_BOTS) input.bots[bot] = await fetcher.get(`${origin}/`, UA[bot]);

      let urls = productLinks(home.body, home.finalUrl);
      if (urls.length) input.productSource = "home page links";
      else if (fetcher.remaining >= 2) {
        const sitemap = await fetcher.get(productSitemapUrl(robots?.sitemaps ?? [], origin), PUBLIC_UA);
        urls = sitemap.ok && sitemap.status === 200 ? sitemapProductUrls(sitemap.body, home.finalUrl) : [];
        if (urls.length) input.productSource = "sitemap";
      }
      for (const url of urls.filter((u) => agentScopeAllowed(robots, new URL(u).pathname))) {
        if (fetcher.remaining < 1) break;
        input.products.push({ url, fetch: await fetcher.get(url, PUBLIC_UA) });
      }
    }
  }

  input.gemini = await geminiParts(admin, origin, host, input.home?.ok ? input.home.body : null, usage);
  input.requests = fetcher.requests;
  return { report: buildPublicReport(input), usage, requests: fetcher.requests };
}
