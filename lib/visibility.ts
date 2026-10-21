// AI Visibility: ask an AI engine the store's questions and look for the store in the answers.
// Everything here works on the answer text only. Competitor names and ranks are extracted heuristically.

export const MAX_PROMPTS = 15;
export const RUN_INTERVAL_DAYS = 7;

export type BrandTerms = { names: string[]; host: string };

// Store name and domain, e.g. "Matha test" + "matha.site" → names ["Matha test", "matha"], host "matha.site".
export function brandTerms(storeName: string, storeUrl: string): BrandTerms {
  const host = new URL(storeUrl).hostname.replace(/^www\./, "").toLowerCase();
  const label = host.split(".")[0];
  const names = [...new Set([storeName.trim(), label].filter((n) => n.length >= 3))];
  return { names, host };
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function matchTerms(text: string, terms: BrandTerms): string[] {
  const found: string[] = [];
  if (text.toLowerCase().includes(terms.host)) found.push(terms.host);
  for (const name of terms.names) {
    if (new RegExp(`(^|[^\\p{L}\\p{N}])${escape(name)}($|[^\\p{L}\\p{N}])`, "iu").test(text)) found.push(name);
  }
  return found;
}

const URL_RE = /https?:\/\/[^\s<>()"'\]\[*`]+/gi;
// Top-level list items only: nested bullets ("    * What they sell: ...") are details, not names.
const LIST_ITEM_RE = /^(?: {0,3})(?:\d{1,2}[.)]|[-*•])\s+(.+)$/;
const HEADING_RE = /^\s{0,3}#{1,6}\s+(.*)$/;

// Words that answers use as labels or section titles, not as shop names.
const LABELS = new Set([
  "tip", "tips", "note", "notes", "shipping", "price", "prices", "pricing", "why", "what", "how", "where", "when",
  "customization", "customisation", "authentication", "authenticity", "quality", "returns", "payment", "delivery",
  "summary", "conclusion", "pros", "cons", "overview", "important", "warning", "bonus", "example", "examples",
  "instagram", "facebook", "whatsapp", "tiktok", "pinterest", "youtube", "social media",
]);
const LABEL_START_RE = /^(why|what|how|where|when|tip|tips|note)\b/i;

// Keeps real shop, brand or marketplace names: drops labels, "Name:" fragments, section-like combinations and the store itself.
export function cleanCompetitors(names: string[], terms: BrandTerms): string[] {
  const out: string[] = [];
  for (const raw of names) {
    const trimmed = raw.replace(/\*+/g, "").trim();
    if (!trimmed || /:\s*$/.test(trimmed)) continue;
    const name = trimmed.replace(/\s*\([^)]*\)\s*$/, "").replace(/[\s.,;]+$/, "").trim();
    const lower = name.toLowerCase();
    if (name.length < 2 || name.length > 60) continue;
    if (LABELS.has(lower) || LABEL_START_RE.test(name)) continue;
    if (name.includes(" / ") || name.split(/\s+/).length > 6) continue;
    if (matchTerms(name, terms).length) continue;
    if (!out.some((o) => o.toLowerCase() === lower)) out.push(name);
  }
  return out;
}

