// AI Visibility: ask an AI engine the store's questions and look for the store in the answers.
// "Mentioned" is a text match in the answer. Other shop names come from a structured-output request
// (with a type per name) or, as a fallback, from the answer's list items; both are filtered.

export const MAX_PROMPTS = 15;
export const RUN_INTERVAL_DAYS = 7;

// host: the registrable domain (sa.made-in-china.com → made-in-china.com), so the parent brand counts as the store.
// keys: normalized brand keys used to drop the store itself from competitor lists.
export type BrandTerms = { names: string[]; host: string; keys?: string[] };

// Second-level public suffixes common for small stores; enough to find the registrable domain.
const TWO_LEVEL_SUFFIXES = new Set([
  "co.uk", "org.uk", "ac.uk", "com.au", "net.au", "co.nz", "co.za", "co.jp", "com.br", "com.mx", "com.ar", "com.cn", "com.tr",
  "co.in", "co.id", "com.sg", "com.my", "co.ma", "net.ma", "com.eg", "com.sa", "co.il", "com.ua", "com.pl",
]);

export function registrableDomain(host: string): string {
  const parts = host.toLowerCase().replace(/^www\./, "").split(".");
  if (parts.length <= 2) return parts.join(".");
  const lastTwo = parts.slice(-2).join(".");
  return TWO_LEVEL_SUFFIXES.has(lastTwo) ? parts.slice(-3).join(".") : lastTwo;
}

const TLD_RE = /\.(com|net|org|co|io|shop|store|biz|info|[a-z]{2})(\.[a-z]{2})?$/i;
const COMPANY_SUFFIX_RE = /\b(inc|co|ltd|llc|corp|corporation|company|gmbh|sa|sarl|plc|limited)\b\.?/gi;

// "Alibaba.com", "alibaba", "Alibaba Inc." → "alibaba". Used for de-duplication and brand matching only.
export function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .replace(/\/.*$/, "")
    .replace(TLD_RE, "")
    .replace(COMPANY_SUFFIX_RE, " ")
    .replace(/[^a-z0-9]+/g, "");
}

