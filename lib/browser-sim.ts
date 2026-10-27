import "server-only";
import type { Browser, HTTPRequest, Page } from "puppeteer-core";
import { Session, type Send, type SimOutcome, type SimStep, type SimStepKey } from "./agent-sim";
import { CHECK_HEADER, checkHeaderValue } from "./check-header";
import { decodeEntities } from "./consistency";
import { detectProtection } from "./protection";
import { agentScopeAllowed, PUBLIC_UA, robotsFrom } from "./public-scan";
import type { Basis } from "./rules";
import { minorToMajor } from "./woo-store-api";

// Agent purchase test, Mode B (F7): the same path in a real headless browser (Chromium, JavaScript on): the product
// page, its Add to cart button, the cart page and the checkout page, as a shopper's browser loads them. The Place
// order button is never clicked, and every request that would create or change an order is stopped in the browser
// (non-GET to the Store API checkout or batch with a checkout call, classic ?wc-ajax=checkout). The checkout page is
// opened only on WooCommerce 11.0 and later: older versions create a draft order when it opens (Store API GET
// /checkout). One product; at most 60 s in all, 10 s of it kept for emptying the cart and closing the browser.
export const BROWSER_LIMITS = { budgetMs: 60_000, reserveMs: 10_000, stepMs: 15_000, perStoreDay: 10 } as const;
export const DRAFT_FREE_FROM = "11.0.0";

export type Launched = { browser: Browser; close: () => Promise<{ browserCpuMs: number | null }>; kill: () => void };
export type BrowserFlowResult = { mode: "browser"; steps: SimStep[]; stoppedAt: SimStepKey | null; requests: number; woocommerce: string | null; blockedWrites: number; browserCpuMs: number | null };

const API = "/wp-json/wc/store/v1";
const ADD_BUTTONS = ["button.single_add_to_cart_button", "form.cart button[type=submit]", ".wp-block-add-to-cart-form button", ".wc-block-components-product-button__button", "button[name=add-to-cart]", "a.add_to_cart_button"];
const CART_LINKS = ["a.added_to_cart", ".woocommerce-message a.wc-forward", "a.wc-block-mini-cart__footer-cart", "a.cart-contents"];
const CART_CONTENT = "table.shop_table.cart, .woocommerce-cart-form, .wc-block-cart-items, .wp-block-woocommerce-filled-cart-block";
const CHECKOUT_LINKS = "a.checkout-button, .wc-proceed-to-checkout a, a.wc-block-cart__submit-button, .wc-block-cart__submit-container a";
const CHECKOUT_FORM = "form.checkout, form.woocommerce-checkout, .wc-block-checkout";
// Requests that would create, change or place an order: stopped in the browser.
export function writesOrder(method: string, url: string, body: string | undefined): boolean {
  if (method === "GET" || method === "HEAD" || method === "OPTIONS") return false;
  let u = url;
  try {
    u = decodeURIComponent(url);
  } catch {
    // keep the raw URL
  }
  if (/wc\/store(\/v\d+)?\/checkout/.test(u) || /[?&]wc-ajax=checkout\b/.test(u) || /\/order-received\//.test(u)) return true;
  return /wc\/store(\/v\d+)?\/batch/.test(u) && /checkout/.test(body ?? "");
}

export const versionAtLeast = (v: string | null, min: string) => {
  if (!v) return false;
  const a = v.split(".").map(Number);
  const b = min.split(".").map(Number);
  for (let i = 0; i < 3; i++) if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) > (b[i] ?? 0);
  return true;
};
export const wooVersion = (html: string) => /<meta[^>]*generator[^>]*WooCommerce\s+(\d+(?:\.\d+){1,2})/i.exec(html)?.[1] ?? null;
const sameSite = (a: string, b: string) => a.replace(/^www\./, "") === b.replace(/^www\./, "");
const plain = (s: unknown) => decodeEntities(String(s ?? "").replace(/<[^>]*>/g, "")).replace(/\s+/g, " ").trim().slice(0, 200);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

class Budget extends Error {}

