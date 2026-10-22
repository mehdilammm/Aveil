// Gemini grounding with Google Search: the sources an answer relied on (groundingMetadata), and the app-wide cap.
// Docs: https://ai.google.dev/gemini-api/docs/google-search
// Pricing: https://ai.google.dev/gemini-api/docs/pricing — grounding allowances differ per model and tier (Gemini 3:
// 5,000 per month on the paid tier only; Gemini 2.5 Flash: 500 per day on the free tier). AgentScope stops itself at
// GROUNDING_MONTHLY_LIMIT and GROUNDING_DAILY_LIMIT. Off unless GEMINI_GROUNDING_ENABLED=true. When Google refuses a
// grounded request (free tier, 400, 403, 429), its reason is stored word for word, Citations are UNAVAILABLE, and the
// question is asked again without grounding on GEMINI_MODEL so the answer is not lost.
import { normalizeName, registrableDomain } from "./visibility";

export const GROUNDING_MONTHLY_LIMIT = 1000;
// Also a small daily cap, so the free tier's daily grounding limit is never reached.
export const GROUNDING_DAILY_LIMIT = 50;

// Grounded questions use their own model: Flash-Lite has no grounding on the free tier. Gemini 2.5 Flash has
// Google Search grounding on the free tier (500 requests per day, shared with Flash-Lite, per the pricing page).
// Override with GEMINI_GROUNDING_MODEL. Every other request stays on GEMINI_MODEL.
export const GROUNDING_MODEL = process.env.GEMINI_GROUNDING_MODEL?.trim() || "gemini-2.5-flash";

// How the server reads GEMINI_GROUNDING_ENABLED right now. Tolerant: true / 1 / yes / on, with or without quotes.
export type GroundingFlag = { enabled: boolean; read: string };
export function groundingFlag(raw = process.env.GEMINI_GROUNDING_ENABLED): GroundingFlag {
  if (raw === undefined) return { enabled: false, read: "not set on the server" };
  const v = raw.trim().replace(/^["']|["']$/g, "").trim().toLowerCase();
  if (["true", "1", "yes", "on"].includes(v)) return { enabled: true, read: `"${raw.length > 20 ? `${raw.slice(0, 20)}…` : raw}" (on)` };
  return { enabled: false, read: raw.trim() ? `"${raw.length > 20 ? `${raw.slice(0, 20)}…` : raw}" (not true)` : "set but empty" };
}

export function groundingEnabled(): boolean {
  return groundingFlag().enabled;
}

export type Citation = { title: string; domain: string | null; uri: string };
export type Grounding = {
  queries: string[];
  sources: Citation[];
  // Which part of the answer relied on which sources (indexes into sources).
  supports: { text: string; sources: number[] }[];
  // Google Search suggestions HTML: Google requires showing it with grounded answers.
  entryPoint: string | null;
};

const DOMAIN_RE = /^(?:[a-z0-9-]+\.)+[a-z]{2,}$/i;

// The chunk title is usually the source's domain; the uri is a Google redirect link (vertexaisearch...).
export function citationDomain(title: string | undefined, uri: string | undefined): string | null {
  const t = (title ?? "").trim().toLowerCase().replace(/^www\./, "");
  if (DOMAIN_RE.test(t)) return t;
  try {
    const host = new URL(uri ?? "").hostname.toLowerCase().replace(/^www\./, "");
    return host && !host.endsWith("vertexaisearch.cloud.google.com") && !host.endsWith("google.com") ? host : null;
  } catch {
    return null;
  }
}

export function parseGrounding(metadata: unknown): Grounding | null {
  const m = metadata as {
    webSearchQueries?: unknown[];
    groundingChunks?: { web?: { uri?: string; title?: string } }[];
    groundingSupports?: { segment?: { text?: string }; groundingChunkIndices?: number[] }[];
    searchEntryPoint?: { renderedContent?: string };
  } | null;
  if (!m || typeof m !== "object") return null;
  const sources = (m.groundingChunks ?? [])
    .filter((c) => c?.web?.uri)
    .map((c) => ({ title: String(c.web!.title ?? "").slice(0, 200), domain: citationDomain(c.web!.title, c.web!.uri), uri: String(c.web!.uri) }));
  const supports = (m.groundingSupports ?? [])
    .filter((s) => s?.segment?.text && Array.isArray(s.groundingChunkIndices))
    .map((s) => ({ text: String(s.segment!.text).slice(0, 500), sources: s.groundingChunkIndices!.filter((i) => Number.isInteger(i) && i >= 0 && i < sources.length) }))
    .filter((s) => s.sources.length);
  const queries = (m.webSearchQueries ?? []).filter((q): q is string => typeof q === "string").slice(0, 10);
  if (!sources.length && !queries.length) return null;
  return { queries, sources, supports, entryPoint: typeof m.searchEntryPoint?.renderedContent === "string" ? m.searchEntryPoint.renderedContent : null };
}

// ---------- the Citations page ----------

// What is stored per answer: the sources, or why there are none (Google's own words).
export type CitationRecord = Grounding | { unavailable: string };
export const isGrounding = (c: CitationRecord | null | undefined): c is Grounding => !!c && !("unavailable" in c);

export type CitationRow = { prompt: string; competitors: string[]; citations: CitationRecord | null };
export type DomainCount = { domain: string; answers: number; isStore: boolean; competitor: string | null; examples: string[] };

// Domains the grounded answers relied on, counted once per answer, with the store and named competitors marked.
export function citedDomains(storeHost: string, rows: CitationRow[]): { grounded: number; domains: DomainCount[]; storeCited: number } {
  const store = registrableDomain(storeHost);
  const map = new Map<string, DomainCount>();
  let grounded = 0;
  let storeCited = 0;
  for (const r of rows) {
    if (!isGrounding(r.citations)) continue;
    grounded++;
    const compByKey = new Map(r.competitors.map((c) => [normalizeName(c), c]));
    const seen = new Set<string>();
    for (const [i, s] of r.citations.sources.entries()) {
      if (!s.domain) continue;
      const domain = registrableDomain(s.domain);
      if (seen.has(domain)) continue;
      seen.add(domain);
      const d = map.get(domain) ?? { domain, answers: 0, isStore: domain === store, competitor: null, examples: [] };
      d.answers++;
      d.competitor ??= compByKey.get(normalizeName(domain)) ?? null;
      const support = r.citations.supports.find((x) => x.sources.includes(i));
      if (support && d.examples.length < 3) d.examples.push(support.text);
      map.set(domain, d);
    }
    if (seen.has(store)) storeCited++;
  }
  return { grounded, storeCited, domains: [...map.values()].sort((a, b) => b.answers - a.answers || a.domain.localeCompare(b.domain)) };
}
