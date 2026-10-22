// Brand profile: how one AI answer describes the store and the competitors it names (sentiment, a short description,
// the features it mentions). Read out of the stored answer by an internal helper model, then checked against the
// answer: competitors must be names the extraction found, features must use words that are in the answer.
import { normalizeName } from "./visibility";

export const SENTIMENTS = ["positive", "neutral", "negative"] as const;
export type Sentiment = (typeof SENTIMENTS)[number] | "not_mentioned";
export type BrandDescription = { sentiment: Sentiment | null; description: string | null; features: string[] };
export type AnswerProfile = { store: BrandDescription; competitors: ({ name: string } & BrandDescription)[] };

const MAX_DESCRIPTION = 200;
const MAX_FEATURES = 6;
const MAX_FEATURE = 60;

const describeSchema = {
  type: "object",
  properties: {
    sentiment: { type: "string", enum: [...SENTIMENTS, "not_mentioned"] },
    description: { type: ["string", "null"] },
    features: { type: "array", items: { type: "string" } },
  },
  required: ["sentiment", "description", "features"],
  additionalProperties: false,
} as const;

export const PROFILE_JSON_SCHEMA = {
  type: "object",
  properties: {
    store: describeSchema,
    competitors: {
      type: "array",
      items: {
        type: "object",
        properties: { name: { type: "string" }, ...describeSchema.properties },
        required: ["name", "sentiment", "description", "features"],
        additionalProperties: false,
      },
    },
  },
  required: ["store", "competitors"],
  additionalProperties: false,
} as const;

const geminiDescribe = {
  type: "OBJECT",
  properties: {
    sentiment: { type: "STRING", enum: [...SENTIMENTS, "not_mentioned"] },
    description: { type: "STRING", nullable: true },
    features: { type: "ARRAY", items: { type: "STRING" } },
  },
  required: ["sentiment", "features"],
} as const;

export const PROFILE_GEMINI_SCHEMA = {
  type: "OBJECT",
  properties: {
    store: geminiDescribe,
    competitors: { type: "ARRAY", items: { type: "OBJECT", properties: { name: { type: "STRING" }, ...geminiDescribe.properties }, required: ["name", "sentiment", "features"] } },
  },
  required: ["store", "competitors"],
} as const;

export function profilePrompt(answer: string, storeName: string, host: string, competitors: string[]): string {
  return [
    "Read the text between <answer> tags. It is an AI assistant's answer to a shopper's question.",
    `For the store "${storeName}" (${host}) and for each of these names: ${competitors.length ? competitors.map((c) => `"${c}"`).join(", ") : "(none)"}, give:`,
    "- sentiment: how the text talks about it: \"positive\", \"neutral\" or \"negative\"; \"not_mentioned\" if the text does not name it;",
    "- description: one short sentence (at most 25 words) saying how the text describes it, using only what the text says; null if not mentioned;",
    "- features: up to 6 short phrases (2-5 words) the text attributes to it (for example \"free shipping\", \"handmade in Morocco\"),",
    "  copied from the text; an empty list if none.",
    "Do not add anything that is not in the text. List the competitors in the order given; only those names.",
    "",
    `<answer>\n${answer}\n</answer>`,
  ].join("\n");
}

const clean = (s: unknown, max: number) => (typeof s === "string" ? s.replace(/\s+/g, " ").trim().slice(0, max) : "");

