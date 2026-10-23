// Agent access check: loads the same pages as a normal browser and as known AI bots (by User-Agent only)
// and compares the answers. Real bots can be treated differently (for example by IP verification),
// so every finding here is heuristic.
import { pageGate } from "./gate";
import type { Finding } from "./rules";
import type { PageFetch } from "./woo";

export const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36";

export const AI_BOTS = [
  { name: "GPTBot", ua: "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; GPTBot/1.1; +https://openai.com/gptbot)" },
  { name: "OAI-SearchBot", ua: "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; OAI-SearchBot/1.0; +https://openai.com/searchbot)" },
  { name: "ChatGPT-User", ua: "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; ChatGPT-User/1.0; +https://openai.com/bot" },
  { name: "ClaudeBot", ua: "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; ClaudeBot/1.0; +claudebot@anthropic.com)" },
  { name: "PerplexityBot", ua: "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; PerplexityBot/1.0; +https://perplexity.ai/perplexitybot)" },
  // Anthropic's search crawler and its user-triggered fetcher (https://support.anthropic.com, "Does Anthropic crawl data from the web").
  { name: "Claude-SearchBot", ua: "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; Claude-SearchBot/1.0; +Claude-SearchBot@anthropic.com)" },
  { name: "Claude-User", ua: "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; Claude-User/1.0; +Claude-User@anthropic.com)" },
] as const;

export type BotName = (typeof AI_BOTS)[number]["name"];

export const ACCESS_NOTE =
  "This test only changes the User-Agent. Real AI bots can be treated differently, for example when a firewall verifies their IP addresses.";

// Which bots load which page. 10 requests in total: home page with every bot, two product pages with the shopping agents.
export function accessPlan(homeUrl: string, productUrls: string[]): { label: string; url: string; bots: BotName[] }[] {
  const plan: { label: string; url: string; bots: BotName[] }[] = [
    { label: "home page", url: homeUrl, bots: AI_BOTS.map((b) => b.name) },
  ];
  const productBots: BotName[] = ["ChatGPT-User", "OAI-SearchBot"];
  productUrls.slice(0, 2).forEach((url, i) => plan.push({ label: `product page ${i + 1}`, url, bots: [productBots[i]] }));
  return plan;
}

export const requestCount = (plan: ReturnType<typeof accessPlan>) => plan.reduce((n, p) => n + 1 + p.bots.length, 0);

// Challenge page markers. Not "challenge-platform" or cf-ray: Cloudflare adds those to normal pages too.
export const CHALLENGE_RE = /cf-chl-bypass|cf_chl_opt|__cf_chl_|<title>\s*just a moment|attention required!? \| cloudflare|px-captcha|_incapsula_resource|sgcaptcha|captcha-delivery|verify you are human|<title>\s*access denied/i;
// Only these mean "blocked". 429 is rate limiting (often from our own requests in a row), not a block.
export const BLOCK_STATUS = new Set([401, 403]);

// Wait before the one retry after a 429: Retry-After in seconds or as a date, kept between 1 and 10 seconds.
export function retryAfterMs(header: string | null | undefined, now = Date.now()): number {
  const fallback = 3000;
  if (!header) return fallback;
  const seconds = Number(header.trim());
  const ms = Number.isFinite(seconds) ? seconds * 1000 : Date.parse(header) - now;
  return Number.isFinite(ms) ? Math.min(10_000, Math.max(1000, ms)) : fallback;
}

// gate: set when the page is closed to visitors (Coming soon / maintenance); the bots are then not compared.
export type PageResult = { label: string; url: string; browser: PageFetch; bots: Partial<Record<BotName, PageFetch>>; gate?: string };

type Issue = { severity: "high" | "medium"; text: string; rateLimited?: boolean };

// Why the browser request cannot serve as a baseline, or null when it can.
function baselineProblem(b: PageFetch, gateReason?: string): string | null {
  if (gateReason) return gateReason;
  if (!b.ok) return b.error;
  if (b.redirectedTo) return `redirected to ${b.redirectedTo}`;
  const gate = pageGate(b);
  if (gate) return gate.reason;
  if (b.status < 200 || b.status >= 300) return `HTTP ${b.status}`;
  return null;
}

