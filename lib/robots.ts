// robots.txt parsing (RFC 9309) and the AI bot checks built on it.
import { AI_BOTS, type BotName } from "./access";
import type { Source } from "./pages";
import type { Finding, Severity } from "./rules";

type Rule = { allow: boolean; pattern: string };
type Group = { agents: string[]; rules: Rule[] };
export type Robots = { groups: Group[]; sitemaps: string[] };

export function parseRobots(text: string): Robots {
  const groups: Group[] = [];
  const sitemaps: string[] = [];
  let current: Group | null = null;
  let lastWasAgent = false;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, "").trim();
    const m = /^([A-Za-z-]+)\s*:\s*(.*)$/.exec(line);
    if (!m) continue;
    const key = m[1].toLowerCase();
    const value = m[2].trim();
    if (key === "user-agent") {
      if (!current || !lastWasAgent) {
        current = { agents: [], rules: [] };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
      lastWasAgent = true;
      continue;
    }
    lastWasAgent = false;
    if (key === "sitemap" && value) sitemaps.push(value);
    else if ((key === "allow" || key === "disallow") && current && value) current.rules.push({ allow: key === "allow", pattern: value });
  }
  return { groups, sitemaps };
}

function matches(pattern: string, path: string): boolean {
  const anchored = pattern.endsWith("$");
  const body = (anchored ? pattern.slice(0, -1) : pattern).split("*").map((s) => s.replace(/[.+?^${}()|[\]\\]/g, "\\$&")).join(".*");
  return new RegExp(`^${body}${anchored ? "$" : ""}`).test(path);
}

// True when the bot may fetch the path. Groups naming the bot win over "*"; the longest matching rule wins, allow on ties.
export function isAllowed(robots: Robots, bot: string, path: string): boolean {
  const token = bot.toLowerCase();
  const specific = robots.groups.filter((g) => g.agents.includes(token));
  const groups = specific.length ? specific : robots.groups.filter((g) => g.agents.includes("*"));
  let best: Rule | null = null;
  for (const rule of groups.flatMap((g) => g.rules)) {
    if (!matches(rule.pattern, path)) continue;
    const len = rule.pattern.replace(/\$$/, "").length;
    const bestLen = best ? best.pattern.replace(/\$$/, "").length : -1;
    if (len > bestLen || (len === bestLen && rule.allow)) best = rule;
  }
  return best ? best.allow : true;
}

// Bots that fetch pages for a live user or for search results matter most for shopping.
const BOT_SEVERITY: Record<BotName, Severity> = {
  "ChatGPT-User": "high",
  "OAI-SearchBot": "high",
  PerplexityBot: "high",
  "Claude-SearchBot": "high",
  "Claude-User": "high",
  GPTBot: "medium",
  ClaudeBot: "medium",
};

export type RobotsFetch = { status: number; text: string };

export function checkRobots(storeUrl: string, robots: Source<RobotsFetch>, productPath: string | null): Finding[] {
  const robotsUrl = `${storeUrl}/robots.txt`;
  const base = (key: string, type: string, f: Omit<Finding, "finding_key" | "type" | "product_id">): Finding => ({ finding_key: key, type, product_id: null, ...f });

  if (!robots.ok) {
    return [base("robots:unavailable", "robots_unavailable", {
      title: "Could not read robots.txt",
      severity: "low",
      basis: "unavailable",
      evidence: robots.reason,
      guidance: `Open ${robotsUrl} in a browser to check it by hand.`,
      fix_url: robotsUrl,
    })];
  }
  const { status, text } = robots.data;
  if (status >= 500) {
    return [base("robots:server_error", "robots_server_error", {
      title: "robots.txt returns a server error",
      severity: "high",
      basis: "observed",
      evidence: `${robotsUrl} answered HTTP ${status}. Crawlers that follow RFC 9309 treat this as "do not crawl anything".`,
      guidance: "Fix the server error so robots.txt loads. WordPress serves one by default.",
      fix_url: robotsUrl,
    })];
  }

  const parsed = status >= 200 && status < 300 ? parseRobots(text) : { groups: [], sitemaps: [] };
  const findings: Finding[] = [];
  const paths = ["/", ...(productPath ? [productPath] : [])];

  for (const bot of AI_BOTS) {
    const blocked = paths.filter((p) => !isAllowed(parsed, bot.name, p));
    if (!blocked.length) continue;
    findings.push(base(`robots:${bot.name}`, "robots_blocks_bot", {
      title: `robots.txt blocks ${bot.name}`,
      severity: BOT_SEVERITY[bot.name],
      basis: "observed",
      evidence: `${robotsUrl} disallows ${blocked.map((p) => (p === "/" ? "the home page" : p)).join(" and ")} for ${bot.name}.`,
      guidance: `If this is not on purpose, remove the Disallow rule for ${bot.name} (or for *) in robots.txt, usually set by an SEO or security plugin. Blocking ${bot.name} keeps your products out of its answers.`,
      fix_url: robotsUrl,
    }));
  }

  if (!parsed.sitemaps.length) {
    findings.push(base("robots:no_sitemap", "robots_no_sitemap", {
      title: "robots.txt does not list a sitemap",
      severity: "low",
      basis: "observed",
      evidence: status === 404 ? `${robotsUrl} does not exist (HTTP 404).` : `${robotsUrl} has no Sitemap: line.`,
      guidance: "Add a line like \"Sitemap: https://your-store/wp-sitemap.xml\" (WordPress core or your SEO plugin can do this) so crawlers find every product.",
      fix_url: robotsUrl,
    }));
  }
  return findings;
}

export function checkLlmsTxt(storeUrl: string, llms: Source<RobotsFetch>): Finding[] {
  if (!llms.ok) return [];
  const { status, text } = llms.data;
  const looksLikeText = status >= 200 && status < 300 && text.trim() !== "" && !/^\s*<(!doctype|html)/i.test(text);
  if (looksLikeText) return [];
  return [{
    finding_key: "llms_txt:missing",
    type: "llms_txt_missing",
    product_id: null,
    title: "No llms.txt (information only)",
    severity: "low",
    basis: "observed",
    evidence: `${storeUrl}/llms.txt ${status >= 200 && status < 300 ? "returns an HTML page, not a text file" : `answered HTTP ${status}`}.`,
    guidance: "llms.txt is an optional, informal proposal for a short text guide to your site. No major AI shopping agent requires it today.",
    fix_url: `${storeUrl}/llms.txt`,
  }];
}
