// Checkout barriers per market (F6): for each market the store's AI Visibility questions target, whether an agent
// could complete a checkout there, from the store's own WooCommerce settings (read only): selling locations,
// shipping zones and methods, payment methods, guest checkout, and the address fields WooCommerce asks for.
// Settings are Observed; what an agent can do with them is partly Heuristic (marked per reason).
import type { Basis } from "./rules";
import type { Gateway, ShippingZone } from "./checkout";
import { MARKETS, type MarketId } from "./markets";

export const COUNTRY: Record<MarketId, string> = { US: "US", UK: "GB", FR: "FR", SA: "SA", AE: "AE", MA: "MA" };
const CONTINENT: Record<string, string> = { US: "NA", GB: "EU", FR: "EU", SA: "AS", AE: "AS", MA: "AF" };
const OFFLINE = new Set(["cod", "bacs", "cheque"]);

export type ReasonCode = "notSold" | "shippingDisabled" | "notShipped" | "noZone" | "noMethods" | "partialZone" | "zoneGap" | "noPayment" | "offlineOnly" | "guestOff" | "statesAsked" | "currency" | "zonesUnknown" | "paymentsUnknown";
export type Reason = { code: ReasonCode; basis: Basis; blocker: boolean; values: Record<string, string | number> };
export type Verdict = "yes" | "probably" | "no" | "unknown";
export type MarketRow = { market: MarketId; country: string; verdict: Verdict; reasons: Reason[]; fixes: ("selling" | "shipping" | "payments" | "accounts")[] };

const list = (v: unknown): string[] => (Array.isArray(v) ? v.map(String) : typeof v === "string" && v ? v.split(",").map((s) => s.trim()).filter(Boolean) : []);

export function soldTo(settings: Record<string, unknown>, cc: string): boolean {
  const mode = String(settings.woocommerce_allowed_countries ?? "all");
  if (mode === "specific") return list(settings.woocommerce_specific_allowed_countries).includes(cc);
  if (mode === "all_except") return !list(settings.woocommerce_all_except_countries).includes(cc);
  return true;
}

// The zones WooCommerce uses for a country, in zone order: "main" is the first zone listing the country or its
// continent (without postcodes), else "Locations not covered" (zone 0); "parts" are earlier zones that take only
// some of its addresses (a state of it, or postcodes).
export function zonesFor(zones: ShippingZone[], cc: string): { main: ShippingZone | null; parts: ShippingZone[] } {
  const ordered = zones.filter((z) => z.id !== 0);
  const lists = (z: ShippingZone) => z.locations.some((l) => (l.type === "country" && l.code === cc) || (l.type === "continent" && l.code === CONTINENT[cc]));
  const postcodes = (z: ShippingZone) => z.locations.some((l) => l.type === "postcode");
  const regionless = (z: ShippingZone) => z.locations.every((l) => l.type === "postcode");
  const at = ordered.findIndex((z) => lists(z) && !postcodes(z));
  const before = at >= 0 ? ordered.slice(0, at) : ordered;
  const parts = before.filter((z) => z.locations.some((l) => l.type === "state" && l.code.startsWith(`${cc}:`)) || (postcodes(z) && (lists(z) || regionless(z))));
  return { main: at >= 0 ? ordered[at] : (zones.find((z) => z.id === 0) ?? null), parts };
}

export function marketCheckout(input: {
  markets: MarketId[];
  settings: Record<string, unknown>;
  zones: ShippingZone[] | null;
  gateways: Gateway[] | null;
  states: Record<string, number | null>;
  needsShipping: boolean;
}): MarketRow[] {
  const s = input.settings;
  const currency = String(s.woocommerce_currency ?? "");
  const shipMode = String(s.woocommerce_ship_to_countries ?? "");
  const enabled = (input.gateways ?? []).filter((g) => g.enabled);
  return input.markets.map((id) => {
    const cc = COUNTRY[id];
    const reasons: Reason[] = [];
    const fixes = new Set<MarketRow["fixes"][number]>();
    const r = (code: ReasonCode, blocker: boolean, basis: Basis, values: Record<string, string | number> = {}, fix?: MarketRow["fixes"][number]) => {
      reasons.push({ code, blocker, basis, values });
      if (fix) fixes.add(fix);
    };

    if (!soldTo(s, cc)) r("notSold", true, "observed", { cc }, "selling");
    if (input.needsShipping) {
      if (shipMode === "disabled") r("shippingDisabled", true, "observed", {}, "shipping");
      else if (shipMode === "specific" && !list(s.woocommerce_specific_ship_to_countries).includes(cc)) r("notShipped", true, "observed", { cc }, "shipping");
      else if (!input.zones) r("zonesUnknown", false, "unavailable");
      else {
        const { main, parts } = zonesFor(input.zones, cc);
        const ships = (z: ShippingZone) => z.methods.some((m) => m.enabled);
        const name = (z: ShippingZone) => (z.id === 0 ? "Locations not covered by your other zones" : z.name);
        // Some addresses ship and others do not: likely trouble for an agent, depending on the buyer's address.
        const gap = main && ships(main) ? parts.find((z) => !ships(z)) : undefined;
        const only = main && ships(main) ? undefined : parts.find(ships);
        if (gap) r("zoneGap", false, "heuristic", { zone: name(gap) }, "shipping");
        else if (only) r("partialZone", false, "heuristic", { zone: name(only) }, "shipping");
        else if (!main) r("noZone", true, "observed", { cc }, "shipping");
        else if (!ships(main)) r("noMethods", true, "observed", { zone: name(main) }, "shipping");
      }
    }
    if (!input.gateways) r("paymentsUnknown", false, "unavailable");
    else if (!enabled.length) r("noPayment", true, "observed", {}, "payments");
    else if (enabled.every((g) => OFFLINE.has(g.id))) r("offlineOnly", false, "heuristic", { methods: enabled.map((g) => g.title).join(", ") });
    if (String(s.woocommerce_enable_guest_checkout ?? "").toLowerCase() === "no") r("guestOff", true, "observed", {}, "accounts");
    const states = input.states[cc];
    if (states) r("statesAsked", false, "heuristic", { n: states });
    const marketCurrency = MARKETS.find((m) => m.id === id)?.currency;
    if (currency && marketCurrency && currency.toUpperCase() !== marketCurrency) r("currency", false, "observed", { store: currency, market: marketCurrency });

    const verdict: Verdict = reasons.some((x) => x.blocker)
      ? "no"
      : reasons.some((x) => x.code === "zonesUnknown" || x.code === "paymentsUnknown")
        ? "unknown"
        : reasons.some((x) => x.code === "offlineOnly" || x.code === "partialZone" || x.code === "zoneGap")
          ? "probably"
          : "yes";
    return { market: id, country: cc, verdict, reasons, fixes: [...fixes] };
  });
}