function words(text: string): Set<string> {
  return new Set(text.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").split(/[^a-z0-9]+/).filter((w) => w.length >= 3));
}

// A feature is kept only when most of its words (3+ letters) are in the answer.
function inAnswer(feature: string, answerWords: Set<string>): boolean {
  const w = [...words(feature)];
  if (!w.length) return false;
  return w.filter((x) => answerWords.has(x)).length / w.length >= 0.6;
}

function describe(raw: unknown, answerWords: Set<string>, mentioned: boolean): BrandDescription {
  const r = (raw ?? {}) as { sentiment?: unknown; description?: unknown; features?: unknown };
  if (!mentioned) return { sentiment: "not_mentioned", description: null, features: [] };
  const sentiment = (SENTIMENTS as readonly string[]).includes(String(r.sentiment)) ? (r.sentiment as Sentiment) : null;
  const description = clean(r.description, MAX_DESCRIPTION) || null;
  const features = Array.isArray(r.features)
    ? [...new Set(r.features.map((f) => clean(f, MAX_FEATURE)).filter((f) => f && inAnswer(f, answerWords)))].slice(0, MAX_FEATURES)
    : [];
  return { sentiment, description, features };
}

// Parses and checks the helper model's reply. "Mentioned" comes from the text match, never from the model; a
// competitor is kept only if the extraction found that name in the answer. Returns null for an unusable reply.
export function parseProfile(text: string, answer: string, storeMentioned: boolean, competitors: string[]): AnswerProfile | null {
  let data: { store?: unknown; competitors?: unknown };
  try {
    data = JSON.parse(text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, ""));
  } catch {
    return null;
  }
  if (!data || typeof data !== "object" || !data.store || !Array.isArray(data.competitors)) return null;
  const answerWords = words(answer);
  // A "not_mentioned" from the model for a store the text names becomes no sentiment (unclassified).
  const store = describe(data.store, answerWords, storeMentioned);
  const known = new Map(competitors.map((c) => [normalizeName(c), c]));
  const seen = new Set<string>();
  const out: AnswerProfile["competitors"] = [];
  for (const c of data.competitors as { name?: unknown }[]) {
    const key = normalizeName(clean(c?.name, 120));
    const name = known.get(key);
    if (!name || seen.has(key)) continue;
    seen.add(key);
    out.push({ name, ...describe(c, answerWords, true) });
  }
  return { store, competitors: out };
}

// ---------- the store's profile over a run ----------

export type ProfileRow = { prompt: string; mentioned: boolean | null; competitors: string[]; profile: AnswerProfile | null };
export type BrandSummary = {
  name: string;
  questions: number; // answers that name it
  sentiment: Record<(typeof SENTIMENTS)[number] | "unclassified", number>;
  descriptions: { prompt: string; text: string }[];
  features: { text: string; count: number }[];
};

function addTo(s: BrandSummary, prompt: string, d: BrandDescription | undefined) {
  s.questions++;
  const key = d?.sentiment && d.sentiment !== "not_mentioned" ? d.sentiment : "unclassified";
  s.sentiment[key]++;
  if (d?.description) s.descriptions.push({ prompt, text: d.description });
  for (const f of d?.features ?? []) {
    const hit = s.features.find((x) => x.text.toLowerCase() === f.toLowerCase());
    if (hit) hit.count++;
    else s.features.push({ text: f, count: 1 });
  }
}

const empty = (name: string): BrandSummary => ({ name, questions: 0, sentiment: { positive: 0, neutral: 0, negative: 0, unclassified: 0 }, descriptions: [], features: [] });

export function summarizeProfiles(storeName: string, rows: ProfileRow[]): { store: BrandSummary; competitors: BrandSummary[]; answers: number; profiled: number } {
  const store = empty(storeName);
  const comps = new Map<string, BrandSummary>();
  for (const r of rows) {
    if (r.mentioned) addTo(store, r.prompt, r.profile?.store);
    for (const name of r.competitors) {
      const key = normalizeName(name);
      const s = comps.get(key) ?? empty(name);
      addTo(s, r.prompt, r.profile?.competitors.find((c) => normalizeName(c.name) === key));
      comps.set(key, s);
    }
  }
  const sortFeatures = (s: BrandSummary) => (s.features.sort((a, b) => b.count - a.count || a.text.localeCompare(b.text)), s);
  return {
    store: sortFeatures(store),
    competitors: [...comps.values()].map(sortFeatures).sort((a, b) => b.questions - a.questions || a.name.localeCompare(b.name)),
    answers: rows.length,
    profiled: rows.filter((r) => r.profile).length,
  };
}
