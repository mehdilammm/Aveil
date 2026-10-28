// Checkout checks: what can stop a shopper sent by AI, or an AI agent, from completing a purchase. Read-only, from the
// WooCommerce settings, shipping and payment APIs and the public checkout page. Rules that are judgement calls are
// HEURISTIC. None of this guarantees sales.
import { BLOCK_STATUS, CHALLENGE_RE } from "./access";
import type { Source } from "./pages";
import type { Finding } from "./rules";
import type { PageFetch } from "./woo";

// methods: settings values by id (cost, requires, min_amount, class_cost_<id>, ...) when the API returned them.
export type ShippingZone = { id: number; name: string; locations: { code: string; type: string }[]; methods: { method_id: string; enabled: boolean; title?: string; settings?: Record<string, string> }[] };
export type Gateway = { id: string; title: string; enabled: boolean };

export type CheckoutInput = {
  storeUrl: string;
  settings: Source<Record<string, string>>; // includes woocommerce_enable_guest_checkout, woocommerce_allowed_countries, ...
  zones: Source<ShippingZone[]>;
  gateways: Source<Gateway[]>;
  // botRetried: the bot request got a 429 and was retried once after waiting.
  checkoutPage: { url: string; browser: PageFetch; bot: PageFetch; botRetried?: boolean } | null;
  products: { total: number; outOfStock: number; needShipping: number };
};

// Offline payment methods: an AI agent that pays for the buyer needs an online one.
export const OFFLINE_GATEWAYS = new Set(["cod", "bacs", "cheque"]);
const CAPTCHA_RE = /g-recaptcha|recaptcha\/api\.js|grecaptcha|hcaptcha\.com|h-captcha|challenges\.cloudflare\.com\/turnstile|cf-turnstile|friendlycaptcha|frc-captcha/i;

const f = (key: string, type: string, x: Omit<Finding, "finding_key" | "type" | "product_id">): Finding => ({ finding_key: `checkout:${key}`, type: `checkout_${type}`, product_id: null, ...x });

