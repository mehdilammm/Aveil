import { describe, expect, it } from "vitest";
import { analyzeAnswer, brandTerms, canRun, nextRunAt, parseGeminiResponse, suggestPrompts } from "./visibility";

const terms = brandTerms("Matha test", "https://www.matha.site");

describe("brandTerms", () => {
  it("uses the store name and the domain", () => {
    expect(terms).toEqual({ names: ["Matha test", "matha"], host: "matha.site" });
  });
});

describe("analyzeAnswer", () => {
  const listAnswer = `Here are good places to buy argan oil in Morocco:

1. **Cooperative Tighanimine** - certified women's cooperative.
2. **Matha** (matha.site): small shop with argan oil and black soap.
3. **Argan Paradise**: online store, ships worldwide. https://arganparadise.example/shop.
- Souk in Marrakech: bargain in person.`;

  it("finds the store, its rank, competitors and links", () => {
    const a = analyzeAnswer(listAnswer, terms);
    expect(a.mentioned).toBe(true);
    expect(a.rank).toBe(2);
    expect(a.matchedTerms).toEqual(["matha.site", "matha"]);
    expect(a.competitors).toEqual(["Cooperative Tighanimine", "Argan Paradise", "Souk in Marrakech", "arganparadise.example"]);
    expect(a.urls).toEqual(["https://arganparadise.example/shop"]);
  });

  it("reports a mention outside a list without a rank", () => {
    const a = analyzeAnswer("You could try Matha, a small Moroccan shop.", terms);
    expect(a).toMatchObject({ mentioned: true, rank: null });
  });

  it("does not match the name inside another word", () => {
    const a = analyzeAnswer("1. **Mathabeauty** - cosmetics\n2. **Mathematics shop**: books", terms);
    expect(a.mentioned).toBe(false);
    expect(a.rank).toBeNull();
    expect(a.competitors).toEqual(["Mathabeauty", "Mathematics shop"]);
  });
});

describe("suggestPrompts", () => {
  it("makes five questions from categories and skips Uncategorized", () => {
    const p = suggestPrompts(["Uncategorized", "Argan oil", "Black soap"], "Morocco");
    expect(p).toHaveLength(5);
    expect(p[0]).toBe("Where can I buy argan oil in Morocco?");
    expect(p.join(" ")).not.toContain("uncategorized");
  });

  it("works without categories or country", () => {
    expect(suggestPrompts([], null)).toEqual(["Which online stores are good for handmade and local products?"]);
  });
});

describe("parseGeminiResponse", () => {
  it("joins text parts, skips thoughts and counts tokens", () => {
    const r = parseGeminiResponse({
      candidates: [{ content: { parts: [{ text: "thinking…", thought: true }, { text: "Hello " }, { text: "world" }] }, finishReason: "STOP" }],
      usageMetadata: { promptTokenCount: 12, candidatesTokenCount: 30, thoughtsTokenCount: 5 },
    });
    expect(r).toEqual({ text: "Hello world", finishReason: "STOP", inputTokens: 12, outputTokens: 35, blocked: null });
  });

  it("reports blocked prompts", () => {
    expect(parseGeminiResponse({ promptFeedback: { blockReason: "SAFETY" } }).blocked).toBe("SAFETY");
  });
});

describe("weekly limit", () => {
  it("allows one run every 7 days", () => {
    const now = new Date("2026-10-21T10:00:00Z");
    expect(canRun(null, now)).toBe(true);
    expect(canRun("2026-10-15T09:00:00Z", now)).toBe(false);
    expect(canRun("2026-10-14T09:00:00Z", now)).toBe(true);
    expect(nextRunAt("2026-10-15T09:00:00Z")?.toISOString()).toBe("2026-10-22T09:00:00.000Z");
  });
});