// Store name and domain, e.g. "Matha test" + "matha.site" → names ["Matha test", "matha"], host "matha.site".
export function brandTerms(storeName: string, storeUrl: string): BrandTerms {
  const host = registrableDomain(new URL(storeUrl).hostname);
  const label = host.split(".")[0];
  const names = [...new Set([storeName.trim(), label, label.includes("-") ? label.replace(/-/g, " ") : ""].filter((n) => n.length >= 3))];
  const keys = [...new Set([normalizeName(storeName), normalizeName(label)].filter((k) => k.length >= 3))];
  return { names, host, keys };
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

function isOwnBrand(name: string, terms: BrandTerms): boolean {
  if (matchTerms(name, terms).length) return true;
  const key = normalizeName(name);
  // Names that contain the brand ("Made-in-China Global" for made-in-china.com) count as the store too;
  // very short brand keys must match exactly so they do not swallow unrelated names.
  return (terms.keys ?? []).some((k) => key === k || (k.length >= 5 && key.includes(k)));
}

const URL_RE = /https?:\/\/[^\s<>()"'\]\[*`]+/gi;
// Top-level list items only: nested bullets ("    * What they sell: ...") are details, not names.
const LIST_ITEM_RE = /^(?: {0,3})(?:\d{1,2}[.)]|[-*•])\s+(.+)$/;
const HEADING_RE = /^\s{0,3}(#{1,6})\s+(.*)$/;
// Sections that list shops; "What is X?", "Is it safe?", "Tips…" are skipped when the answer has headings.
const SHOP_SECTION_RE = /\b(stores?|shops?|platforms?|marketplaces?|alternatives?|competitors?|similar|recommend\w*|brands?|boutiques?|retailers?|sellers?|where to buy|options?|sites?)\b/i;
const NON_SHOP_SECTION_RE = /\b(tips?|notes?|how to|faq|things to|social media|is it safe|what is)\b/i;

// Words that answers use as labels or section titles, not as shop names.
const LABELS = new Set([
  "tip", "tips", "note", "notes", "shipping", "price", "prices", "pricing", "why", "what", "how", "where", "when",
  "customization", "customisation", "authentication", "authenticity", "quality", "returns", "payment", "delivery",
  "summary", "conclusion", "pros", "cons", "overview", "important", "warning", "bonus", "example", "examples",
  "instagram", "facebook", "whatsapp", "tiktok", "pinterest", "youtube", "social media",
]);
const LABEL_START_RE = /^(why|what|how|where|when|tip|tips|note|the)\b/i;
// Generic group names ("Local cooperatives", "Global-sourcing agents") are not one shop.
const GENERIC_RE = /\b(agents|services|companies|cooperatives|platforms|sites|websites|stores|shops|marketplaces|retailers|sellers|brands|options)\b/i;

function displayName(raw: string): string {
  const name = raw.replace(/\*+/g, "").trim().replace(/\s*\([^)]*\)\s*$/, "").replace(/[\s.,;:]+$/, "").trim();
  // A bare domain is shown without its ending: "DHgate.com" → "DHgate".
  return /^[\w-]+(\.[\w-]+)+$/.test(name) && !name.includes(" ") ? name.replace(TLD_RE, "") : name;
}

// Keeps real shop, brand or marketplace names: drops labels, "Name:" fragments, generic groups, the store itself and
// its parent domain, and merges duplicates such as "Alibaba" and "Alibaba.com".
export function cleanCompetitors(names: string[], terms: BrandTerms): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of names) {
    const trimmed = raw.replace(/\*+/g, "").trim();
    if (!trimmed || /:\s*$/.test(trimmed)) continue;
    const name = displayName(trimmed);
    const lower = name.toLowerCase();
    if (name.length < 2 || name.length > 60) continue;
    if (LABELS.has(lower) || LABEL_START_RE.test(name)) continue;
    if (name.includes(" / ") || name.split(/\s+/).length > 6 || GENERIC_RE.test(name)) continue;
    if (isOwnBrand(trimmed, terms) || isOwnBrand(name, terms)) continue;
    const key = normalizeName(name);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(name);
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
  const lines = answer.split(/\r?\n/);
  const hasHeadings = lines.some((l) => HEADING_RE.test(l));
  // Relevance per heading level: a subsection inherits a shop-listing parent.
  const stack: { level: number; shop: boolean }[] = [];
  let inShopSection = !hasHeadings;
  const named: { name: string | null; text: string }[] = [];
  for (const line of lines) {
    const heading = HEADING_RE.exec(line);
    if (heading) {
      const level = heading[1].length;
      while (stack.length && stack[stack.length - 1].level >= level) stack.pop();
      const title = heading[2];
      const parentShop = stack.some((h) => h.shop);
      const shop = !NON_SHOP_SECTION_RE.test(title) && (SHOP_SECTION_RE.test(title) || parentShop);
      stack.push({ level, shop });
      inShopSection = shop;
      continue;
    }
    const item = LIST_ITEM_RE.exec(line)?.[1];
    if (item && inShopSection) named.push({ name: itemName(item), text: item });
  }

  let rank: number | null = null;
  const candidates: string[] = [];
  let position = 0;
  for (const n of named) {
    if (n.name && isOwnBrand(n.name, terms)) {
      position++;
      if (rank === null && matchTerms(n.text, terms).length) rank = position;
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
      if (registrableDomain(host) !== terms.host) candidates.push(host);
    } catch {
      // not a URL after all
    }
  }

  return { mentioned: matchedTerms.length > 0, rank, matchedTerms, competitors: cleanCompetitors(candidates, terms).slice(0, 20), urls: urls.slice(0, 30) };
}

// Second, small request: the same model reads its answer back and lists the names it gave, with a type, as JSON.
export const NAME_TYPES = ["store", "marketplace", "brand", "service", "other"] as const;
export type NameType = (typeof NAME_TYPES)[number];
const KEEP_TYPES = new Set<NameType>(["store", "marketplace", "brand"]);

// Output budget for the extraction reply: long answers list many names, and 512 tokens cut the JSON off.
export const EXTRACTION_MAX_TOKENS = 2048;

export const EXTRACTION_SCHEMA = {
  type: "OBJECT",
  properties: {
    brands: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          name: { type: "STRING" },
          type: { type: "STRING", enum: [...NAME_TYPES] },
          url_if_present: { type: "STRING", nullable: true },
        },
        required: ["name", "type"],
      },
    },
    store_mentioned: { type: "BOOLEAN" },
    rank_if_listed: { type: "INTEGER", nullable: true },
  },
  required: ["brands", "store_mentioned"],
} as const;

