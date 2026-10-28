import { describe, expect, it } from "vitest";
import { canonicalsOf, hiddenFindings, normalizeUrl, robotsDirectives, sourceOf } from "./hidden-pages";

// matha.site, 2026-10-28 (pg_net, read only): the product page has its own canonical and no robots meta; the
// category page has neither.
const MATHA_PRODUCT = '<head><link rel="canonical" href="https://matha.site/product/round-led-mirror/" /><meta name="robots" content="max-image-preview:large" /></head>';

describe("accidentally hidden pages (G8)", () => {
  it("matha.site: nothing hidden", () => {
    expect(hiddenFindings([
      { url: "https://matha.site/product/round-led-mirror/", html: MATHA_PRODUCT, kind: "product", productId: 174 },
      { url: "https://matha.site/product-category/led-mirrors/", html: "<head></head>", kind: "category" },
    ], [])).toEqual([]);
  });

  it("noindex from a meta tag or the X-Robots-Tag header, with the tool that likely set it", () => {
    const yoast = '<!-- This site is optimized with the Yoast SEO plugin v25 --><meta name="robots" content="noindex, follow" />';
    const [f] = hiddenFindings([{ url: "https://s.test/product/a/", html: yoast, kind: "product", productId: 5 }], []);
    expect(f).toMatchObject({ finding_key: "hidden:noindex:/product/a/", type: "page_noindex", product_id: 5, severity: "high", basis: "observed", evidence: 'https://s.test/product/a/: <meta name="robots" content="noindex, follow">. Likely set by Yoast SEO [Heuristic].' });
    expect(f.guidance).toContain("Yoast SEO box → Advanced");
    expect(robotsDirectives("<p></p>", { "x-robots-tag": "noindex" })).toEqual({ noindex: true, where: ["X-Robots-Tag: noindex"] });
    expect(robotsDirectives('<meta name="googlebot" content="none">').noindex).toBe(true);
    expect(robotsDirectives('<meta name="robots" content="index, follow, max-image-preview:large">').noindex).toBe(false);
    expect(sourceOf("<meta name='robots' content='noindex, nofollow' />", []).name).toBe("WordPress");
    expect(sourceOf("<!-- Search Engine Optimization by Rank Math -->", []).name).toBe("Rank Math");
    expect(sourceOf("<p></p>", ["Yoast SEO"]).name).toBe("Yoast SEO");
  });

  it("canonical to another address, or two different canonicals; trailing slashes and queries do not count", () => {
    expect(normalizeUrl("https://S.test/product/a?x=1")).toBe("https://s.test/product/a");
    expect(canonicalsOf('<link href="https://s.test/" rel="canonical">')).toEqual(["https://s.test/"]);
    const pages = (html: string) => hiddenFindings([{ url: "https://s.test/product/a/?attribute_pa_size=m", html, kind: "product", productId: 5 }], []);
    expect(pages('<link rel="canonical" href="https://s.test/product/a">')).toEqual([]);
    expect(pages('<link rel="canonical" href="https://s.test/">')[0]).toMatchObject({ type: "page_canonical_elsewhere", title: "Product page says another address is the real one (canonical)", evidence: "https://s.test/product/a/?attribute_pa_size=m: canonical https://s.test/. Likely set by the theme or another plugin [Heuristic]." });
    expect(pages('<link rel="canonical" href="https://s.test/product/a/"><link rel="canonical" href="https://s.test/product/b/">')[0].title).toBe("Product page has 2 different canonical links");
  });
});
