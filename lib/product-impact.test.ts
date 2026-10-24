import { createTranslator } from "next-intl";
import { describe, expect, it } from "vitest";
import ar from "../messages/ar.json";
import en from "../messages/en.json";
import { productImpact, relatedAnswers, type Clause } from "./product-impact";

const tEn = createTranslator({ locale: "en", messages: en, namespace: "impact" });
const tAr = createTranslator({ locale: "ar", messages: ar, namespace: "impact" });
const say = (c: Clause, t = tEn) => t(`clause.${c.msg}`, c.values);

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
    expect(c.map((x) => [x.key, x.basis, say(x)])).toEqual([
      ["readiness", "observed", "2 readiness gaps (1 critical): No price; No Product structured data"],
      ["visibility", "observed", "the store was named in 0 of 1 AI answer to questions about Laser Engraved Mirrors (model answers, not rankings)"],
      ["traffic", "unavailable", "AI bot visits per page need plugin 1.5.0 with traffic capture on"],
    ]);
    expect(c.map((x) => say(x, tAr))).toEqual([
      "ثغرتا جاهزية (1 حرجة): No price; No Product structured data",
      "ذُكر المتجر في 0 من إجابة واحدة للذكاء الاصطناعي عن أسئلة حول Laser Engraved Mirrors (إجابات نموذج، وليست ترتيبًا)",
      "زيارات روبوتات الذكاء الاصطناعي لكل صفحة تحتاج الإضافة 1.5.0 مع تفعيل رصد الزيارات",
    ]);
  });

  it("questions match the category with or without the plural; unrelated ones do not", () => {
    expect(relatedAnswers({ product: { id: 1, name: "Round LED Mirror", categories: ["LED Mirrors"] }, answers }).map((a) => a.prompt)).toEqual(["Where can I buy a LED mirror for a small bathroom?"]);
  });

  it("no question, no answer, user-agent-only visits: said as such", () => {
    const c = productImpact({ product: { id: 2, name: "Rug", categories: ["Rugs"] }, findings: [], answers, hits: { verified: 0, claim: 3, pending: 0 }, days: 30 });
    expect(c.map((x) => [x.basis, say(x)])).toEqual([
      ["observed", "no readiness gap in the last scan"],
      ["unavailable", "no AI Visibility question about Rugs yet"],
      ["heuristic", "3 AI bot visits claimed by user agent only in 30 days, none verified"],
    ]);
  });

  it("Arabic plural forms and the verified-plus-claimed clause", () => {
    const visits = (verified: number, claim: number) => say(productImpact({ product, findings: [], answers: [], hits: { verified, claim, pending: 0 }, days: 30 })[2], tAr);
    expect(visits(1, 0)).toBe("زيارة موثقة واحدة من روبوتات الذكاء الاصطناعي لصفحته خلال 30 يومًا");
    expect(visits(2, 0)).toBe("زيارتان موثقتان من روبوتات الذكاء الاصطناعي لصفحته خلال 30 يومًا");
    expect(visits(5, 2)).toBe("5 زيارات موثقة من روبوتات الذكاء الاصطناعي لصفحته خلال 30 يومًا (+2 حسب وكيل المستخدم فقط)");
    expect(visits(12, 0)).toBe("12 زيارة موثقة من روبوتات الذكاء الاصطناعي لصفحته خلال 30 يومًا");
    expect(say(productImpact({ product, findings: [], answers: [], hits: { verified: 3, claim: 1, pending: 0 }, days: 30 })[2])).toBe("3 verified AI bot visits to its page in 30 days (+1 user-agent only)");
  });

  it("every clause message formats in both languages", () => {
    for (const msg of Object.keys(en.impact.clause)) {
      const values = { count: 3, critical: 1, titles: "No price", topic: "Rugs", named: 1, total: 4, verified: 2, claim: 1, days: 30 };
      for (const t of [tEn, tAr]) expect(t(`clause.${msg}` as "clause.gaps", values)).not.toMatch(/[{}]|clause\./);
    }
  });
});
