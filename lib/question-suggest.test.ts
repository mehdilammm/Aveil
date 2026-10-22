import { describe, expect, it } from "vitest";
import { questionsPrompt, validateQuestions } from "./question-suggest";

const products = [
  { name: "Argan Oil 100 ml – Matha", price: "120", categories: ["Beauty", "Oils"] },
  { name: "Berber Rug 2x3 m", price: "2400", categories: ["Home"] },
];

describe("question suggestions from products", () => {
  it("prompt lists real products with prices and asks for the chosen language, without the store name", () => {
    const p = questionsPrompt({ products, categories: ["Beauty", "Home"], country: "Morocco", currency: "MAD", language: "fr" });
    expect(p).toContain("- Argan Oil 100 ml – Matha (120 MAD) [Beauty, Oils]");
    expect(p).toContain("Write them in French.");
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
    expect(validateQuestions("questions: a, b", [])).toBeNull();
  });
});