// Name at the start of a list item: "**Name:**", "**Name**", "Name:" or "Name - ...".
function itemName(item: string): string | null {
  const bold = /^\*\*([^*]{2,80})\*\*/.exec(item.trim());
  if (bold) return bold[1].replace(/:\s*$/, "").trim();
  const lead = /^([^:–—\-(*`]{2,60})(?:[:–—-]|\s\()/.exec(item.trim());
  return lead ? lead[1].trim() : null;
}

export type Analysis = {
  mentioned: boolean;
  rank: number | null; // position among the named list items, null when not in a list
  matchedTerms: string[];
  competitors: string[];
  urls: string[];
};

// Text-only analysis, used as is when the structured extraction is not available.
export function analyzeAnswer(answer: string, terms: BrandTerms): Analysis {
  const matchedTerms = matchTerms(answer, terms);
  const named: { name: string | null; text: string }[] = [];
  let inTips = false;
  for (const line of answer.split(/\r?\n/)) {
    const heading = HEADING_RE.exec(line);
    if (heading) {
      inTips = /\b(tips?|notes?|how to|faq|things to)\b/i.test(heading[1]);
      continue;
    }
    const item = LIST_ITEM_RE.exec(line)?.[1];
    if (item && !inTips) named.push({ name: itemName(item), text: item });
  }

  let rank: number | null = null;
  const candidates: string[] = [];
  let position = 0;
  for (const n of named) {
    if (matchTerms(n.text, terms).length) {
      position++;
      if (rank === null) rank = position;
      continue;
    }
    if (n.name && cleanCompetitors([n.name], terms).length) {
      position++;
      candidates.push(n.name);
    }
  }

  const urls = [...new Set((answer.match(URL_RE) ?? []).map((u) => u.replace(/[.,;:!?]+$/, "")))];
  for (const u of urls) {
    try {
      const host = new URL(u).hostname.replace(/^www\./, "");
      if (host !== terms.host) candidates.push(host);
    } catch {
      // not a URL after all
    }
  }

  return { mentioned: matchedTerms.length > 0, rank, matchedTerms, competitors: cleanCompetitors(candidates, terms).slice(0, 20), urls: urls.slice(0, 30) };
}

// Second, small request: the same model reads its answer back and lists the shops it named, as JSON.
export const EXTRACTION_SCHEMA = {
  type: "OBJECT",
  properties: {
    brands: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: { name: { type: "STRING" }, url_if_present: { type: "STRING", nullable: true } },
        required: ["name"],
      },
    },
    store_mentioned: { type: "BOOLEAN" },
    rank_if_listed: { type: "INTEGER", nullable: true },
  },
  required: ["brands", "store_mentioned"],
} as const;

export function extractionPrompt(answer: string, storeName: string, host: string): string {
  return [
    "Read the text between <answer> tags and list the shops, brands and marketplaces it names.",
    "Only include real store, brand or marketplace names that appear in the text.",
    "Do not include headings, section titles or labels (for example \"Tip\", \"Shipping\", \"Why it's good\", \"What they sell\"),",
    "social networks used only as channels, product types, cities or generic phrases. Keep the order they appear in.",
    "Give url_if_present only when a URL or domain for that name is written in the text.",
    `store_mentioned: whether the text names the store "${storeName}" or the domain ${host}.`,
    "rank_if_listed: its position among the listed shops when it is in a list, otherwise null.",
    "",
    `<answer>\n${answer}\n</answer>`,
  ].join("\n");
}

export type Extraction = { brands: { name: string; url: string | null }[]; storeMentioned: boolean; rank: number | null };

export function parseExtraction(text: string): Extraction | null {
  try {
    const data = JSON.parse(text) as { brands?: unknown; store_mentioned?: unknown; rank_if_listed?: unknown };
    if (!Array.isArray(data.brands) || typeof data.store_mentioned !== "boolean") return null;
    const brands = data.brands
      .filter((b): b is { name: string; url_if_present?: unknown } => !!b && typeof (b as { name?: unknown }).name === "string")
      .map((b) => ({ name: b.name.trim(), url: typeof b.url_if_present === "string" && /^https?:\/\/|^[\w-]+(\.[\w-]+)+/.test(b.url_if_present) ? b.url_if_present.trim() : null }));
    const rank = Number.isInteger(data.rank_if_listed) && (data.rank_if_listed as number) > 0 ? (data.rank_if_listed as number) : null;
    return { brands, storeMentioned: data.store_mentioned, rank };
  } catch {
    return null;
  }
}

// Final analysis: the text match decides "mentioned" (it is checkable in the answer); names come from the
// structured extraction when it worked, filtered again, otherwise from the text heuristic.
export function combineAnalysis(answer: string, terms: BrandTerms, extraction: Extraction | null): Analysis & { method: "model" | "heuristic" } {
  const text = analyzeAnswer(answer, terms);
  if (!extraction) return { ...text, method: "heuristic" };
  const competitors = cleanCompetitors(extraction.brands.map((b) => b.name), terms).slice(0, 20);
  const extraUrls = extraction.brands.map((b) => b.url).filter((u): u is string => !!u && /^https?:\/\//.test(u));
  return {
    ...text,
    rank: text.mentioned ? (text.rank ?? extraction.rank) : null,
    competitors,
    urls: [...new Set([...text.urls, ...extraUrls])].slice(0, 30),
    method: "model",
  };
}

// Five starting questions from the store's biggest product categories. The user decides which to keep.
export function suggestPrompts(categories: string[], country: string | null): string[] {
  const where = country ? ` in ${country}` : " online";
  const cats = categories.map((c) => c.trim()).filter((c) => c && !/^uncategori[sz]ed$/i.test(c));
  const out: string[] = [];
  const templates = [
    (c: string) => `Where can I buy ${c.toLowerCase()}${where}?`,
    (c: string) => `What is the best online shop for ${c.toLowerCase()}${where}?`,
    (c: string) => `Recommend a trustworthy store that sells ${c.toLowerCase()}${where}.`,
  ];
  for (let t = 0; out.length < 5 && t < templates.length; t++) {
    for (const c of cats) {
      if (out.length >= 5) break;
      out.push(templates[t](c));
    }
  }
  if (out.length < 5) out.push(`Which online stores${country ? ` in ${country}` : ""} are good for handmade and local products?`);
  return [...new Set(out)].slice(0, 5);
}

export type EngineAnswer = {
  text: string;
  finishReason: string | null;
  inputTokens: number;
  outputTokens: number;
  blocked: string | null;
};

// Reads a Gemini generateContent response.
export function parseGeminiResponse(body: unknown): EngineAnswer {
  const b = (body ?? {}) as {
    candidates?: { content?: { parts?: { text?: string; thought?: boolean }[] }; finishReason?: string }[];
    usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number; thoughtsTokenCount?: number };
    promptFeedback?: { blockReason?: string };
  };
  const candidate = b.candidates?.[0];
  const text = (candidate?.content?.parts ?? []).filter((p) => !p.thought && typeof p.text === "string").map((p) => p.text).join("").trim();
  const u = b.usageMetadata ?? {};
  return {
    text,
    finishReason: candidate?.finishReason ?? null,
    inputTokens: u.promptTokenCount ?? 0,
    outputTokens: (u.candidatesTokenCount ?? 0) + (u.thoughtsTokenCount ?? 0),
    blocked: b.promptFeedback?.blockReason ?? null,
  };
}

// When the next run is allowed: one run per store every RUN_INTERVAL_DAYS (failed runs do not count).
export function nextRunAt(lastRunAt: string | null): Date | null {
  if (!lastRunAt) return null;
  return new Date(Date.parse(lastRunAt) + RUN_INTERVAL_DAYS * 86_400_000);
}

export function canRun(lastRunAt: string | null, now: Date): boolean {
  const next = nextRunAt(lastRunAt);
  return !next || now >= next;
}
