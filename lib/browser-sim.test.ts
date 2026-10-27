import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it, vi } from "vitest";
import type { Send } from "./agent-sim";

vi.mock("server-only", () => ({}));
const { browserPurchase, versionAtLeast, wooVersion, writesOrder } = await import("./browser-sim");
const { costOf, treeCpuMs } = await import("./browser-sim-run");

// The container's Chromium (headless shell). The browser test is skipped where it is not installed.
const CHROME = "/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell";

// A small WooCommerce-like store with classic templates: product page with the Add to cart form, cart and checkout
// pages, the Store API cart. It records every request, and every order write that reaches it (there must be none).
function store(version: string) {
  const carts = new Map<string, number>();
  const log: { method: string; path: string; ua: string; check: string | undefined }[] = [];
  const writes: string[] = [];
  let next = 0;
  const server = http.createServer((req, res) => {
    const url = new URL(req.url!, "http://x");
    const sid = /sid=(\w+)/.exec(req.headers.cookie ?? "")?.[1];
    log.push({ method: req.method!, path: url.pathname + url.search, ua: String(req.headers["user-agent"]), check: req.headers["x-agentscope-check"] as string | undefined });
    if (req.method !== "GET" && (/wc\/store\/v1\/checkout/.test(url.pathname) || url.search.includes("wc-ajax=checkout") || url.pathname === "/checkout/")) writes.push(`${req.method} ${url.pathname}${url.search}`);
    const html = (body: string) => res.writeHead(200, { "Content-Type": "text/html" }).end(`<!doctype html><html><head><title>Mirror – Matha</title><meta name="generator" content="WooCommerce ${version}"></head><body>${body}</body></html>`);
    if (url.pathname === "/product/mirror/" && req.method === "POST") {
      const id = sid ?? `s${++next}`;
      carts.set(id, (carts.get(id) ?? 0) + 1);
      return res.writeHead(302, { Location: "/product/mirror/?added=1", "Set-Cookie": `sid=${id}; Path=/` }).end();
    }
    if (url.pathname === "/product/mirror/") {
      const added = url.searchParams.has("added") ? '<div class="woocommerce-message">"Mirror" has been added to your cart. <a href="/cart/" class="button wc-forward">View cart</a></div>' : "";
      return html(`<h1 class="product_title">Mirror</h1>${added}<img src="/big.jpg"><form class="cart" method="post" action="/product/mirror/"><button type="submit" name="add-to-cart" value="11" class="single_add_to_cart_button button">Add to cart</button></form>`);
    }
    if (url.pathname === "/wp-json/wc/store/v1/cart" && req.method === "GET") {
      const n = sid ? (carts.get(sid) ?? 0) : 0;
      return res.writeHead(200, { "Content-Type": "application/json", Nonce: "n-1" }).end(JSON.stringify({ items_count: n, totals: { total_price: String(80000 * n), currency_code: "MAD", currency_minor_unit: 2 } }));
    }
    if (url.pathname === "/wp-json/wc/store/v1/cart/items" && req.method === "DELETE") {
      if (req.headers.nonce !== "n-1") return res.writeHead(401).end("{}");
      if (sid) carts.set(sid, 0);
      return res.writeHead(200, { "Content-Type": "application/json" }).end("[]");
    }
    if (url.pathname === "/cart/") {
      const n = sid ? (carts.get(sid) ?? 0) : 0;
      return html(n ? '<form class="woocommerce-cart-form"><table class="shop_table cart"><tr><td>Mirror</td></tr></table></form><div class="wc-proceed-to-checkout"><a href="/checkout/" class="checkout-button button">Proceed to checkout</a></div>' : "<p>Your cart is empty.</p>");
    }
    if (url.pathname === "/checkout/") {
      return html(`<form name="checkout" method="post" class="checkout woocommerce-checkout" action="/checkout/">
        <p><label for="billing_email">Email address&nbsp;<abbr class="required">*</abbr></label><input type="email" id="billing_email" name="billing_email" required></p>
        <p><label for="billing_first_name">First name *</label><input id="billing_first_name" name="billing_first_name" required></p>
        <p><label for="billing_phone">Phone (optional)</label><input id="billing_phone" name="billing_phone"></p>
        <input type="hidden" name="_wpnonce" value="x" required>
        <ul class="wc_payment_methods"><li><input type="radio" id="payment_method_cod" name="payment_method" value="cod" checked><label for="payment_method_cod">Cash on delivery</label></li></ul>
        <button type="submit" id="place_order">Place order</button></form>
        <script>fetch("/wp-json/wc/store/v1/checkout", { method: "PUT", body: "{}" }).catch(() => {}); fetch("/?wc-ajax=checkout", { method: "POST", body: "a=1" }).catch(() => {});</script>`);
    }
    res.writeHead(404).end("not found");
  });
  return { server, carts, log, writes };
}