function compare(page: PageResult, bot: PageFetch, base: string, retried: boolean): Issue | null {
  const b = page.browser;
  if (!b.ok || baselineProblem(b, page.gate)) return null; // no baseline
  const browserChallenged = b.challengeHeader || CHALLENGE_RE.test(b.body);
  // Never a finding for a request that was not made (request limit): that is "not checked", not a problem.
  if (!bot.ok && bot.skipped) return null;
  if (!bot.ok) return { severity: "medium", text: `${page.label}: no answer (${bot.error}), ${base} got ${b.status}` };
  if (bot.status === 429) return { severity: "medium", rateLimited: true, text: `${page.label}: HTTP 429 (rate-limited)${retried ? " even after one retry" : ""}, ${base} got ${b.status}` };
  if (BLOCK_STATUS.has(bot.status)) return { severity: "high", text: `${page.label}: HTTP ${bot.status}, ${base} got ${b.status}` };
  if (bot.challengeHeader || (!browserChallenged && CHALLENGE_RE.test(bot.body))) {
    return { severity: "high", text: `${page.label}: challenge or captcha page (HTTP ${bot.status}), ${base} got the real page` };
  }
  if (bot.redirectedTo) return { severity: "medium", text: `${page.label}: redirected to ${bot.redirectedTo}, ${base} was not` };
  if (bot.status >= 400) return { severity: "medium", text: `${page.label}: HTTP ${bot.status}, ${base} got ${b.status}` };
  if (b.bytes > 5000 && bot.bytes < b.bytes * 0.3) {
    return { severity: "medium", text: `${page.label}: page is ${Math.round(bot.bytes / 1024)} KB, ${base} got ${Math.round(b.bytes / 1024)} KB` };
  }
  return null;
}

// baseline: how the comparison request is described; retried: whether a 429 was already retried once.
export function checkAccess(storeUrl: string, pages: PageResult[], opts: { baseline?: string; retried?: boolean } = {}): Finding[] {
  const base = opts.baseline ?? "the browser";
  const retried = opts.retried ?? true;
  const findings: Finding[] = [];

  for (const p of pages) {
    const why = baselineProblem(p.browser, p.gate);
    if (!why) continue;
    findings.push({
      finding_key: `access:baseline:${p.label}`,
      type: "access_check_unavailable",
      product_id: null,
      title: `Could not test AI access on the ${p.label}`,
      severity: "low",
      basis: "unavailable",
      evidence: `A normal browser request to ${p.url} did not get the real page: ${why}. Without a working baseline the bots cannot be compared.`,
      guidance: "Check that the page loads for visitors. The next scan will try again.",
      fix_url: p.url,
    });
  }

  for (const bot of AI_BOTS) {
    const issues = pages.flatMap((p) => {
      const result = p.bots[bot.name];
      const issue = result ? compare(p, result, base, retried) : null;
      return issue ? [issue] : [];
    });
    if (!issues.length) continue;
    const blocked = issues.some((i) => i.severity === "high");
    const onlyRateLimited = issues.every((i) => i.rateLimited);
    findings.push({
      finding_key: `access:${bot.name}`,
      type: blocked ? "access_blocked" : onlyRateLimited ? "access_rate_limited" : "access_degraded",
      product_id: null,
      title: blocked ? `AI agents are blocked: ${bot.name}` : onlyRateLimited ? `Rate-limited for this bot: ${bot.name}` : `${bot.name} gets a different page`,
      severity: blocked ? "high" : "medium",
      basis: "heuristic",
      evidence: `${issues.map((i) => i.text).join("; ")}. ${ACCESS_NOTE}`,
      guidance: blocked
        ? `Allow ${bot.name} in your firewall, security plugin or CDN bot settings (for example Cloudflare → Security → Bots, Wordfence, or your host's bot protection). Then rescan.`
        : onlyRateLimited
          ? `Our test requests were spaced out and retried once. If ${bot.name} keeps getting 429, raise its rate limit in your security plugin or CDN.`
          : `Check your caching, security or CDN rules for ${bot.name}, then rescan.`,
      fix_url: storeUrl,
    });
  }
  return findings;
}
