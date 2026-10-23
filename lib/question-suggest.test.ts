import { describe, expect, it } from "vitest";
import { marketOf } from "./markets";
import { questionsPrompt, validateQuestions } from "./question-suggest";

const products = [
  { name: "Argan Oil 100 ml – Matha", price: "120", categories: ["Beauty", "Oils"] },
  { name: "Berber Rug 2x3 m", price: "2400", categories: ["Home"] },
];

describe("question suggestions from products", () => {
  it("prompt lists real products with prices and asks for the market's own language, not a translation", () => {
    const p = questionsPrompt({ products, categories: ["Beauty", "Home"], country: "Morocco", currency: "MAD", market: marketOf("MA")! });
    expect(p).toContain("- Argan Oil 100 ml – Matha (120 MAD) [Beauty, Oils]");
    expect(p).toContain("The shoppers are in Morocco. Write each question directly in Arabic");
    expect(p).toContain("Do not write them in English and translate them");
    expect(p).toContain("Never include the store's name");
    expect(p).toContain("ships from: Morocco");
  });

  it("keeps clean questions, drops the brand, numbering and duplicates", () => {
    const q = validateQuestions(JSON.stringify({ questions: [
      "1. Where can I buy pure argan oil online?",
      "Is Matha a good shop?",
      "Best Berber rug for a small living room?",
      "where can i buy pure argan oil online?",
      "Argan oil vs olive oil for hair?",
      "أين أشتري زيت الأركان الأصلي؟",
      "Good gift under 200 MAD from Morocco?",
      "x",
    ] }), ["matha"]);
    expect(q).toEqual([
      "Where can I buy pure argan oil online?",
      "Best Berber rug for a small living room?",
      "Argan oil vs olive oil for hair?",
      "أين أشتري زيت الأركان الأصلي؟",
      "Good gift under 200 MAD from Morocco?",
    ]);
  });

  it("fewer than 5 usable questions or bad JSON → next model", () => {
    expect(validateQuestions(JSON.stringify({ questions: ["Where to buy argan oil?"] }), [])).toBeNull();
    // An Arabic market refuses English questions; an English market refuses Arabic ones.
    const ar = ["فين نشري زيت أركان أصلي؟", "أحسن مرايا LED للحمام بثمن مزيان", "Where to buy argan oil?", "شحال ثمن زربية بربرية؟", "هدية لماما: شنو نشري؟", "مرآة دائرية كبيرة للصالون"];
    expect(validateQuestions(JSON.stringify({ questions: ar }), [], marketOf("MA")!)).toEqual(ar.filter((q) => !q.startsWith("Where")));
    expect(validateQuestions(JSON.stringify({ questions: ar }), [], marketOf("US")!)).toBeNull();
    expect(validateQuestions("questions: a, b", [])).toBeNull();
  });
});