export function checkCheckout(input: CheckoutInput): Finding[] {
  const out: Finding[] = [];
  const admin = (path: string) => `${input.storeUrl}/wp-admin/${path}`;

  // Guest checkout
  if (input.settings.ok && (input.settings.data.woocommerce_enable_guest_checkout ?? "").toLowerCase() === "no") {
    out.push(f("guest_disabled", "guest_disabled", {
      title: "Guest checkout is off: buyers must create an account",
      severity: "high",
      basis: "observed",
      evidence: "WooCommerce setting woocommerce_enable_guest_checkout is \"no\".",
      guidance: "Allow customers to place orders without an account (WooCommerce → Settings → Accounts & Privacy). An AI agent cannot create an account for the buyer, and many shoppers coming from an AI answer leave at a forced sign-up.",
      fix_url: admin("admin.php?page=wc-settings&tab=account"),
    }));
  }

  // Shipping
  if (input.zones.ok && input.products.needShipping > 0) {
    const zones = input.zones.data;
    const enabled = zones.filter((z) => z.methods.some((m) => m.enabled));
    if (!enabled.length) {
      out.push(f("no_shipping_method", "no_shipping_method", {
        title: "No shipping method is enabled",
        severity: "high",
        basis: "observed",
        evidence: `${zones.length} shipping zone(s), none with an enabled shipping method, and ${input.products.needShipping} products need shipping.`,
        guidance: "Add a shipping method (flat rate, free shipping or local pickup) to the zones you deliver to (WooCommerce → Settings → Shipping). Without one, checkout cannot complete.",
        fix_url: admin("admin.php?page=wc-settings&tab=shipping"),
      }));
    } else {
      const restOfWorld = zones.find((z) => z.id === 0);
      const sellsEverywhere = input.settings.ok && (input.settings.data.woocommerce_allowed_countries ?? "") === "all" && ["", "all"].includes(input.settings.data.woocommerce_ship_to_countries ?? "");
      if (sellsEverywhere && restOfWorld && !restOfWorld.methods.some((m) => m.enabled)) {
        const covered = [...new Set(enabled.flatMap((z) => z.locations.filter((l) => l.type === "country").map((l) => l.code)))];
        out.push(f("shipping_gap", "shipping_gap", {
          title: "The store sells to all countries but ships only to some",
          severity: "medium",
          basis: "observed",
          evidence: `Selling locations: all countries. Shipping methods only in: ${enabled.map((z) => z.name).join(", ")}${covered.length ? ` (${covered.join(", ")})` : ""}; "Locations not covered by your other zones" has no method.`,
          guidance: "Buyers elsewhere reach checkout and find no shipping option. Either limit selling locations to where you deliver (WooCommerce → Settings → General → Selling location(s)) or add a method to the other zones.",
          fix_url: admin("admin.php?page=wc-settings&tab=shipping"),
        }));
      }
    }
  }

  // Payment
  if (input.gateways.ok) {
    const on = input.gateways.data.filter((g) => g.enabled);
    if (!on.length) {
      out.push(f("no_payment", "no_payment", {
        title: "No payment method is enabled",
        severity: "high",
        basis: "observed",
        evidence: `${input.gateways.data.length} payment methods installed, none enabled.`,
        guidance: "Enable at least one payment method (WooCommerce → Settings → Payments).",
        fix_url: admin("admin.php?page=wc-settings&tab=checkout"),
      }));
    } else if (on.every((g) => OFFLINE_GATEWAYS.has(g.id))) {
      out.push(f("offline_payment_only", "offline_payment_only", {
        title: "Only offline payment (no online payment)",
        severity: "low",
        basis: "heuristic",
        evidence: `Enabled payment methods: ${on.map((g) => g.title || g.id).join(", ")}.`,
        guidance: "Information: some AI agents can only complete a purchase with an online payment method (card or wallet). Shoppers sent by AI can still pay cash on delivery. Add an online method if you want agents to buy for the buyer.",
        fix_url: admin("admin.php?page=wc-settings&tab=checkout"),
      }));
    }
  }

  // Checkout page: blocked for bots, captcha
  const cp = input.checkoutPage;
  if (cp) {
    const b = cp.browser;
    const bot = cp.bot;
    // Same rule as the access test: 401/403 or a challenge page = blocked; 429 = rate-limited (retried once first).
    const browserChallenged = b.ok && (b.challengeHeader || CHALLENGE_RE.test(b.body));
    const botChallenged = bot.ok && (bot.challengeHeader || (!browserChallenged && CHALLENGE_RE.test(bot.body)));
    if (b.ok && b.status < 400 && bot.ok && (BLOCK_STATUS.has(bot.status) || botChallenged)) {
      out.push(f("blocked_bots", "blocked_bots", {
        title: "The checkout page is blocked for AI bots",
        severity: "high",
        basis: "observed",
        evidence: `${cp.url}: a browser got HTTP ${b.status}; GPTBot got HTTP ${bot.status}${botChallenged ? " with a bot challenge" : ""}.`,
        guidance: "Allow AI agents on /checkout/ in your firewall or bot protection (Cloudflare: WAF and Bot Fight Mode rules), keeping rate limits for abuse.",
        fix_url: null,
      }));
    }
    if (b.ok && b.status < 400 && bot.ok && bot.status === 429 && !botChallenged) {
      out.push(f("rate_limited_bots", "rate_limited_bots", {
        title: "The checkout page rate-limited GPTBot",
        severity: "medium",
        basis: "heuristic",
        evidence: `${cp.url}: a browser got HTTP ${b.status}; GPTBot got HTTP 429 (too many requests)${cp.botRetried ? ", even after waiting and one retry" : ""}. This can come from the scan's own requests in a short time; the next scan checks again.`,
        guidance: "If it repeats, check the rate limits of your firewall or bot protection for AI agents on /checkout/.",
        fix_url: null,
      }));
    }
    const html = b.ok ? b.body : "";
    if (CAPTCHA_RE.test(html)) {
      out.push(f("captcha", "captcha", {
        title: "The checkout page loads a captcha",
        severity: "medium",
        basis: "heuristic",
        evidence: `${cp.url} contains captcha code (reCAPTCHA, hCaptcha, Turnstile or similar).`,
        guidance: "AI agents cannot solve captchas. If spam allows it, show the captcha only on suspicious attempts, or use invisible protection that does not challenge normal checkouts.",
        fix_url: null,
      }));
    }
  }

  // Products that cannot be bought
  const { total, outOfStock } = input.products;
  if (total > 0 && outOfStock > 0) {
    const share = outOfStock / total;
    out.push(f("out_of_stock", "out_of_stock", {
      title: `${outOfStock} of ${total} products are out of stock`,
      severity: share >= 0.5 ? "medium" : "low",
      basis: "observed",
      evidence: `${outOfStock} published products have stock status "out of stock".`,
      guidance: "AI assistants avoid recommending products that cannot be bought. Restock, allow backorders, or hide out-of-stock items from the catalog (WooCommerce → Settings → Products → Inventory).",
      fix_url: admin("admin.php?page=wc-settings&tab=products&section=inventory"),
    }));
  }
  return out;
}
