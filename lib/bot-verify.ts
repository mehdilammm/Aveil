// Bot identity: a request that says it is GPTBot (user agent) is only "Observed" as GPTBot when its IP is in the
// operator's published list, or (Google) when reverse DNS and the forward lookup agree. Otherwise the user agent
// is a claim: "Heuristic". Lists are the operators' own JSON files ({ creationTime, prefixes: [{ ipv4Prefix |
// ipv6Prefix }] }); claude.com/crawling/bots.json read on 2026-10-23 had this shape (14 IPv4 prefixes).
import { isIP } from "node:net";

export type Provider = "openai" | "anthropic" | "perplexity" | "google";
export type IpSource = { url: string; provider: Provider; bots: string[] };

export const IP_SOURCES: IpSource[] = [
  { url: "https://openai.com/gptbot.json", provider: "openai", bots: ["GPTBot"] },
  { url: "https://openai.com/searchbot.json", provider: "openai", bots: ["OAI-SearchBot"] },
  { url: "https://openai.com/chatgpt-user.json", provider: "openai", bots: ["ChatGPT-User"] },
  { url: "https://claude.com/crawling/bots.json", provider: "anthropic", bots: ["ClaudeBot", "Claude-SearchBot", "Claude-User"] },
  { url: "https://www.perplexity.com/perplexitybot.json", provider: "perplexity", bots: ["PerplexityBot"] },
  { url: "https://www.perplexity.com/perplexity-user.json", provider: "perplexity", bots: ["Perplexity-User"] },
  { url: "https://developers.google.com/static/search/apis/ipranges/googlebot.json", provider: "google", bots: ["Googlebot"] },
];

// Reverse DNS names that prove the operator (forward lookup must give the same IP back). Google documents this;
// the others publish IP lists only.
export const RDNS_SUFFIXES: Partial<Record<Provider, string[]>> = { google: ["googlebot.com", "google.com"] };

// User agent → bot name. Order matters: the most specific token first.
const UA_TOKENS: [RegExp, string][] = [
  [/\bOAI-SearchBot\//i, "OAI-SearchBot"],
  [/\bChatGPT-User\//i, "ChatGPT-User"],
  [/\bGPTBot\//i, "GPTBot"],
  [/\bClaude-SearchBot\//i, "Claude-SearchBot"],
  [/\bClaude-User\//i, "Claude-User"],
  [/\bClaudeBot\//i, "ClaudeBot"],
  [/\bPerplexity-User\//i, "Perplexity-User"],
  [/\bPerplexityBot\//i, "PerplexityBot"],
  [/\bGooglebot\//i, "Googlebot"],
];
export const KNOWN_BOTS = UA_TOKENS.map(([, n]) => n);

export function botOfUa(ua: string): string | null {
  for (const [re, name] of UA_TOKENS) if (re.test(ua)) return name;
  return null;
}

export const providerOf = (bot: string): Provider | null => IP_SOURCES.find((s) => s.bots.includes(bot))?.provider ?? null;

// The prefixes of one list, or the reason it cannot be used.
export function parseRanges(body: unknown): { ok: true; cidrs: string[]; creationTime: string | null } | { ok: false; reason: string } {
  if (!body || typeof body !== "object" || !Array.isArray((body as { prefixes?: unknown }).prefixes)) return { ok: false, reason: "not the published format (no prefixes list)" };
  const b = body as { creationTime?: unknown; prefixes: { ipv4Prefix?: unknown; ipv6Prefix?: unknown }[] };
  const cidrs = b.prefixes.map((p) => (typeof p?.ipv4Prefix === "string" ? p.ipv4Prefix : typeof p?.ipv6Prefix === "string" ? p.ipv6Prefix : "")).filter(validCidr);
  if (!cidrs.length) return { ok: false, reason: "the list has no valid prefix" };
  return { ok: true, cidrs, creationTime: typeof b.creationTime === "string" ? b.creationTime : null };
}

function validCidr(c: string): boolean {
  const [ip, bits] = c.split("/");
  const v = isIP(ip ?? "");
  const n = Number(bits);
  return v !== 0 && Number.isInteger(n) && n >= 0 && n <= (v === 4 ? 32 : 128);
}

function toBigInt(ip: string): { v: 4 | 6; n: bigint } | null {
  const v = isIP(ip);
  if (v === 4) return { v: 4, n: ip.split(".").reduce((a, o) => (a << 8n) + BigInt(Number(o)), 0n) };
  if (v !== 6) return null;
  // IPv4-mapped IPv6 (::ffff:1.2.3.4) is compared as IPv4.
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(ip);
  if (mapped) return toBigInt(mapped[1]);
  const [head, tail = ""] = ip.split("::");
  const h = head ? head.split(":") : [];
  const t = ip.includes("::") ? (tail ? tail.split(":") : []) : [];
  const groups = ip.includes("::") ? [...h, ...Array(8 - h.length - t.length).fill("0"), ...t] : h;
  if (groups.length !== 8) return null;
  return { v: 6, n: groups.reduce((a, g) => (a << 16n) + BigInt(parseInt(g || "0", 16)), 0n) };
}

export function ipInCidr(ip: string, cidr: string): boolean {
  const [base, bitsText] = cidr.split("/");
  const a = toBigInt(ip);
  const b = toBigInt(base);
  if (!a || !b || a.v !== b.v) return false;
  const size = a.v === 4 ? 32 : 128;
  const bits = BigInt(Number(bitsText));
  const shift = BigInt(size) - bits;
  return a.n >> shift === b.n >> shift;
}

export type Verdict = { verified: boolean; method: "ip_range" | "rdns" | null; detail: string };

// ranges: the prefixes per bot from the cached lists. rdns: reverse + forward lookup, only called for providers
// that document it (Google), and only when the IP is not in a list.
export async function verifyHit(
  hit: { bot: string; ip: string },
  ranges: Map<string, string[]>,
  rdns: (ip: string) => Promise<{ hostnames: string[]; forward: (host: string) => Promise<string[]> }>,
): Promise<Verdict> {
  const cidrs = ranges.get(hit.bot);
  const provider = providerOf(hit.bot);
  if (cidrs?.some((c) => ipInCidr(hit.ip, c))) return { verified: true, method: "ip_range", detail: `IP in ${provider}'s published list for ${hit.bot}` };
  const suffixes = provider ? RDNS_SUFFIXES[provider] : undefined;
  if (suffixes) {
    try {
      const { hostnames, forward } = await rdns(hit.ip);
      for (const host of hostnames) {
        const h = host.toLowerCase().replace(/\.$/, "");
        if (!suffixes.some((s) => h === s || h.endsWith(`.${s}`))) continue;
        if ((await forward(h)).includes(hit.ip)) return { verified: true, method: "rdns", detail: `reverse DNS ${h}, confirmed by forward lookup` };
      }
    } catch {
      // no reverse name: stays a claim
    }
  }
  if (!cidrs) return { verified: false, method: null, detail: `no usable IP list for ${hit.bot} right now` };
  return { verified: false, method: null, detail: `IP not in ${provider}'s published list for ${hit.bot}` };
}

export const RETENTION_DEFAULT_DAYS = 90;
