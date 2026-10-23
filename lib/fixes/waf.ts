// Firewall / bot protection guidance to copy (AgentScope changes nothing). Built from what the scan saw: which
// protection answered (response headers) and which AI bots were blocked, challenged or rate-limited.
import { SEARCH_AGENTS } from "./robots-patch";

export type WafInput = { vendor: string | null; blocked: string[]; rateLimited: string[]; challenged: string[] };
export type WafGuide = { vendor: string; steps: string[]; verifyLists: string[] };

export const OFFICIAL_LISTS = [
  "OpenAI: https://openai.com/gptbot.json, https://openai.com/searchbot.json, https://openai.com/chatgpt-user.json",
  "Anthropic: https://claude.com/crawling/bots.json",
  "Perplexity: https://www.perplexity.com/perplexitybot.json, https://www.perplexity.com/perplexity-user.json",
  "Google: https://developers.google.com/static/search/apis/ipranges/googlebot.json",
];

export function wafGuide(i: WafInput): WafGuide {
  const affected = [...new Set([...i.blocked, ...i.challenged, ...i.rateLimited])];
  const who = affected.length ? affected.join(", ") : SEARCH_AGENTS.join(", ");
  const steps: string[] = [];
  if (i.vendor === "Cloudflare") {
    steps.push(
      `Security → Bots: if "Block AI bots" (or AI Crawl Control) is on, allow the agents you want: ${who}.`,
      "Bot Fight Mode can challenge verified bots and cannot be skipped by rules. If agents were challenged, turn it off, or on a paid plan use Super Bot Fight Mode with \"Verified bots\" allowed.",
      "Security → WAF → Custom rules: add a rule \"Skip\" (all remaining custom rules, rate limiting and managed rules) for the expression (cf.client.bot) so verified bots pass; keep it above your blocking rules.",
    );
  } else if (i.vendor) {
    steps.push(`Your site answers through ${i.vendor}. In its bot or firewall settings, allow these user agents only when their IP is in the official lists below: ${who}.`);
  } else {
    steps.push(`No firewall vendor was recognised from the response headers. Check your host's security panel and any security plugin (rate limits, "block bad bots", country blocks) for rules that stop: ${who}.`);
  }
  if (i.rateLimited.length) steps.push(`${i.rateLimited.join(", ")} got HTTP 429. Raise the rate limit for these agents (a few requests a minute is normal), rather than blocking them.`);
  steps.push("Allow by IP list, not by user agent alone: anyone can send a bot's user agent. Keep your limits for everything else.");
  steps.push("Then run a new scan: the access test checks again with each bot's user agent.");
  return { vendor: i.vendor ?? "not recognised", steps, verifyLists: OFFICIAL_LISTS };
}
