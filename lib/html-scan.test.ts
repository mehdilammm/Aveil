import { vi } from "vitest";
vi.mock("server-only", () => ({}));
import { describe, expect, it } from "vitest";
import { attr, elements, metaContent, openTags } from "./html-scan";

describe("linear HTML scans", () => {
  it("finds tags, attributes and elements", () => {
    const html = `<head><META name="generator" content="WordPress 6.6"><meta property='og:price:amount' content=12.50><metadata x><script type="application/ld+json">{"a":1}</script></head>`;
    expect(openTags(html, "meta")).toHaveLength(2); // <metadata> is not <meta>
    expect(attr(openTags(html, "meta")[0], "content")).toBe("WordPress 6.6");
    expect(metaContent(html, /^(?:og|product):price:amount$/i)).toBe("12.50");
    expect(elements(html, "script")).toEqual([{ tag: '<script type="application/ld+json">', text: '{"a":1}' }]);
  });
  it("stays fast on hostile pages (no closing >, 2 MB)", () => {
    for (const unit of ["<meta ", "<script ", '<meta name="generator" ', "<a href=x "]) {
      const html = unit.repeat(Math.floor((2 * 1024 * 1024) / unit.length));
      const t = performance.now();
      openTags(html, "meta");
      elements(html, "script");
      metaContent(html, /generator/i);
      expect(performance.now() - t).toBeLessThan(500);
    }
  });
});

describe("store and public-check parsers stay linear on hostile HTML (audit N4)", async () => {
  const { detectPlatform, homeDescription, visiblePrice } = await import("./public-scan");
  const { extractSchemaProducts } = await import("./structured-data");
  const { visibleProduct } = await import("./consistency");
  const { orgPayload } = await import("./schema-payloads");
  const parsers: [string, (h: string) => unknown][] = [
    ["detectPlatform", (h) => detectPlatform(h)],
    ["homeDescription", (h) => homeDescription(h)],
    ["visiblePrice", (h) => visiblePrice(h)],
    ["extractSchemaProducts", (h) => extractSchemaProducts(h)],
    ["visibleProduct", (h) => visibleProduct(h, { decimalSep: ".", thousandSep: "," })],
    ["orgPayload", (h) => orgPayload([{ url: "https://x.test/", html: h }])],
  ];
  const units = ["<meta ", '<meta name="generator" ', "<script ", '<h1 class="product_title ', '<a href="x" ', '<div class="klarna '];
  it.each(parsers)("%s: 512 KB of unclosed tags in under a second", (_name, parse) => {
    for (const unit of units) {
      const html = unit.repeat(Math.floor((512 * 1024) / unit.length));
      const t = performance.now();
      parse(html);
      expect(performance.now() - t).toBeLessThan(1000);
    }
  });
});
