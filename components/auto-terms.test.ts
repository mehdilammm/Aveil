import { describe, expect, it } from "vitest";
import { termParts } from "./auto-terms";

describe("glossary words inside report text", () => {
  it("marks each known word once, in English and Arabic, whole words only", () => {
    expect(termParts("No llms.txt (information only)")).toEqual(["No ", { k: "llms_txt", word: "llms.txt" }, " (information only)"]);
    expect(termParts("robots.txt blocks GPTBot; robots.txt again")).toEqual([{ k: "robots_txt", word: "robots.txt" }, " blocks ", { k: "ai_crawler", word: "GPTBot" }, "; robots.txt again"]);
    expect(termParts("لا توجد بيانات منظمة للمنتج (Product)")).toEqual(["لا توجد ", { k: "structured_data", word: "بيانات منظمة" }, " للمنتج (Product)"]);
    expect(termParts("CACPX and ACP")).toEqual(["CACPX and ", { k: "ucp_acp", word: "ACP" }]);
    expect(termParts("plain text")).toEqual(["plain text"]);
  });
});
