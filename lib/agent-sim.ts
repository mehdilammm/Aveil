// Agent purchase test, Mode A (F7): what an AI agent that buys through the WooCommerce Store API meets, step by
// step: robots.txt → product list → cart → add to cart → shipping address → shipping and payment methods. It never
// places an order: no POST /checkout, and no GET /checkout either (that creates a draft order). The cart is emptied
// at the end. Ownership-verified stores only (checked by the caller); AgentScopeBot user agent with
// X-AgentScope-Check; at most 3 products and 15 requests (redirect hops count), one request at a time.
// Every step is what the store answered [Observed], except "offline payment only" (what it means for an agent is
// Heuristic) and the order itself (never placed: Unavailable).
import { CHECK_HEADER, checkHeaderValue } from "./check-header";
import { decodeEntities } from "./consistency";
import { COUNTRY } from "./market-checkout";
import type { MarketId } from "./markets";
import { agentScopeAllowed, PUBLIC_UA, robotsFrom } from "./public-scan";
import type { Basis } from "./rules";
import { minorToMajor } from "./woo-store-api";

export const SIM_LIMITS = { products: 3, requests: 15, redirects: 3, gapMs: 1000 } as const;
const API = "/wp-json/wc/store/v1";
const PATHS = { products: `${API}/products`, cart: `${API}/cart`, add: `${API}/cart/add-item`, customer: `${API}/cart/update-customer`, items: `${API}/cart/items` };
const OFFLINE = new Set(["cod", "bacs", "cheque"]);

// A public place in each market (no person's data): what a shipping quote needs. State and postcode are always
// sent, empty when not used: a missing field keeps the shopper's default, which is the store's own state
// (matha.site, 2026-10-27: Casablanca without a State was quoted the Marrakech zone). WooCommerce turns a State
// name into its code ("Casablanca" → MACAS) where the country has a State list.
export const SAMPLE_ADDRESS: Record<MarketId, { country: string; state: string; city: string; postcode: string }> = {
  US: { country: "US", state: "NY", city: "New York", postcode: "10001" },
  UK: { country: "GB", state: "", city: "London", postcode: "SW1A 1AA" },
  FR: { country: "FR", state: "", city: "Paris", postcode: "75001" },
  SA: { country: "SA", state: "", city: "Riyadh", postcode: "12211" },
  AE: { country: "AE", state: "", city: "Dubai", postcode: "" },
  MA: { country: "MA", state: "Casablanca", city: "Casablanca", postcode: "20000" },
};

export type SimStepKey = "robots" | "products" | "browser" | "page" | "cart" | "add" | "address" | "shipping" | "payment" | "checkout" | "order" | "cleanup" | "budget";
export type SimOutcome = "ok" | "warn" | "stop" | "skip";
export type SimStep = { step: SimStepKey; outcome: SimOutcome; basis: Basis; code: string; values: Record<string, string | number>; http?: string };
export type SimResult = { market: MarketId; country: string; steps: SimStep[]; stoppedAt: SimStepKey | null; requests: number };

export type SimResponse = { status: number; headers: { get(name: string): string | null; getSetCookie?(): string[] }; text: string };
export type Send = (url: URL, init: { method: "GET" | "POST" | "DELETE"; headers: Record<string, string>; body?: string }) => Promise<SimResponse>;

type Answer = { ok: true; status: number; json: unknown; text: string; headers: SimResponse["headers"] } | { ok: false; error: string };
const sameSite = (a: string, b: string) => a.replace(/^www\./, "") === b.replace(/^www\./, "");
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// One shopper's session: the Cart-Token and Nonce the Store API hands out, and its cookies (same site only).
export class Session {
  requests = 0;
  private token: string | null = null;
  private nonce: string | null = null;
  private cookies = new Map<string, string>();
  private last = 0;
  constructor(public origin: string, private send: Send, private checkToken: string | null, private gapMs: number) {}

  get hasToken() {
    return Boolean(this.token);
  }