export async function browserPurchase(input: { storeUrl: string; checkToken: string | null; send: Send; launch: () => Promise<Launched>; budgetMs?: number }): Promise<BrowserFlowResult> {
  const started = Date.now();
  const budget = input.budgetMs ?? BROWSER_LIMITS.budgetMs;
  const softEnd = started + budget - BROWSER_LIMITS.reserveMs;
  const left = () => softEnd - Date.now();
  const within = (ms: number) => {
    const l = left();
    if (l < 1000) throw new Budget();
    return Math.min(ms, l);
  };
  const store = new URL(input.storeUrl);
  const s = new Session(store.origin, input.send, input.checkToken, 500);
  const steps: SimStep[] = [];
  const add = (step: SimStepKey, outcome: SimOutcome, basis: Basis, code: string, values: Record<string, string | number> = {}, http?: string) => {
    steps.push({ step, outcome, basis, code, values, ...(http ? { http } : {}) });
  };
  const stop = (step: SimStepKey, code: string, values: Record<string, string | number> = {}, http?: string) => add(step, "stop", "observed", code, values, http);
  let current: SimStepKey = "robots";
  let woocommerce: string | null = null;
  let blockedWrites = 0;
  let pageRequests = 0;
  let inCart = false;
  let launched: Launched | null = null;
  let page: Page | null = null;
  let killed = false;
  let browserCpuMs: number | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const flow = async () => {
    // 1. robots.txt and one product from the Store API, without the browser.
    const r = await s.call("GET", "/robots.txt");
    const { robots, status } = robotsFrom(r.ok ? { ok: true, status: r.status, finalUrl: "", redirectedTo: null, bytes: r.text.length, body: r.text, challengeHeader: false } : { ok: false, error: r.error });
    const allowed = (path: string) => agentScopeAllowed(robots, path);
    if (!allowed(`${API}/products`)) return stop("robots", status === "server_error" ? "robotsServerError" : "robotsBlocked", { path: `${API}/products` });
    add("robots", status === "unavailable" ? "warn" : "ok", status === "unavailable" ? "unavailable" : "observed", status === "unavailable" ? "robotsUnread" : "robotsOk", status === "unavailable" ? { detail: r.ok ? `HTTP ${r.status}` : r.error } : {});

    current = "products";
    const p = await s.call("GET", `${API}/products?per_page=10&type=simple&_fields=id,name,type,permalink,is_purchasable,is_in_stock`);
    if (!p.ok || p.status !== 200 || !Array.isArray(p.json)) return stop("products", p.ok && p.status === 200 ? "productsNotJson" : "productsHttp", { status: p.ok ? `HTTP ${p.status}` : p.error });
    type P = { id: number; name: string; permalink?: string; is_purchasable?: boolean; is_in_stock?: boolean };
    const product = (p.json as P[]).find((x) => x && typeof x.permalink === "string" && x.is_purchasable !== false && x.is_in_stock !== false && sameSite(new URL(x.permalink).hostname, store.hostname));
    if (!product) return stop("products", "noProduct", { listed: (p.json as unknown[]).length });
    const productUrl = new URL(product.permalink!);
    if (!allowed(productUrl.pathname)) return stop("robots", "robotsBlocked", { path: productUrl.pathname });
    add("products", "ok", "observed", "productsOk", { n: 1, names: `"${plain(product.name)}"` });

    // 2. The browser.
    current = "browser";
    try {
      launched = await input.launch();
    } catch (err) {
      return stop("browser", "browserFailed", { message: plain((err as Error).message) });
    }
    timer = setTimeout(() => {
      killed = true;
      launched?.kill();
    }, Math.max(1000, started + budget - Date.now()));
    const browser = launched.browser;
    add("browser", "ok", "observed", "browserOk", { version: plain(await browser.version()) });
    page = await browser.newPage();
    await page.setUserAgent(`${await browser.userAgent()} ${PUBLIC_UA}`);
    await page.setRequestInterception(true);
    page.on("request", (req: HTTPRequest) => {
      if (req.isInterceptResolutionHandled()) return;
      pageRequests++;
      const type = req.resourceType();
      if (type === "image" || type === "media" || type === "font") {
        req.abort("blockedbyclient").catch(() => {});
        return;
      }
      if (writesOrder(req.method(), req.url(), req.postData())) {
        blockedWrites++;
        req.abort("blockedbyclient").catch(() => {});
        return;
      }
      let host = "";
      try {
        host = new URL(req.url()).hostname;
      } catch {
        // data: and blob: URLs
      }
      const headers = host && sameSite(host, store.hostname) ? { ...req.headers(), [CHECK_HEADER.toLowerCase()]: checkHeaderValue(input.checkToken) } : req.headers();
      req.continue({ headers }).catch(() => {});
    });
    const settle = () => page!.waitForNetworkIdle({ idleTime: 500, timeout: within(4000) }).catch(() => {});

    // 3. The product page.
    current = "page";
    const res = await page.goto(productUrl.toString(), { waitUntil: "domcontentloaded", timeout: within(BROWSER_LIMITS.stepMs) });
    await settle();
    const html = await page.content();
    const st = res?.status() ?? 0;
    woocommerce = wooVersion(html);
    const protection = detectProtection({ ok: true, status: st, finalUrl: page.url(), redirectedTo: null, bytes: html.length, body: html, challengeHeader: false });
    if (protection || st >= 400) return stop("page", "pageBlocked", { status: `HTTP ${st}`, reason: plain(protection?.reason ?? `HTTP ${st}`) }, `HTTP ${st}`);
    add("page", "ok", "observed", "pageOk", { title: plain(await page.title()) }, `HTTP ${st}`);

    // 4. Add to cart with the page's own button, then ask the Store API what the cart holds (same browser session).
    current = "add";
    let button = null;
    for (const sel of ADD_BUTTONS) {
      const el = await page.$(sel);
      if (el && (await el.isVisible())) {
        button = el;
        break;
      }
    }
    if (!button) return stop("add", "buttonMissing");
    const t = within(12_000);
    const nav = page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: t }).then(() => "nav").catch(() => "none");
    const ajax = page.waitForResponse((x) => /wc\/store(\/v\d+)?\/(cart\/add-item|batch)|wc-ajax=add_to_cart/.test(x.url()), { timeout: t }).then(() => "ajax").catch(() => "none");
    await button.click();
    await Promise.race([nav, ajax]);
    await settle();
    const cart = await page.evaluate(async (path: string) => {
      const r = await fetch(path, { credentials: "same-origin", headers: { Accept: "application/json" } });
      const body = (await r.json().catch(() => null)) as { items_count?: number; totals?: { total_price?: string; currency_code?: string; currency_minor_unit?: number } } | null;
      return { status: r.status, items: body?.items_count ?? 0, totals: body?.totals ?? null };
    }, `${API}/cart`);
    if (!cart.items) {
      const notice = await page.$eval(".woocommerce-error, ul.woocommerce-error, .wc-block-components-notice-banner.is-error", (e) => e.textContent ?? "").catch(() => "");
      return notice.trim() ? stop("add", "addNotice", { notice: plain(notice) }) : stop("add", "addNotInCart");
    }
    inCart = true;
    add("add", "ok", "observed", "addInCart", { name: plain(product.name), n: cart.items });
    const totals = cart.totals;
    const minor = totals?.currency_minor_unit ?? 2;
    const total = minorToMajor(totals?.total_price, minor);
    const totalText = total === null ? "" : `${total.toFixed(minor)}${totals?.currency_code ? ` ${totals.currency_code}` : ""}`;

    // 5. The cart page, from the page's own link (else /cart/).
    current = "cart";
    let cartUrl = `${new URL(page.url()).origin}/cart/`;
    for (const sel of CART_LINKS) {
      const href = await page.$eval(sel, (a) => (a as HTMLAnchorElement).href).catch(() => null);
      if (href) {
        cartUrl = href;
        break;
      }
    }
    const cu = new URL(cartUrl);
    if (!sameSite(cu.hostname, store.hostname)) return stop("cart", "offSite", { url: cu.origin });
    if (!allowed(cu.pathname)) return stop("robots", "robotsBlocked", { path: cu.pathname });
    const cr = await page.goto(cu.toString(), { waitUntil: "domcontentloaded", timeout: within(BROWSER_LIMITS.stepMs) });
    const shown = await page.waitForSelector(CART_CONTENT, { timeout: within(10_000) }).then(Boolean).catch(() => false);
    if (!shown) return stop("cart", "cartPageEmpty", {}, `HTTP ${cr?.status() ?? 0}`);
    const link = await page.waitForSelector(CHECKOUT_LINKS, { timeout: within(6000) }).then((el) => el?.evaluate((a) => (a as HTMLAnchorElement).href ?? "")).catch(() => "");
    if (!link) return stop("cart", "cartPageNoLink", {}, `HTTP ${cr?.status() ?? 0}`);
    const co = new URL(link);
    add("cart", "ok", "observed", "cartPageOk", { path: co.pathname }, `HTTP ${cr?.status() ?? 0}`);

    // 6. The checkout page: read what it asks for; never submit it.
    current = "checkout";
    if (!versionAtLeast(woocommerce, DRAFT_FREE_FROM)) add("checkout", "skip", "unavailable", "checkoutSkipped", { version: woocommerce ?? "unknown" });
    else if (!sameSite(co.hostname, store.hostname)) return stop("checkout", "offSite", { url: co.origin });
    else if (!allowed(co.pathname)) return stop("robots", "robotsBlocked", { path: co.pathname });
    else {
      const kr = await page.goto(co.toString(), { waitUntil: "domcontentloaded", timeout: within(BROWSER_LIMITS.stepMs) });
      const form = await page.waitForSelector(CHECKOUT_FORM, { timeout: within(10_000) }).then(Boolean).catch(() => false);
      if (!form) return stop("checkout", "checkoutFailed", { status: `HTTP ${kr?.status() ?? 0}` }, `HTTP ${kr?.status() ?? 0}`);
      await page.waitForSelector(`${CHECKOUT_FORM.split(", ").map((f) => `${f} input`).join(", ")}`, { timeout: within(6000) }).catch(() => null);
      await settle();
      const seen = await page.evaluate((formSel: string) => {
        const root = document.querySelector(formSel) ?? document.body;
        const labelOf = (e: Element) => (e.id ? document.querySelector(`label[for="${CSS.escape(e.id)}"]`)?.textContent : null) || e.getAttribute("aria-label") || e.getAttribute("placeholder") || e.getAttribute("name") || e.id || "";
        const clean = (x: string) => x.replace(/\*|\((optional|required)\)/gi, "").replace(/\s+/g, " ").trim();
        const required = [...root.querySelectorAll("input, select, textarea")].filter((e) => {
          const el = e as HTMLInputElement;
          return (el.required || el.getAttribute("aria-required") === "true") && el.type !== "hidden" && (el.offsetParent !== null || el.type === "checkbox");
        });
        const fields = [...new Set(required.map((e) => clean(labelOf(e))).filter(Boolean))].slice(0, 20);
        const radios = [...root.querySelectorAll('input[name="payment_method"], input[name="radio-control-wc-payment-method-options"]')].map((e) => clean(labelOf(e) || (e as HTMLInputElement).value));
        const labels = radios.length ? [] : [...root.querySelectorAll(".wc-block-components-payment-method-label")].map((e) => clean(e.textContent ?? ""));
        const captcha = document.querySelector('iframe[src*="recaptcha"], .g-recaptcha') ? "reCAPTCHA" : document.querySelector('iframe[src*="hcaptcha"], .h-captcha') ? "hCaptcha" : document.querySelector('iframe[src*="challenges.cloudflare.com"], .cf-turnstile') ? "Turnstile" : "";
        const place = Boolean(document.querySelector("#place_order, .wc-block-components-checkout-place-order-button"));
        return { fields, methods: [...new Set([...radios, ...labels].filter(Boolean))].slice(0, 10), captcha, place };
      }, CHECKOUT_FORM);
      const fields = seen.fields.join(", ") || "none marked required";
      if (seen.methods.length) add("checkout", "ok", "observed", "checkoutOk", { fields, methods: seen.methods.join(", ") }, `HTTP ${kr?.status() ?? 0}`);
      else add("checkout", "warn", "observed", "checkoutNoMethods", { fields }, `HTTP ${kr?.status() ?? 0}`);
      if (seen.captcha) add("checkout", "warn", "heuristic", "checkoutCaptcha", { kind: seen.captcha });
      if (!seen.place) add("checkout", "warn", "observed", "placeMissing");
    }

    // 7. The order is never placed.
    current = "order";
    add("order", "skip", "unavailable", "orderNeverBrowser", { total: totalText, blocked: blockedWrites });
  };

  try {
    await flow();
  } catch (err) {
    if (killed || err instanceof Budget) add("budget", "stop", "observed", "budgetReached", { seconds: Math.round(budget / 1000) });
    else stop(current, "browserError", { message: plain((err as Error).message) });
  } finally {
    // Empty the cart from the same browser session (its Store API nonce), then close the browser.
    if (inCart && page && !killed) {
      const status = await Promise.race([
        (page as Page)
          .evaluate(async (path: string) => {
            const c = await fetch(path, { credentials: "same-origin" });
            const nonce = c.headers.get("Nonce");
            const d = await fetch(`${path}/items`, { method: "DELETE", credentials: "same-origin", headers: nonce ? { Nonce: nonce } : {} });
            return d.status;
          }, `${API}/cart`)
          .catch(() => 0),
        sleep(8000).then(() => 0),
      ]);
      if (status === 200) add("cleanup", "ok", "observed", "cleanupOk", {}, "HTTP 200");
      else add("cleanup", "warn", "observed", "cleanupError", { status: status ? `HTTP ${status}` : "no answer" });
    } else if (inCart) add("cleanup", "warn", "observed", "cleanupError", { status: "browser stopped" });
    if (timer) clearTimeout(timer);
    const l = launched as Launched | null;
    if (l) browserCpuMs = (await l.close().catch(() => ({ browserCpuMs: null }))).browserCpuMs;
  }
  return { mode: "browser", steps, stoppedAt: steps.find((x) => x.outcome === "stop")?.step ?? null, requests: s.requests + pageRequests, woocommerce, blockedWrites, browserCpuMs };
}