export function extractionPrompt(answer: string, storeName: string, host: string): string {
  return [
    "Read the text between <answer> tags and list the organisations it names.",
    "Only include real names that appear in the text. Do not include headings, section titles or labels",
    "(for example \"Tip\", \"Shipping\", \"Why it's good\", \"What they sell\"), product types, cities or generic phrases.",
    "type: \"store\" for an online or physical shop, \"marketplace\" for a site where many sellers sell, \"brand\" for a product brand or maker,",
    "\"service\" for inspection, certification, payment, shipping, logistics, sourcing-agent or software companies, \"other\" for anything else",
    "(media, social networks, organisations). Keep the order they appear in.",
    "Give url_if_present only when a URL or domain for that name is written in the text.",
    `store_mentioned: whether the text names the store "${storeName}" or the domain ${host}.`,
    "rank_if_listed: its position among the listed shops when it is in a list, otherwise null.",
    "",
    `<answer>\n${answer}\n</answer>`,
  ].join("\n");
}

export type Extraction = { brands: { name: string; type: NameType | null; url: string | null }[]; storeMentioned: boolean; rank: number | null };

// Recovers the complete brand entries of a JSON reply that was cut off (for example by the output token limit).
function salvageTruncated(text: string): unknown {
  const start = text.indexOf('"brands"');
  if (start < 0) return null;
  const arrayStart = text.indexOf("[", start);
  if (arrayStart < 0) return null;
  let lastComplete = -1;
  let depth = 0;
  let inString = false;
  for (let i = arrayStart + 1; i < text.length; i++) {
    const c = text[i];
    if (inString) {
      if (c === "\\") i++;
      else if (c === '"') inString = false;
    } else if (c === '"') inString = true;
    else if (c === "{") depth++;
    else if (c === "}" && --depth === 0) lastComplete = i;
    else if (c === "]" && depth === 0) break;
  }
  if (lastComplete < 0) return null;
  try {
    return { brands: JSON.parse(`[${text.slice(arrayStart + 1, lastComplete + 1)}]`), store_mentioned: false, truncated: true };
  } catch {
    return null;
  }
}

export function parseExtraction(text: string): Extraction | null {
  const cleaned = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  let data: { brands?: unknown; store_mentioned?: unknown; rank_if_listed?: unknown } | null = null;
  try {
    data = JSON.parse(cleaned);
  } catch {
    data = salvageTruncated(cleaned) as typeof data;
  }
  if (!data || !Array.isArray(data.brands) || typeof data.store_mentioned !== "boolean") return null;
  const brands = data.brands
    .filter((b): b is { name: string; type?: unknown; url_if_present?: unknown } => !!b && typeof (b as { name?: unknown }).name === "string")
    .map((b) => ({
      name: b.name.trim(),
      type: (NAME_TYPES as readonly string[]).includes(String(b.type)) ? (b.type as NameType) : null,
      url: typeof b.url_if_present === "string" && /^https?:\/\/|^[\w-]+(\.[\w-]+)+/.test(b.url_if_present) ? b.url_if_present.trim() : null,
    }));
  const rank = Number.isInteger(data.rank_if_listed) && (data.rank_if_listed as number) > 0 ? (data.rank_if_listed as number) : null;
  return { brands, storeMentioned: data.store_mentioned, rank };
}

// Why an extraction reply could not be used, for the record ("finish reason MAX_TOKENS", "not valid JSON", ...).
export function extractionProblem(r: { ok: boolean; text?: string; finishReason?: string | null; error?: string }): string | null {
  if (!r.ok) return r.error ?? "request failed";
  if (!r.text) return `empty reply${r.finishReason ? ` (finish reason ${r.finishReason})` : ""}`;
  if (parseExtraction(r.text)) return null;
  return `reply was not valid JSON${r.finishReason && r.finishReason !== "STOP" ? ` (finish reason ${r.finishReason})` : ""}`;
}

// Final analysis: the text match decides "mentioned" (it is checkable in the answer); names come only from the
// structured extraction (stores, marketplaces and brands), filtered again. When it failed, no names are shown
// ("failed"): wrong names are worse than none.
export function combineAnalysis(answer: string, terms: BrandTerms, extraction: Extraction | null): Analysis & { method: "model" | "failed" } {
  const text = analyzeAnswer(answer, terms);
  if (!extraction) return { ...text, competitors: [], method: "failed" };
  const kept = extraction.brands.filter((b) => b.type === null || KEEP_TYPES.has(b.type));
  const competitors = cleanCompetitors(kept.map((b) => b.name), terms).slice(0, 20);
  const extraUrls = kept.map((b) => b.url).filter((u): u is string => !!u && /^https?:\/\//.test(u));
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