async function listen(s: http.Server) {
  await new Promise<void>((r) => s.listen(0, "127.0.0.1", r));
  return `http://127.0.0.1:${(s.address() as AddressInfo).port}`;
}

// robots.txt and the Store API product list, answered for the Node side of the test.
const nodeSide = (origin: string, robots = "User-agent: *\nDisallow: /wp-admin/\n"): Send => async (url) => {
  if (url.pathname === "/robots.txt") return { status: 200, headers: { get: () => null }, text: robots };
  return { status: 200, headers: { get: () => null }, text: JSON.stringify([{ id: 11, name: "Mirror", type: "simple", permalink: `${origin}/product/mirror/`, is_purchasable: true, is_in_stock: true }]) };
};

async function launchLocal() {
  const puppeteer = (await import("puppeteer-core")).default;
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: "shell", args: ["--no-sandbox"] });
  return { browser, kill: () => browser.process()?.kill("SIGKILL"), close: async () => (await browser.close(), { browserCpuMs: 5 }) };
}

describe("agent purchase test in a real browser, Mode B (F7)", () => {
  it("order writes are recognised, whatever the route form", () => {
    expect(writesOrder("PUT", "https://s.example/wp-json/wc/store/v1/checkout", "{}")).toBe(true);
    expect(writesOrder("POST", "https://s.example/?rest_route=%2Fwc%2Fstore%2Fv1%2Fcheckout", "")).toBe(true);
    expect(writesOrder("POST", "https://s.example/?wc-ajax=checkout", "a=1")).toBe(true);
    expect(writesOrder("POST", "https://s.example/wp-json/wc/store/v1/batch", '{"requests":[{"path":"/wc/store/v1/checkout"}]}')).toBe(true);
    expect(writesOrder("POST", "https://s.example/wp-json/wc/store/v1/batch", '{"requests":[{"path":"/wc/store/v1/cart/add-item"}]}')).toBe(false);
    expect(writesOrder("POST", "https://s.example/?wc-ajax=update_order_review", "")).toBe(false);
    expect(writesOrder("GET", "https://s.example/wp-json/wc/store/v1/checkout", undefined)).toBe(false);
    expect(writesOrder("DELETE", "https://s.example/wp-json/wc/store/v1/cart/items", undefined)).toBe(false);
  });

  it("WooCommerce version from the generator tag; the checkout page opens only from 11.0", () => {
    expect(wooVersion('<meta name="generator" content="WooCommerce 11.2.1" />')).toBe("11.2.1");
    expect(wooVersion("<p>no tag</p>")).toBeNull();
    expect(versionAtLeast("11.2.1", "11.0.0")).toBe(true);
    expect(versionAtLeast("11.0", "11.0.0")).toBe(true);
    expect(versionAtLeast("10.8.0", "11.0.0")).toBe(false);
    expect(versionAtLeast(null, "11.0.0")).toBe(false);
  });

  it("cost per run from CPU and memory time at the list prices; CPU of a process tree from /proc", () => {
    // 10 s of CPU in all, 2 GB held for 40 s: 10/3600 × 0.128 + 2 × 40/3600 × 0.0106 = 0.000356 + 0.000236 USD.
    expect(costOf({ wallMs: 40_000, nodeCpuMs: 1000, browserCpuMs: 9000, memoryMb: 2048 })).toBe(591);
    const proc = mkdtempSync(join(tmpdir(), "proc-"));
    const stat = (pid: number, ppid: number, u: number, s: number) => {
      mkdirSync(join(proc, String(pid)));
      writeFileSync(join(proc, String(pid), "stat"), `${pid} (chrome (x)) S ${ppid} 1 1 0 -1 0 0 0 0 0 ${u} ${s} 0 0 20 0`);
    };
    stat(100, 1, 50, 10);
    stat(101, 100, 200, 40);
    stat(102, 101, 30, 0);
    stat(200, 1, 999, 999);
    expect(treeCpuMs(100, proc)).toBe((60 + 240 + 30) * 10);
    expect(treeCpuMs(999, proc)).toBeNull();
  });

  describe.skipIf(!existsSync(CHROME))("with Chromium", () => {
    const servers: http.Server[] = [];
    afterAll(() => servers.forEach((s) => s.close()));

    it("WooCommerce 11.2.1: product page → Add to cart → cart page → checkout page read; no order write reaches the store; cart emptied", async () => {
      const s = store("11.2.1");
      servers.push(s.server);
      const origin = await listen(s.server);
      const r = await browserPurchase({ storeUrl: origin, checkToken: null, send: nodeSide(origin), launch: launchLocal });
      expect(r.steps.map((x) => [x.step, x.outcome, x.code])).toEqual([
        ["robots", "ok", "robotsOk"],
        ["products", "ok", "productsOk"],
        ["browser", "ok", "browserOk"],
        ["page", "ok", "pageOk"],
        ["add", "ok", "addInCart"],
        ["cart", "ok", "cartPageOk"],
        ["checkout", "ok", "checkoutOk"],
        ["order", "skip", "orderNeverBrowser"],
        ["cleanup", "ok", "cleanupOk"],
      ]);
      expect(r.stoppedAt).toBeNull();
      expect(r.woocommerce).toBe("11.2.1");
      expect(r.steps.find((x) => x.code === "checkoutOk")!.values).toEqual({ fields: "Email address, First name", methods: "Cash on delivery" });
      expect(r.steps.find((x) => x.code === "orderNeverBrowser")!.values).toEqual({ total: "800.00 MAD", blocked: 2 });
      expect(r.blockedWrites).toBe(2);
      expect(s.writes).toEqual([]);
      expect([...s.carts.values()]).toEqual([0]);
      expect(s.log.some((l) => l.path === "/big.jpg")).toBe(false);
      for (const l of s.log) {
        expect(l.ua).toMatch(/AgentScopeBot\/1\.0/);
        expect(l.check).toBe("1");
      }
      expect(r.browserCpuMs).toBe(5);
    }, 60_000);

    it("WooCommerce 10.8: the checkout page is not opened (it would create a draft order)", async () => {
      const s = store("10.8.0");
      servers.push(s.server);
      const origin = await listen(s.server);
      const r = await browserPurchase({ storeUrl: origin, checkToken: null, send: nodeSide(origin), launch: launchLocal });
      expect(r.steps.find((x) => x.step === "checkout")).toMatchObject({ outcome: "skip", basis: "unavailable", code: "checkoutSkipped", values: { version: "10.8.0" } });
      expect(s.log.some((l) => l.path.startsWith("/checkout/"))).toBe(false);
      expect(r.steps.at(-1)!.code).toBe("cleanupOk");
    }, 60_000);

    it("robots.txt Disallow on the product page: no browser is started", async () => {
      const s = store("11.2.1");
      servers.push(s.server);
      const origin = await listen(s.server);
      let launched = false;
      const r = await browserPurchase({ storeUrl: origin, checkToken: null, send: nodeSide(origin, "User-agent: AgentScopeBot\nDisallow: /product/\n"), launch: async () => ((launched = true), launchLocal()) });
      expect(r.steps.at(-1)).toMatchObject({ step: "robots", outcome: "stop", code: "robotsBlocked", values: { path: "/product/mirror/" } });
      expect(launched).toBe(false);
      expect(s.log).toEqual([]);
    }, 30_000);

    it("the time limit stops the test", async () => {
      const s = store("11.2.1");
      servers.push(s.server);
      const origin = await listen(s.server);
      const r = await browserPurchase({ storeUrl: origin, checkToken: null, send: nodeSide(origin), launch: launchLocal, budgetMs: 10_500 });
      expect(r.stoppedAt).toBe("budget");
      expect(r.steps.at(-1)).toMatchObject({ code: "budgetReached" });
    }, 30_000);
  });
});
