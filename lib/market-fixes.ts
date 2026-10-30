// Checkout by market (F6) in Fix Center: each blocker of a market row, and its address and currency notes, is one
// finding keyed by market and reason ("market:US:noMethods"), so a new check or purchase test replaces it instead
// of adding another. The row's basis is kept; the WooCommerce setting that changes it is named. Pure.
import type { SimResult } from "./agent-sim";
import type { MarketRow, Reason, ReasonCode } from "./market-checkout";
import { marketOf } from "./markets";
import type { Finding } from "./rules";

// Information-only notes that still change what an agent must send: shown, at low severity.
const NOTES: ReasonCode[] = ["statesAsked", "currency"];

const TITLE: Partial<Record<ReasonCode, (v: Reason["values"]) => string>> = {
  notSold: (v) => `The store does not sell to ${v.cc}`,
  shippingDisabled: () => "Shipping is turned off, but the products need shipping",
  notShipped: (v) => `The store does not ship to ${v.cc}`,
  noZone: (v) => `No shipping zone covers ${v.cc}`,
  noMethods: () => "No shipping method",
  noPayment: () => "No payment method turned on",
  guestOff: () => "Guest checkout is off",
  statesAsked: () => "Checkout asks for a state or region",
  currency: (v) => `Prices are in ${v.store}, not ${v.market}`,
};

const EVIDENCE: Partial<Record<ReasonCode, (v: Reason["values"]) => string>> = {
  notSold: (v) => `WooCommerce → Settings → General: Selling location(s) leave out ${v.cc}.`,
  shippingDisabled: () => "WooCommerce → Settings → General: Shipping location(s) is set to disable shipping.",
  notShipped: (v) => `WooCommerce → Settings → General: Shipping location(s) leave out ${v.cc}.`,
  noZone: (v) => `No WooCommerce shipping zone matches an address in ${v.cc}.`,
  noMethods: (v) => `Addresses here fall into the shipping zone "${v.zone}", which has no shipping method turned on.`,
  noPayment: () => "WooCommerce → Settings → Payments: no payment method is turned on.",
  guestOff: () => "WooCommerce → Settings → Accounts & Privacy: guest checkout is not allowed, so the buyer must create an account first.",
  statesAsked: (v) => `WooCommerce lists ${v.n} states or regions for this country and asks for one at checkout.`,
  currency: (v) => `The store's currency is ${v.store}; shoppers in this market usually pay in ${v.market}. Information only.`,
};

const SETTING: Partial<Record<ReasonCode, { path: string; tab: string | null }>> = {
  notSold: { path: "WooCommerce → Settings → General → Selling location(s): add the country.", tab: "general" },
  shippingDisabled: { path: "WooCommerce → Settings → General → Shipping location(s): ship to the countries you sell to.", tab: "general" },
  notShipped: { path: "WooCommerce → Settings → General → Shipping location(s): add the country.", tab: "general" },
  noZone: { path: "WooCommerce → Settings → Shipping → Add zone: the country, with at least one shipping method.", tab: "shipping" },
  noMethods: { path: "WooCommerce → Settings → Shipping → the zone → Add shipping method (and turn it on). If you do not ship there, take the country out of Selling location(s) instead.", tab: "shipping" },
  noPayment: { path: "WooCommerce → Settings → Payments: turn on at least one payment method.", tab: "checkout" },
  guestOff: { path: "WooCommerce → Settings → Accounts & Privacy → Guest checkout: allow customers to place orders without an account.", tab: "account" },
  statesAsked: { path: "Nothing to change in WooCommerce: agents need the state or region in the address. Keep it required if your carriers need it.", tab: null },
  currency: { path: "WooCommerce → Settings → General → Currency options. Information only: a currency switcher is a business choice.", tab: "general" },
};

const snake = (code: string) => code.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
export const marketFindingKey = (market: string, code: ReasonCode) => `market:${market}:${code}`;

// The last purchase test of a market and where it stopped (Store API test, F7).
export type LastTest = { jobId: string; at: string; result: SimResult } | null;

export function marketFindings(storeUrl: string, rows: MarketRow[], tests: Record<string, LastTest> = {}): Finding[] {
  const out: Finding[] = [];
  for (const row of rows) {
    const country = marketOf(row.market)?.country ?? row.market;
    const test = tests[row.market];
    const testNote = test
      ? test.result.stoppedAt
        ? ` Last purchase test (${test.at.slice(0, 10)}): stopped at "${test.result.stoppedAt}" (${test.result.steps.find((s) => s.step === test.result.stoppedAt && s.outcome === "stop")?.code ?? "stop"}).`
        : ` Last purchase test (${test.at.slice(0, 10)}): reached the payment step.`
      : "";
    for (const reason of row.reasons) {
      if (!reason.blocker && !NOTES.includes(reason.code)) continue;
      const title = TITLE[reason.code];
      const setting = SETTING[reason.code];
      if (!title || !setting) continue;
      out.push({
        finding_key: marketFindingKey(row.market, reason.code),
        type: `market_${snake(reason.code)}`,
        product_id: null,
        title: `${country}: ${title(reason.values)}`,
        severity: reason.blocker ? "high" : "low",
        basis: reason.basis,
        evidence: `${EVIDENCE[reason.code]!(reason.values)}${reason.blocker ? ` An agent cannot complete a checkout for ${country}.` : ""}${testNote}`,
        guidance: setting.path,
        ...(setting.tab ? { fix_url: `${storeUrl}/wp-admin/admin.php?page=wc-settings&tab=${setting.tab}` } : {}),
      });
    }
  }
  return out;
}

// Fix Center → the market's row and the purchase test on the Checkout by market page.
export function marketLinks(storeId: string, findingKey: string): { row: string; test: string } | null {
  const m = /^market:([A-Z]{2}):/.exec(findingKey);
  return m ? { row: `/stores/${storeId}/markets#market-${m[1]}`, test: `/stores/${storeId}/markets#purchase-test` } : null;
}
