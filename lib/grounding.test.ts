import { describe, expect, it } from "vitest";
import { citationDomain, citedDomains, GROUNDING_MONTHLY_LIMIT, parseGrounding } from "./grounding";

// Shape from https://ai.google.dev/gemini-api/docs/google-search (groundingMetadata).
const metadata = {
  webSearchQueries: ["best argan oil shop morocco"],
  searchEntryPoint: { renderedContent: "<div class=\"chip\">best argan oil shop morocco</div>" },
  groundingChunks: [
    { web: { uri: "https://vertexaisearch.cloud.google.com/grounding-api-redirect/AAA", title: "etsy.com" } },
    { web: { uri: "https://vertexaisearch.cloud.google.com/grounding-api-redirect/BBB", title: "matha.site" } },
    { web: { uri: "https://vertexaisearch.cloud.google.com/grounding-api-redirect/CCC", title: "Best argan oils of 2026" } },
  ],
  groundingSupports: [
    { segment: { startIndex: 0, endIndex: 40, text: "Etsy has many argan oil sellers." }, groundingChunkIndices: [0] },
    { segment: { text: "Matha sells cold-pressed oil." }, groundingChunkIndices: [1, 7] },
  ],
};

describe("grounding", () => {
  it("cap is fixed below the free 5,000 per month", () => {
    expect(GROUNDING_MONTHLY_LIMIT).toBe(1000);
  });

  it("reads sources, domains, supports and the search suggestions", () => {
    const g = parseGrounding(metadata)!;
    expect(g.queries).toEqual(["best argan oil shop morocco"]);
    expect(g.sources.map((s) => s.domain)).toEqual(["etsy.com", "matha.site", null]);
    expect(g.supports).toEqual([{ text: "Etsy has many argan oil sellers.", sources: [0] }, { text: "Matha sells cold-pressed oil.", sources: [1] }]);
    expect(g.entryPoint).toContain("chip");
    expect(parseGrounding(undefined)).toBeNull();
    expect(parseGrounding({})).toBeNull();
  });

  it("domain from the title, else from a non-Google uri", () => {
    expect(citationDomain("www.Jumia.ma", "x")).toBe("jumia.ma");
    expect(citationDomain("A blog post", "https://blog.example.com/post")).toBe("blog.example.com");
    expect(citationDomain("A blog post", "https://vertexaisearch.cloud.google.com/x")).toBeNull();
  });

  it("counts each domain once per answer and marks the store and named competitors", () => {
    const g = parseGrounding(metadata)!;
    const s = citedDomains("www.matha.site", [
      { prompt: "q1", competitors: ["Etsy"], citations: g },
      { prompt: "q2", competitors: [], citations: { ...g, sources: [g.sources[0], g.sources[0]] } },
      { prompt: "q3", competitors: [], citations: null },
    ]);
    expect(s.grounded).toBe(2);
    expect(s.storeCited).toBe(1);
    expect(s.domains.map((d) => [d.domain, d.answers, d.isStore, d.competitor])).toEqual([
      ["etsy.com", 2, false, "Etsy"],
      ["matha.site", 1, true, null],
    ]);
    expect(s.domains[0].examples[0]).toBe("Etsy has many argan oil sellers.");
  });
});
