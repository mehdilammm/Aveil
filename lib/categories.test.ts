import { describe, expect, it } from "vitest";
import { areaOf } from "./categories";

describe("areaOf", () => {
  it("maps finding types to areas", () => {
    expect(areaOf({ type: "price_missing", finding_key: "price_missing:1" })).toBe("feed");
    expect(areaOf({ type: "feed_brand_missing", finding_key: "feed_brand_missing:1" })).toBe("feed");
    expect(areaOf({ type: "image_missing", finding_key: "image_missing:1" })).toBe("feed");
    expect(areaOf({ type: "access_blocked", finding_key: "access:GPTBot" })).toBe("access");
    expect(areaOf({ type: "robots_blocks_bot", finding_key: "robots:GPTBot" })).toBe("structured_data");
    expect(areaOf({ type: "schema_price_mismatch", finding_key: "schema_price_mismatch:1" })).toBe("structured_data");
    expect(areaOf({ type: "llms_txt_missing", finding_key: "llms_txt:missing" })).toBe("structured_data");
    expect(areaOf({ type: "terms_page_missing", finding_key: "page:terms" })).toBe("store_pages");
    expect(areaOf({ type: "page_check_unavailable", finding_key: "page:cart:unavailable" })).toBe("store_pages");
  });
});
