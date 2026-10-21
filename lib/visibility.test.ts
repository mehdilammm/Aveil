import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { analyzeAnswer, brandTerms, canRun, cleanCompetitors, combineAnalysis, extractionProblem, nextRunAt, normalizeName, parseExtraction, parseGeminiResponse, registrableDomain, suggestPrompts } from "./visibility";

const terms = brandTerms("Matha test", "https://www.matha.site");

describe("brandTerms", () => {
  it("uses the store name and the domain", () => {
    expect(terms).toEqual({ names: ["Matha test", "matha"], host: "matha.site", keys: ["mathatest", "matha"] });
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

  it("does not count the name inside another word as a mention, but does not list same-brand names as competitors", () => {
    const a = analyzeAnswer("1. **Mathabeauty** - cosmetics\n2. **Mathematics shop**: books", terms);
    expect(a.mentioned).toBe(false);
    expect(a.rank).toBeNull();
    expect(a.competitors).toEqual(["Mathematics shop"]);
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

describe("real Gemini answer: handmade shops in Morocco (fixture)", () => {
  const answer = readFileSync(join(__dirname, "fixtures/gemini-handmade-morocco.md"), "utf8");
  const extractionText = readFileSync(join(__dirname, "fixtures/gemini-handmade-morocco.extraction.json"), "utf8");
  const expected = ["Chabi Chic", "Anou", "MTAAR", "Lalla and Mint", "Etsy"];
  const noise = ["What they sell", "Why it’s good", "Tip", "Instagram", "Customization", "Shipping", "Authentication"];

  it("text heuristic alone finds the five shops and none of the labels", () => {
    const a = analyzeAnswer(answer, terms);
    expect(a.competitors).toEqual(expected);
    expect(a.mentioned).toBe(false);
    for (const n of noise) expect(a.competitors).not.toContain(n);
  });

  it("structured extraction is parsed and filtered to the same five", () => {
    const extraction = parseExtraction(extractionText);
    expect(extraction).not.toBeNull();
    const a = combineAnalysis(answer, terms, extraction);
    expect(a.method).toBe("model");
    expect(a.competitors).toEqual(expected);
    // "mentioned" comes from the text, not from the model's claim.
    expect(a.mentioned).toBe(false);
    expect(a.rank).toBeNull();
  });

  it("shows no names when the extraction is not valid JSON (no text guessing)", () => {
    const a = combineAnalysis(answer, terms, parseExtraction("not json"));
    expect(a.method).toBe("failed");
    expect(a.competitors).toEqual([]);
    expect(a.mentioned).toBe(false);
  });
});

describe("cleanCompetitors", () => {
  it("drops labels, names ending with a colon, section-like names and the store", () => {
    expect(cleanCompetitors(["Tip", "Note:", "Why it's good", "Shipping", "Price", "Moroccan Epicerie / Local Cooperatives", "matha.site", "Anou (The Anou Cooperative)", "Etsy", "etsy"], terms)).toEqual(["Anou", "Etsy"]);
  });
});

describe("real Gemini answer: sa.made-in-china.com (fixture)", () => {
  const answer = readFileSync(join(__dirname, "fixtures/gemini-made-in-china.md"), "utf8");
  const extractionText = readFileSync(join(__dirname, "fixtures/gemini-made-in-china.extraction.json"), "utf8");
  const mic = brandTerms("sa.made-in-china.com", "https://sa.made-in-china.com");
  const expected = ["Alibaba", "Global Sources", "DHgate", "AliExpress"];
  const excluded = ["SGS", "Bureau Veritas", "TÜV Rheinland", "Made-in-China.com", "Made-in-China", "Alibaba.com", "SourcinBox", "LeelineSourcing", "PassDrop"];

  it("treats the parent domain as the store", () => {
    expect(registrableDomain("sa.made-in-china.com")).toBe("made-in-china.com");
    expect(registrableDomain("shop.example.co.uk")).toBe("example.co.uk");
    expect(mic.host).toBe("made-in-china.com");
  });

  it("structured extraction keeps stores, marketplaces and brands, de-duplicated, without the store", () => {
    const a = combineAnalysis(answer, mic, parseExtraction(extractionText));
    expect(a.method).toBe("model");
    expect(a.competitors).toEqual(expected);
    for (const n of excluded) expect(a.competitors).not.toContain(n);
    expect(a.mentioned).toBe(true); // the question names the domain, so this answer always does
  });

  it("text heuristic alone gives the same list, without inspection companies or section titles", () => {
    const a = analyzeAnswer(answer, mic);
    expect(a.competitors).toEqual(expected);
  });
});

describe("normalizeName", () => {
  it("merges the same company written differently", () => {
    expect(normalizeName("Alibaba")).toBe(normalizeName("Alibaba.com"));
    expect(normalizeName("Etsy, Inc.")).toBe("etsy");
    expect(normalizeName("TÜV Rheinland")).toBe("tuvrheinland");
    expect(normalizeName("https://www.DHgate.com/shop")).toBe("dhgate");
  });
});

describe("extraction replies that are not clean JSON", () => {
  it("keeps the complete entries of a reply cut off by the token limit", () => {
    const cut = '{"brands":[{"name":"Frontgate","type":"store","url_if_present":null},{"name":"Polywood","type":"brand","url_if_present":null},{"name":"Wayf';
    const x = parseExtraction(cut);
    expect(x?.brands.map((b) => b.name)).toEqual(["Frontgate", "Polywood"]);
    expect(extractionProblem({ ok: true, text: cut, finishReason: "MAX_TOKENS" })).toBeNull();
  });

  it("accepts a reply wrapped in a code fence", () => {
    expect(parseExtraction('```json\n{"brands":[{"name":"Etsy","type":"marketplace"}],"store_mentioned":false}\n```')?.brands[0].name).toBe("Etsy");
  });

  it("says why an extraction failed", () => {
    expect(extractionProblem({ ok: false, error: "Gemini API error 400: bad schema" })).toBe("Gemini API error 400: bad schema");
    expect(extractionProblem({ ok: true, text: "", finishReason: "MAX_TOKENS" })).toBe("empty reply (finish reason MAX_TOKENS)");
    expect(extractionProblem({ ok: true, text: "{oops", finishReason: "MAX_TOKENS" })).toBe("reply was not valid JSON (finish reason MAX_TOKENS)");
  });
});
