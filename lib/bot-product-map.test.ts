import { createTranslator } from "next-intl";
import { describe, expect, it } from "vitest";
import ar from "../messages/ar.json";
import en from "../messages/en.json";
import { botProductMap, normPath, type MapClause } from "./bot-product-map";

const products = [
  { id: 174, name: "Round LED Mirror", url: "https://matha.site/product/round-led-mirror/" },
  { id: 171, name: "Rectangular Wall Mirror 80 x 120 cm", url: "https://matha.site/product/rectangular-wall-mirror-80-x-120-cm/" },
  { id: 173, name: "Custom Laser Engraved Mirror", url: "https://matha.site/product/custom-laser-engraved-mirror/" },
];
const findings = [
  { product_id: 174, title: "Product structured data is incomplete", severity: "medium" as const, basis: "observed" as const },
  { product_id: 174, title: "Feed: no GTIN or MPN", severity: "low" as const, basis: "observed" as const },
  { product_id: 171, title: "No featured image", severity: "medium" as const, basis: "observed" as const },
];
const tEn = createTranslator({ locale: "en", messages: en, namespace: "botMap" });
const tAr = createTranslator({ locale: "ar", messages: ar, namespace: "botMap" });
const say = (c: MapClause, t = tEn) => t(`clause.${c.msg}` as "clause.visited", c.values);

describe("bot → product map", () => {
  it("paths match whatever the case, query or trailing slash", () => {
    expect(normPath("/product/Round-LED-Mirror?utm=1")).toBe("/product/round-led-mirror/");
    expect(normPath("https://matha.site/product/round-led-mirror/")).toBe("/product/round-led-mirror/");
    expect(normPath("/produit/miroir-%C3%A9clair%C3%A9/")).toBe("/produit/miroir-éclairé/");
  });

  it("counts verified, user-agent-only and unchecked visits per bot; the sentence pairs visits with the first issue", () => {
    const hits = [
      ...Array.from({ length: 12 }, () => ({ bot: "GPTBot", url_path: "/product/round-led-mirror/", verified: true })),
      { bot: "GPTBot", url_path: "/product/round-led-mirror/?x=1", verified: false },
      { bot: "ClaudeBot", url_path: "/product/round-led-mirror", verified: null },
      { bot: "PerplexityBot", url_path: "/product/rectangular-wall-mirror-80-x-120-cm/", verified: false },
      ...Array.from({ length: 10 }, () => ({ bot: "OAI-SearchBot", url_path: "/robots.txt", verified: true })),
    ];
    const m = botProductMap(products, hits, findings);
    expect(m.visited.map((r) => [r.product.id, r.total])).toEqual([[174, 14], [171, 1]]);
    expect(m.visited[0].bots).toEqual([
      { bot: "GPTBot", verified: 12, claimed: 1, pending: 0 },
      { bot: "ClaudeBot", verified: 0, claimed: 0, pending: 1 },
    ]);
    expect(m.visited[0].clauses.map((c) => [c.basis, say(c)])).toEqual([
      ["observed", "GPTBot visited this product 12 times"],
      ["heuristic", "GPTBot (user agent only) 1 time"],
      ["observed", "but: Product structured data is incomplete (+1 more)"],
    ]);
    expect(m.visited[1].clauses.map((c) => c.basis)).toEqual(["heuristic", "observed"]);
    expect(say(m.visited[0].clauses[0], tAr)).toBe("زار GPTBot هذا المنتج 12 مرة");
    expect(m.unvisited.map((u) => [u.product.id, u.findings.length])).toEqual([[173, 0]]);
    expect(m.otherPages).toEqual([{ path: "/robots.txt", verified: 10, claimed: 0, pending: 0 }]);
  });

  it("matha.site today: only robots.txt visits, so every product is in the not-visited section", () => {
    const m = botProductMap(products, Array.from({ length: 10 }, () => ({ bot: "OAI-SearchBot", url_path: "/robots.txt", verified: true })), findings);
    expect(m.visited).toEqual([]);
    expect(m.unvisited).toHaveLength(3);
    expect(m.unvisited[0].findings[0].title).toBe("Product structured data is incomplete");
  });
});
