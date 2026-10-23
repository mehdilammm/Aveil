import { describe, expect, it } from "vitest";
import { productImpact, relatedAnswers } from "./product-impact";

// matha.site product 173 (no price) and its real questions of 2026-10-22.
const product = { id: 173, name: "Custom Laser Engraved Mirror", categories: ["Laser Engraved Mirrors"] };
const answers = [
  { prompt: "What is the price range for laser engraved mirrors?", mentioned: false, error: null },
  { prompt: "Where can I buy a LED mirror for a small bathroom?", mentioned: false, error: null },
  { prompt: "Which mirror is best for a gift for a new mom?", mentioned: null, error: "Skipped: time limit" },
];

describe("Product Impact summary", () => {
  it("three clauses, each with its own badge, from real data only", () => {
    const c = productImpact({
      product,
      findings: [{ title: "No price", severity: "high", basis: "observed" }, { title: "No Product structured data", severity: "medium", basis: "observed" }],
      answers,
      hits: null,
      days: 30,
    });
    expect(c).toEqual([
      { key: "readiness", basis: "observed", text: "2 readiness gaps (1 critical): No price; No Product structured data" },
      { key: "visibility", basis: "observed", text: "the store was named in 0 of 1 AI answer to questions about Laser Engraved Mirrors (model answers, not rankings)" },
      { key: "traffic", basis: "unavailable", text: "AI bot visits per page need plugin 1.5.0 with traffic capture on" },
    ]);
  });

  it("questions match the category with or without the plural; unrelated ones do not", () => {
    expect(relatedAnswers({ product: { id: 1, name: "Round LED Mirror", categories: ["LED Mirrors"] }, answers }).map((a) => a.prompt)).toEqual(["Where can I buy a LED mirror for a small bathroom?"]);
  });

  it("no question, no answer, user-agent-only visits: said as such", () => {
    const c = productImpact({ product: { id: 2, name: "Rug", categories: ["Rugs"] }, findings: [], answers, hits: { verified: 0, claim: 3, pending: 0 }, days: 30 });
    expect(c.map((x) => [x.basis, x.text])).toEqual([
      ["observed", "no readiness gap in the last scan"],
      ["unavailable", "no AI Visibility question about Rugs yet"],
      ["heuristic", "3 AI bot visits claimed by user agent only in 30 days, none verified"],
    ]);
  });
});
