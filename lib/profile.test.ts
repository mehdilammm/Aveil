import { describe, expect, it } from "vitest";
import { parseProfile, PROFILE_JSON_SCHEMA, summarizeProfiles } from "./profile";

const answer = `1. **Matha** — a small shop selling handmade argan oil from Morocco, with free shipping in Europe.
2. **Etsy** — a large marketplace with many sellers; prices vary and quality is uneven.
3. **Amazon** — fast delivery.`;

const reply = JSON.stringify({
  store: { sentiment: "positive", description: "A small shop selling handmade argan oil from Morocco.", features: ["handmade argan oil", "free shipping in Europe", "organic certified"] },
  competitors: [
    { name: "Etsy", sentiment: "neutral", description: "A large marketplace with uneven quality.", features: ["many sellers", "quality is uneven"] },
    { name: "Jumia", sentiment: "positive", description: "Invented.", features: [] },
    { name: "etsy.com", sentiment: "positive", description: "dup", features: [] },
  ],
});

describe("brand profile", () => {
  it("keeps only competitors the extraction found and features whose words are in the answer", () => {
    const p = parseProfile(reply, answer, true, ["Etsy", "Amazon"])!;
    expect(p.store).toEqual({ sentiment: "positive", description: "A small shop selling handmade argan oil from Morocco.", features: ["handmade argan oil", "free shipping in Europe"] });
    expect(p.competitors.map((c) => c.name)).toEqual(["Etsy"]);
    expect(p.competitors[0].features).toEqual(["many sellers", "quality is uneven"]);
  });

  it("the text match decides whether the store is mentioned, not the model", () => {
    const p = parseProfile(reply, answer, false, ["Etsy"])!;
    expect(p.store).toEqual({ sentiment: "not_mentioned", description: null, features: [] });
    const q = parseProfile(JSON.stringify({ store: { sentiment: "not_mentioned", description: null, features: [] }, competitors: [] }), answer, true, [])!;
    expect(q.store.sentiment).toBeNull();
  });

  it("rejects replies that are not a profile", () => {
    expect(parseProfile("not json", answer, true, [])).toBeNull();
    expect(parseProfile('{"brands": []}', answer, true, [])).toBeNull();
  });

  it("schema: strict mode needs every property required, nullable description", () => {
    expect(PROFILE_JSON_SCHEMA.required).toEqual(["store", "competitors"]);
    expect(PROFILE_JSON_SCHEMA.properties.store.properties.description.type).toEqual(["string", "null"]);
    expect(PROFILE_JSON_SCHEMA.properties.competitors.items.required).toEqual(["name", "sentiment", "description", "features"]);
  });

  it("summarizes a run: counts from real answers, unprofiled answers counted as unclassified", () => {
    const p = parseProfile(reply, answer, true, ["Etsy", "Amazon"]);
    const s = summarizeProfiles("Matha", [
      { prompt: "best argan oil?", mentioned: true, competitors: ["Etsy", "Amazon"], profile: p },
      { prompt: "argan oil shop?", mentioned: false, competitors: ["Etsy"], profile: null },
      { prompt: "gift?", mentioned: false, competitors: [], profile: null },
    ]);
    expect(s.answers).toBe(3);
    expect(s.profiled).toBe(1);
    expect(s.store.questions).toBe(1);
    expect(s.store.sentiment).toEqual({ positive: 1, neutral: 0, negative: 0, unclassified: 0 });
    expect(s.competitors.map((c) => [c.name, c.questions])).toEqual([["Etsy", 2], ["Amazon", 1]]);
    expect(s.competitors[0].sentiment).toEqual({ positive: 0, neutral: 1, negative: 0, unclassified: 1 });
    expect(s.competitors[1].sentiment.unclassified).toBe(1);
  });
});
