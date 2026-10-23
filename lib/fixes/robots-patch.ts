// robots.txt patch: the merchant's file, with the AI agents' rules rewritten by AgentScope and everything else kept
// as it was. Search and shopping agents (they fetch pages for people's questions) are allowed; training crawlers
// follow the merchant's choice. The result is checked with the same parser the scan uses.
import { isAllowed, parseRobots } from "../robots";

export const SEARCH_AGENTS = ["OAI-SearchBot", "ChatGPT-User", "Claude-SearchBot", "Claude-User", "PerplexityBot", "Perplexity-User"];
export const TRAINING_CRAWLERS = ["GPTBot", "ClaudeBot", "Google-Extended", "Applebot-Extended", "CCBot"];
const MANAGED = new Set([...SEARCH_AGENTS, ...TRAINING_CRAWLERS].map((b) => b.toLowerCase()));
const MARK = "# AgentScope";

export type TrainingChoice = "allow" | "block";
export type RobotsPatch = { text: string; removed: string[]; checks: { bot: string; path: string; expected: boolean; actual: boolean }[]; unchanged: boolean; problems: string[] };

type Line = { raw: string; key: string | null; value: string };
const lex = (text: string): Line[] =>
  text.split(/\r?\n/).map((raw) => {
    const m = /^\s*([A-Za-z-]+)\s*:\s*(.*?)\s*(#.*)?$/.exec(raw);
    return { raw, key: m ? m[1].toLowerCase() : null, value: m ? m[2] : "" };
  });

// Drops the lines that name a managed bot; a group left with no user agent loses its rules too. Earlier AgentScope
// blocks are removed whole, so running the generator twice gives the same file.
function stripManaged(text: string): { kept: string[]; removed: string[] } {
  const lines = lex(text);
  const kept: string[] = [];
  const removed: string[] = [];
  let i = 0;
  while (i < lines.length) {
    if (lines[i].raw.startsWith(MARK)) {
      // An earlier AgentScope block: up to the next blank line after its rules.
      while (i < lines.length && lines[i].raw.trim() !== "") removed.push(lines[i++].raw);
      continue;
    }
    if (lines[i].key !== "user-agent") {
      kept.push(lines[i++].raw);
      continue;
    }
    const agents: Line[] = [];
    while (i < lines.length && (lines[i].key === "user-agent" || (lines[i].key === null && lines[i].raw.trim().startsWith("#")))) agents.push(lines[i++]);
    const rules: Line[] = [];
    const isComment = (l: Line) => l.key === null && l.raw.trim().startsWith("#") && !l.raw.startsWith(MARK);
    while (i < lines.length && (isComment(lines[i]) || (lines[i].key !== null && lines[i].key !== "user-agent" && lines[i].key !== "sitemap"))) rules.push(lines[i++]);
    const others = agents.filter((a) => a.key === "user-agent" && !MANAGED.has(a.value.toLowerCase()));
    for (const a of agents) if (a.key === "user-agent" && MANAGED.has(a.value.toLowerCase())) removed.push(a.raw);
    if (others.length) kept.push(...agents.filter((a) => a.key !== "user-agent" || !MANAGED.has(a.value.toLowerCase())).map((a) => a.raw), ...rules.map((r) => r.raw));
    else removed.push(...rules.map((r) => r.raw));
  }
  return { kept, removed };
}

// The "*" group's Disallow lines (admin, cart, checkout ...) are copied into the AI groups: a bot's own group
// replaces "*" for it, so without them the bots would gain access the merchant had closed.
function starDisallows(text: string): string[] {
  const star = parseRobots(text).groups.filter((g) => g.agents.includes("*"));
  return [...new Set(star.flatMap((g) => g.rules.filter((r) => !r.allow).map((r) => r.pattern)))].filter((p) => p !== "/");
}

export function patchRobots(original: string, training: TrainingChoice, productPath: string | null): RobotsPatch {
  const { kept, removed } = stripManaged(original);
  const closed = starDisallows(original);
  while (kept.length && kept[kept.length - 1].trim() === "") kept.pop();
  const group = (title: string, bots: string[], rules: string[]) => [`${MARK}: ${title}`, ...bots.map((b) => `User-agent: ${b}`), ...rules, ""];
  const open = ["Allow: /", ...closed.map((p) => `Disallow: ${p}`)];
  const block = [
    ...group("AI search and shopping agents (they fetch pages for people's questions)", SEARCH_AGENTS, open),
    ...group(training === "block" ? "AI training crawlers, blocked by your choice" : "AI training crawlers, allowed by your choice", TRAINING_CRAWLERS, training === "block" ? ["Disallow: /"] : open),
  ];
  const text = [...kept, ...(kept.length ? [""] : []), ...block].join("\n").replace(/\n+$/, "\n");

  // Check: each managed bot gets the intended verdict; every other user agent keeps its verdict.
  const before = parseRobots(original);
  const after = parseRobots(text);
  const paths = ["/", ...(productPath ? [productPath] : [])];
  const checks = [
    ...SEARCH_AGENTS.flatMap((bot) => paths.map((path) => ({ bot, path, expected: true }))),
    ...TRAINING_CRAWLERS.flatMap((bot) => paths.map((path) => ({ bot, path, expected: training === "allow" }))),
  ].map((c) => ({ ...c, actual: isAllowed(after, c.bot, c.path) }));
  const problems = checks.filter((c) => c.actual !== c.expected).map((c) => `${c.bot} on ${c.path}: expected ${c.expected ? "allowed" : "blocked"}`);
  const otherAgents = [...new Set(before.groups.flatMap((g) => g.agents))].filter((a) => !MANAGED.has(a));
  const probe = [...paths, ...closed.map((p) => p.replace(/\*.*$/, "").replace(/\$$/, "") || "/")];
  for (const a of otherAgents) for (const p of probe) if (isAllowed(before, a, p) !== isAllowed(after, a, p)) problems.push(`${a} on ${p} changed`);
  if (JSON.stringify(before.sitemaps) !== JSON.stringify(after.sitemaps)) problems.push("Sitemap lines changed");
  return { text, removed, checks, unchanged: text.trim() === original.trim(), problems };
}
