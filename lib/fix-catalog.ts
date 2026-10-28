// What kind of fix each finding gets (Auto-fix):
//   auto      - technical, no business information: llms.txt from store data, robots.txt groups for the AI
//               search agents, the brand = the store's name when a product has none (approved rule), the product
//               feed from the store's products (G1).
//   one_click - a business decision: one button with an explanation and a confirmation (sell only where you
//               ship, allow guest checkout).
//   input     - a fact only the merchant has (price, image, weight, GTIN): one short question, and what they
//               type is written as given.
//   guide     - needs a person outside the store data (firewall, payment provider, theme): copyable steps.
// Nothing here invents a value: the auto fixes only use data the store already has.
import { SEARCH_AGENTS } from "./fixes/robots-patch";

export type FixType = "auto" | "one_click" | "input" | "guide";
export type FixKind =
  | "llms_txt" | "robots" | "brand" | "feed"
  | "sell_where_ship" | "guest_checkout"
  | "price" | "image" | "weight" | "gtin"
  | "manual";
export type InputField = "price" | "image" | "weight" | "gtin";
export type FixSpec = { type: FixType; kind: FixKind; field?: InputField };

const input = (field: InputField): FixSpec => ({ type: "input", kind: field, field });

export function fixFor(f: { type: string; finding_key: string; evidence: string; product_id: number | null }): FixSpec {
  const t = f.type;
  if (t === "llms_txt_missing") return { type: "auto", kind: "llms_txt" };
  // G1: the plugin serves a product feed built from the store's products (Pro and Agency).
  if (t === "feed_not_served") return { type: "auto", kind: "feed" };
  // F4: llms.txt lists an old price. The plugin can serve a new one from the store data (auto-fix refuses when
  // the site has its own llms.txt file, which is then fixed by hand from Fix generators).
  if (t === "consistency_llms_mismatch") return { type: "auto", kind: "llms_txt" };
  if (t === "robots_blocks_bot") {
    const bot = f.finding_key.split(":")[1] ?? "";
    // Opening the search and shopping agents is technical; training crawlers are the merchant's choice.
    return SEARCH_AGENTS.includes(bot) ? { type: "auto", kind: "robots" } : { type: "guide", kind: "manual" };
  }
  if (t === "feed_brand_missing") return { type: "auto", kind: "brand" };
  if (t === "checkout_shipping_gap") return { type: "one_click", kind: "sell_where_ship" };
  if (t === "checkout_guest_disabled") return { type: "one_click", kind: "guest_checkout" };
  if (/^price_(missing|invalid|negative|zero)$/.test(t)) return input("price");
  if (t === "image_missing") return input("image");
  if (t === "weight_missing") return input("weight");
  if (t === "feed_identifier_missing" || t === "feed_gtin_invalid") return input("gtin");
  // The page's structured data lacks a field because the product lacks it: ask for the product's own value.
  if ((t === "schema_fields_missing" || t === "schema_product_missing") && f.product_id !== null) {
    if (/offers\.price|no price|price/i.test(f.evidence) || t === "schema_product_missing") return input("price");
    if (/image/i.test(f.evidence)) return input("image");
  }
  return { type: "guide", kind: "manual" };
}

// The merchant's answer to an input fix, checked before anything is written. Returns the value to write, or why not.
export function checkInput(field: InputField, raw: string): { ok: true; value: string } | { ok: false; reason: string } {
  const v = raw.trim();
  if (field === "price") return /^\d{1,9}(\.\d{1,2})?$/.test(v) && Number(v) > 0 ? { ok: true, value: v } : { ok: false, reason: "Enter a price above 0, digits and an optional dot (for example 800 or 799.90)." };
  if (field === "weight") return /^\d{1,6}(\.\d{1,3})?$/.test(v) && Number(v) > 0 ? { ok: true, value: v } : { ok: false, reason: "Enter the weight as a number above 0, in the store's weight unit." };
  if (field === "gtin") {
    const d = v.replace(/\s/g, "");
    if (!/^(\d{8}|\d{12}|\d{13}|\d{14})$/.test(d)) return { ok: false, reason: "A GTIN has 8, 12, 13 or 14 digits (EAN / UPC barcode)." };
    const digits = d.split("").map(Number);
    const check = digits.pop()!;
    const sum = digits.reverse().reduce((s, n, i) => s + n * (i % 2 === 0 ? 3 : 1), 0);
    return (10 - (sum % 10)) % 10 === check ? { ok: true, value: d } : { ok: false, reason: "This barcode's check digit is wrong. Copy it again from the product." };
  }
  try {
    const u = new URL(v);
    return u.protocol === "https:" && /\.(jpe?g|png|webp|gif)$/i.test(u.pathname) ? { ok: true, value: u.toString() } : { ok: false, reason: "Paste an https link to a JPG, PNG, WebP or GIF image." };
  } catch {
    return { ok: false, reason: "Paste an https link to the product image." };
  }
}

// Countries the store ships to, from its shipping zones ("MA", "MA:MA-07" → MA); null when a zone covers a
// continent or postcode only (then the one-click fix is not offered: it would need a person to decide).
export function shipCountries(zones: { locations: { code: string; type: string }[] }[]): string[] | null {
  const out = new Set<string>();
  for (const z of zones) {
    for (const l of z.locations) {
      if (l.type === "country") out.add(l.code.toUpperCase());
      else if (l.type === "state") out.add(l.code.split(":")[0].toUpperCase());
      else return null;
    }
  }
  return out.size ? [...out].sort() : null;
}
