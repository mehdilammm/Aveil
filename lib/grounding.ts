// Gemini grounding with Google Search: the sources an answer relied on (groundingMetadata), and the app-wide cap.
// Docs: https://ai.google.dev/gemini-api/docs/google-search
// Pricing: https://ai.google.dev/gemini-api/docs/pricing — Gemini 3 models: 5,000 grounded prompts per month free
// (shared across Gemini 3 models, paid tier; not in the free tier), then $14 per 1,000. AgentScope stops itself at
// GROUNDING_MONTHLY_LIMIT, far below the free 5,000, so grounding never costs money. Off unless
// GEMINI_GROUNDING_ENABLED=true.
import { normalizeName, registrableDomain } from "./visibility";

export const GROUNDING_MONTHLY_LIMIT = 1000;

export function groundingEnabled(): boolean {
  return process.env.GEMINI_GROUNDING_ENABLED?.trim().toLowerCase() === "true";
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

export type CitationRow = { prompt: string; competitors: string[]; citations: Grounding | null };
export type DomainCount = { domain: string; answers: number; isStore: boolean; competitor: string | null; examples: string[] };

// Domains the grounded answers relied on, counted once per answer, with the store and named competitors marked.
export function citedDomains(storeHost: string, rows: CitationRow[]): { grounded: number; domains: DomainCount[]; storeCited: number } {
  const store = registrableDomain(storeHost);
  const map = new Map<string, DomainCount>();
  let grounded = 0;
  let storeCited = 0;
  for (const r of rows) {
    if (!r.citations) continue;
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
