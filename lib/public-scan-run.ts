import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { AI_BOTS } from "./access";
import { pageGate } from "./gate";
import { askGemini, GEMINI_MODEL, geminiConfigured } from "./gemini";
import { PublicFetcher } from "./public-fetch";
import {
  ACCESS_BOTS, agentScopeAllowed, buildPublicReport, geminiAllowedForDomain, LIMITS, productLinks, productSitemapUrl, PUBLIC_UA,
  robotsFrom, sitemapProductUrls, type GeminiPart, type PublicReport, type PublicScanInput,
} from "./public-scan";
import { brandTerms, combineAnalysis, EXTRACTION_SCHEMA, extractionPrompt, parseExtraction } from "./visibility";

const UA = Object.fromEntries(AI_BOTS.map((b) => [b.name, b.ua])) as Record<string, string>;

type Usage = { geminiRequests: number; input: number; output: number };

async function geminiPart(admin: SupabaseClient, origin: string, host: string, usage: Usage): Promise<GeminiPart> {
  const prompt = `What do you know about the online store ${host}? Which similar stores would you recommend?`;
  if (!geminiConfigured()) return { status: "unavailable", reason: "The Gemini check is not set up on this server.", prompt };

  const { data: recent } = await admin.from("public_reports").select("created_at").eq("host", host).gt("gemini_requests", 0).order("created_at", { ascending: false }).limit(1);
  if (!geminiAllowedForDomain(recent?.[0]?.created_at ?? null, new Date())) {
    return { status: "unavailable", reason: "Gemini was already asked about this domain in the last 24 hours.", prompt };
  }
  const { data: reserved } = await admin.rpc("public_gemini_reserve", { p_limit: LIMITS.geminiPerDay });
  if (!reserved) return { status: "unavailable", reason: "Daily limit reached for free Gemini checks. Try again tomorrow.", prompt };

  const r = await askGemini(prompt);
  usage.geminiRequests += r.requests;
  if (!r.ok || !r.text) return { status: "unavailable", reason: r.ok ? (r.blocked ? `Gemini blocked the question (${r.blocked}).` : "Gemini gave an empty answer.") : r.error, prompt };
  usage.input += r.inputTokens;
  usage.output += r.outputTokens;

  const terms = brandTerms(host.split(".")[0], origin);
  const x = await askGemini(extractionPrompt(r.text, host, terms.host), { jsonSchema: EXTRACTION_SCHEMA, maxOutputTokens: 512 });
  usage.geminiRequests += x.requests;
  if (x.ok) {
    usage.input += x.inputTokens;
    usage.output += x.outputTokens;
  }
  const a = combineAnalysis(r.text, terms, x.ok ? parseExtraction(x.text) : null);
  return { status: "ok", model: GEMINI_MODEL, prompt, answer: r.text, mentioned: a.mentioned, competitors: a.competitors, method: a.method };
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
    gemini: { status: "unavailable", reason: "not run", prompt: "" },
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

  input.gemini = await geminiPart(admin, origin, host, usage);
  input.requests = fetcher.requests;
  return { report: buildPublicReport(input), usage, requests: fetcher.requests };
}