  // reserve: requests kept for emptying the cart.
  async call(method: "GET" | "POST" | "DELETE", path: string, body?: unknown, reserve = 1): Promise<Answer> {
    let url = new URL(path, this.origin);
    for (let hop = 0; hop <= SIM_LIMITS.redirects; hop++) {
      if (this.requests >= SIM_LIMITS.requests - reserve) return { ok: false, error: `the ${SIM_LIMITS.requests}-request limit was reached` };
      const wait = this.last + this.gapMs - Date.now();
      if (this.last && wait > 0) await sleep(wait);
      this.requests++;
      this.last = Date.now();
      const headers: Record<string, string> = { "User-Agent": PUBLIC_UA, Accept: path === "/robots.txt" ? "text/plain,*/*;q=0.8" : "application/json", [CHECK_HEADER]: checkHeaderValue(this.checkToken) };
      if (body !== undefined) headers["Content-Type"] = "application/json";
      if (this.token) headers["Cart-Token"] = this.token;
      if (this.nonce) headers.Nonce = this.nonce;
      if (this.cookies.size) headers.Cookie = [...this.cookies].map(([k, v]) => `${k}=${v}`).join("; ");
      let res: SimResponse;
      try {
        res = await this.send(url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
      } catch (err) {
        return { ok: false, error: (err as Error).message || "request failed" };
      }
      this.token = res.headers.get("Cart-Token") ?? this.token;
      this.nonce = res.headers.get("Nonce") ?? this.nonce;
      for (const c of res.headers.getSetCookie?.() ?? []) {
        const [pair] = c.split(";");
        const at = pair.indexOf("=");
        if (at > 0) this.cookies.set(pair.slice(0, at).trim(), pair.slice(at + 1).trim());
      }
      const location = res.headers.get("location");
      if (res.status >= 300 && res.status < 400 && location) {
        const next = new URL(location, url);
        if (method !== "GET") return { ok: false, error: `HTTP ${res.status} redirect to ${next}` };
        if (!sameSite(next.hostname, url.hostname)) return { ok: false, error: `redirected to another site (${next.host})` };
        this.origin = next.origin;
        url = next;
        continue;
      }
      let json: unknown = null;
      try {
        json = JSON.parse(res.text);
      } catch {
        // not JSON (robots.txt, an error page)
      }
      return { ok: true, status: res.status, json, text: res.text, headers: res.headers };
    }
    return { ok: false, error: "too many redirects" };
  }
}

type Cart = {
  items_count?: number;
  needs_shipping?: boolean;
  needs_payment?: boolean;
  shipping_rates?: { shipping_rates?: { name?: string; price?: string; currency_code?: string; currency_minor_unit?: number }[] }[];
  payment_methods?: string[];
  errors?: { code?: string; message?: string }[];
  totals?: { total_price?: string; currency_code?: string; currency_minor_unit?: number };
};
type StoreProduct = { id: number; name: string; type?: string; is_purchasable?: boolean; is_in_stock?: boolean };

const plain = (s: unknown) => decodeEntities(String(s ?? "").replace(/<[^>]*>/g, "")).replace(/\s+/g, " ").trim().slice(0, 200);
const errorOf = (a: Answer) => (a.ok ? { code: plain((a.json as { code?: string })?.code) || `HTTP ${a.status}`, message: plain((a.json as { message?: string })?.message) || `HTTP ${a.status}` } : { code: "request", message: a.error });
const httpOf = (a: Answer) => (a.ok ? `HTTP ${a.status}` : a.error);
const money = (minor: string | undefined, unit: number | undefined, cur: string | undefined) => {
  const n = minorToMajor(minor, unit ?? 2);
  return n === null ? "" : `${n.toFixed(unit ?? 2)}${cur ? ` ${cur}` : ""}`;
};
const isCart = (j: unknown): j is Cart => Boolean(j) && typeof j === "object" && !Array.isArray(j) && "items_count" in (j as object);

export async function simulatePurchase(input: { storeUrl: string; market: MarketId; checkToken: string | null; send: Send; gapMs?: number }): Promise<SimResult> {
  const s = new Session(new URL(input.storeUrl).origin, input.send, input.checkToken, input.gapMs ?? SIM_LIMITS.gapMs);
  const steps: SimStep[] = [];
  const add = (step: SimStepKey, outcome: SimOutcome, basis: Basis, code: string, values: Record<string, string | number> = {}, http?: string) => {
    steps.push({ step, outcome, basis, code, values, ...(http ? { http } : {}) });
  };
  const stop = (step: SimStepKey, code: string, values: Record<string, string | number> = {}, http?: string) => add(step, "stop", "observed", code, values, http);
  let added = 0;

  const flow = async () => {
    // 1. robots.txt, read first: a Disallow for AgentScopeBot on the Store API ends the test before any cart.
    const r = await s.call("GET", "/robots.txt");
    const { robots, status, detail } = robotsFrom(r.ok ? { ok: true, status: r.status, finalUrl: "", redirectedTo: null, bytes: r.text.length, body: r.text, challengeHeader: false } : { ok: false, error: r.error });
    const blocked = Object.values(PATHS).find((path) => !agentScopeAllowed(robots, path));
    if (blocked) return stop("robots", status === "server_error" ? "robotsServerError" : "robotsBlocked", { path: blocked }, httpOf(r));
    if (status === "unavailable") add("robots", "warn", "unavailable", "robotsUnread", { detail: plain(detail) }, httpOf(r));
    else add("robots", "ok", "observed", "robotsOk", {}, httpOf(r));

    // 2. Products an agent can put in a cart: simple, purchasable, in stock (variable products need a choice of options).
    const p = await s.call("GET", `${PATHS.products}?per_page=10&type=simple&_fields=id,name,type,is_purchasable,is_in_stock`);
    if (!p.ok || p.status !== 200 || !Array.isArray(p.json)) return stop("products", p.ok && p.status === 200 ? "productsNotJson" : "productsHttp", { status: httpOf(p) }, httpOf(p));
    const products = (p.json as StoreProduct[]).filter((x) => x && typeof x.id === "number" && x.is_purchasable !== false && x.is_in_stock !== false && (x.type ?? "simple") === "simple").slice(0, SIM_LIMITS.products);
    if (!products.length) return stop("products", "noProduct", { listed: (p.json as unknown[]).length }, httpOf(p));
    add("products", "ok", "observed", "productsOk", { n: products.length, names: products.map((x) => `"${plain(x.name)}"`).join(", ") }, httpOf(p));

    // 3. A cart: the Store API answers with a Cart-Token (recent WooCommerce) and a Nonce.
    const c = await s.call("GET", PATHS.cart);
    if (!c.ok || c.status !== 200 || !isCart(c.json)) return stop("cart", "cartHttp", { status: httpOf(c) }, httpOf(c));
    if (s.hasToken) add("cart", "ok", "observed", "cartOk", {}, httpOf(c));
    else add("cart", "warn", "observed", "cartNoToken", {}, httpOf(c));

    // 4. Add each product (quantity 1).
    let cart: Cart = c.json;
    for (const prod of products) {
      const a = await s.call("POST", PATHS.add, { id: prod.id, quantity: 1 });
      if (a.ok && (a.status === 200 || a.status === 201) && isCart(a.json)) {
        added++;
        cart = a.json;
        add("add", "ok", "observed", "addOk", { name: plain(prod.name) }, httpOf(a));
      } else add("add", "warn", "observed", "addError", { name: plain(prod.name), ...errorOf(a) }, httpOf(a));
    }
    if (!added) return stop("add", "addNone");

    // 5. A sample address in the market (shipping and billing alike: no name, email or phone).
    const address = SAMPLE_ADDRESS[input.market];
    const where = [address.city, address.state !== address.city ? address.state : "", address.postcode, address.country].filter(Boolean).join(", ");
    const u = await s.call("POST", PATHS.customer, { shipping_address: address, billing_address: address });
    if (!u.ok || u.status !== 200 || !isCart(u.json)) return stop("address", "addressError", { address: where, ...errorOf(u) }, httpOf(u));
    cart = u.json;
    add("address", "ok", "observed", "addressOk", { address: where }, httpOf(u));

    // 6. Shipping methods for that address.
    if (cart.needs_shipping === false) add("shipping", "ok", "observed", "shippingNotNeeded");
    else {
      const rates = (cart.shipping_rates ?? []).flatMap((pkg) => pkg.shipping_rates ?? []);
      if (!rates.length) return stop("shipping", "shippingNone", { address: where });
      add("shipping", "ok", "observed", "shippingOk", { rates: rates.map((x) => `${plain(x.name)} (${money(x.price, x.currency_minor_unit, x.currency_code)})`).join(", ") });
    }

    // 7. Payment methods offered for this cart.
    const methods = (cart.payment_methods ?? []).map(plain).filter(Boolean);
    if (cart.needs_payment === false) add("payment", "ok", "observed", "paymentNotNeeded");
    else if (!methods.length) return stop("payment", "paymentNone");
    else if (methods.every((m) => OFFLINE.has(m))) add("payment", "warn", "heuristic", "paymentOffline", { methods: methods.join(", ") });
    else add("payment", "ok", "observed", "paymentOk", { methods: methods.join(", ") });

    // 8. The order: problems the cart already reports would stop it; it is never placed.
    const errs = (cart.errors ?? []).map((e) => plain(e.message || e.code)).filter(Boolean);
    if (errs.length) return stop("order", "cartErrors", { messages: errs.join(" · ") });
    const t = cart.totals;
    add("order", "skip", "unavailable", "orderNever", { total: money(t?.total_price, t?.currency_minor_unit, t?.currency_code) });
  };

  try {
    await flow();
  } finally {
    // Empty the cart (one request is kept for this). WooCommerce also drops guest carts on its own after 48 hours.
    if (added) {
      const d = await s.call("DELETE", PATHS.items, undefined, 0);
      if (d.ok && d.status === 200) add("cleanup", "ok", "observed", "cleanupOk", {}, httpOf(d));
      else add("cleanup", "warn", "observed", "cleanupError", { status: httpOf(d) }, httpOf(d));
    }
  }
  return { market: input.market, country: COUNTRY[input.market], steps, stoppedAt: steps.find((x) => x.outcome === "stop")?.step ?? null, requests: s.requests };
}
