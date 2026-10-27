import { describe, expect, it } from "vitest";
import { consistencyFindings, llmsPriceFor, parseAmount, visibleProduct, type ConsistencyInput } from "./consistency";

// matha.site, 2026-10-27, /product/round-led-mirror/ (block theme), cut to the parts that matter.
const MATHA = `<html><head><style>.wc-block-components-product-price .woocommerce-Price-amount{white-space:nowrap}</style></head><body>
<h1 class="wp-block-post-title">Round LED Mirror</h1>
<div data-block-name="woocommerce/product-price" data-is-descendent-of-single-product-template="true" class="wp-block-woocommerce-product-price" ><div class="wc-block-components-product-price wc-block-grid__product-price has-font-size has-large-font-size" style="" >
<span class="woocommerce-Price-amount amount"><bdi><span class="woocommerce-Price-currencySymbol" translate="no" dir="auto">&#x62f;.&#x645;.</span>800.00</bdi></span>
</div></div>
<ul class="related"><li><span class="woocommerce-Price-amount amount"><bdi>500.00</bdi></span></li></ul></body></html>`;
const CLASSIC_SALE = `<body><h1 class="product_title entry-title">Tote &amp; Bag</h1><p class="price"><del><span class="woocommerce-Price-amount amount"><bdi>1.200,00&nbsp;<span class="woocommerce-Price-currencySymbol">&euro;</span></bdi></span></del> <ins><span class="woocommerce-Price-amount amount"><bdi>1.100,00&nbsp;<span class="woocommerce-Price-currencySymbol">&euro;</span></bdi></span></ins></p></body>`;
const LLMS = "## Products\n- [Round LED Mirror](https://matha.site/product/round-led-mirror/): 800 MAD, LED Mirrors\n- [Rectangular Wall Mirror 80 x 120 cm](https://matha.site/product/rectangular-wall-mirror-80-x-120-cm/): 500 MAD, Plain Mirrors";
const FMT = { currency: "MAD", decimalSep: ".", thousandSep: ",", taxes: false };
const product = { id: 174, name: "Round LED Mirror", type: "simple", price: "800", stock_status: "instock", url: "https://matha.site/product/round-led-mirror/" };
// The Store API answer for 174 on matha.site (prices in minor units).
const storeApi = { id: 174, name: "Round LED Mirror", is_in_stock: true, prices: { price: "80000", currency_code: "MAD", currency_minor_unit: 2 } };
const schema = { kind: "Product" as const, name: "Round LED Mirror", image: false, price: "800", currency: "MAD", availability: "https://schema.org/InStock", readable: true };

describe("cross-source consistency (F4)", () => {
  it("reads the title and the main price, not a related product's", () => {
    expect(visibleProduct(MATHA, FMT)).toEqual({ name: "Round LED Mirror", price: 800 });
    expect(visibleProduct(CLASSIC_SALE, { decimalSep: ",", thousandSep: "." })).toEqual({ name: "Tote & Bag", price: 1100 });
    expect(parseAmount("1,200.50", ".", ",")).toBe(1200.5);
    expect(parseAmount("no price", ".", ",")).toBeNull();
  });

  it("llms.txt lines are matched by URL", () => {
    expect(llmsPriceFor(LLMS, "https://matha.site/product/round-led-mirror/")).toBe(800);
    expect(llmsPriceFor(LLMS, "https://matha.site/product/none/")).toBeNull();
  });

  it("matha.site today: every source agrees, so no finding", () => {
    const item: ConsistencyInput = { product, html: MATHA, schema, storeApi, llmsPrice: 800 };
    expect(consistencyFindings([item], FMT)).toEqual([]);
  });

  it("each difference names both sources and values", () => {
    const item: ConsistencyInput = {
      product: { ...product, price: "1200" },
      html: MATHA.replace("800.00", "1,100.00").replace(">Round LED Mirror<", ">Round Mirror<"),
      schema: { ...schema, name: "LED Round Mirror" },
      storeApi: { ...storeApi, is_in_stock: false, prices: { price: "120000", currency_code: "EUR", currency_minor_unit: 2 } },
      llmsPrice: 800,
    };
    const f = consistencyFindings([item], FMT);
    expect(f.map((x) => [x.finding_key, x.basis, x.severity])).toEqual([
      ["consistency:name:page:174", "observed", "medium"],
      ["consistency:price:page:174", "observed", "high"],
      ["consistency:name:jsonld:174", "observed", "medium"],
      ["consistency:currency:store_api:174", "observed", "high"],
      ["consistency:stock:store_api:174", "observed", "high"],
      ["consistency:price:llms:174", "observed", "medium"],
    ]);
    expect(f[1].evidence).toBe("Price is 1200 MAD in WooCommerce but 1100 MAD on the product page (https://matha.site/product/round-led-mirror/).");
    expect(f[5].type).toBe("consistency_llms_mismatch");
  });

  it("with taxes on, a shown price that differs is Heuristic; variable products skip the price", () => {
    const item: ConsistencyInput = { product: { ...product, price: "1000" }, html: MATHA, schema: null, storeApi: null, llmsPrice: null };
    expect(consistencyFindings([item], { ...FMT, taxes: true })[0]).toMatchObject({ basis: "heuristic" });
    expect(consistencyFindings([{ ...item, product: { ...item.product, type: "variable" } }], FMT)).toEqual([]);
  });
});
