// Question suggestions from the store's real products, categories and prices: realistic shopper questions
// (buying, comparing, "best X for Y", "where to buy X"), without the store's name. Written by the task chain
// (Groq → NVIDIA → Gemini); nothing is saved until the user picks and edits them.

export const QUESTION_LANGUAGES = { en: "English", fr: "Français", ar: "العربية" } as const;
export type QuestionLanguage = keyof typeof QUESTION_LANGUAGES;
const LANGUAGE_NAME: Record<QuestionLanguage, string> = { en: "English", fr: "French", ar: "Arabic" };

export const SUGGESTED_COUNT = 15;

export type ProductInfo = { name: string; price: string | null; categories: string[] };

export const QUESTIONS_JSON_SCHEMA = {
  type: "object",
  properties: { questions: { type: "array", items: { type: "string" } } },
  required: ["questions"],
  additionalProperties: false,
} as const;
export const QUESTIONS_GEMINI_SCHEMA = { type: "OBJECT", properties: { questions: { type: "ARRAY", items: { type: "STRING" } } }, required: ["questions"] } as const;

export function questionsPrompt(input: { products: ProductInfo[]; categories: string[]; country: string | null; currency: string | null; language: QuestionLanguage }): string {
  const products = input.products.slice(0, 30).map((p) => `- ${p.name}${p.price ? ` (${p.price}${input.currency ? ` ${input.currency}` : ""})` : ""}${p.categories.length ? ` [${p.categories.join(", ")}]` : ""}`);
  return [
    "Here are products from an online store (name, price, categories).",
    ...products,
    input.categories.length ? `Main categories: ${input.categories.join("; ")}` : "",
    input.country ? `The store ships from: ${input.country}` : "",
    "",
    `Write ${SUGGESTED_COUNT} realistic questions a shopper would type into an AI assistant before buying products like these.`,
    "Mix: where to buy a product type, best X for a use or person, comparisons between product types or price ranges, gift ideas, budget questions.",
    "Use generic product types, not the exact product names. Never include the store's name, domain or brand.",
    `Write them in ${LANGUAGE_NAME[input.language]}. Each question under 150 characters.`,
    'Answer with JSON only: {"questions": ["...", "..."]}',
  ].filter((l) => l !== "").join("\n");
}

// Keeps 3-300 character questions without the brand, deduplicated; at least 5 are needed for a usable reply.
export function validateQuestions(text: string, brandKeys: string[]): string[] | null {
  let data: { questions?: unknown };
  try {
    data = JSON.parse(text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, ""));
  } catch {
    return null;
  }
  if (!data || !Array.isArray(data.questions)) return null;
  const seen = new Set<string>();
  const out: string[] = [];
  for (const q of data.questions) {
    if (typeof q !== "string") continue;
    const t = q.replace(/\s+/g, " ").replace(/^\d+[.)]\s*/, "").trim();
    if (t.length < 3 || t.length > 300) continue;
    const compact = t.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]/g, "");
    if (brandKeys.some((k) => k.length >= 3 && compact.includes(k))) continue;
    const key = t.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(t);
    if (out.length >= SUGGESTED_COUNT) break;
  }
  return out.length >= 5 ? out : null;
}
