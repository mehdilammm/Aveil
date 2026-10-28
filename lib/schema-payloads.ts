// Milestone G payloads for the plugin's structured data, from the store's own data only (pure).
//   G2 org      - phone, email and profile links as published on the site's pages (tel:, mailto:, wa.me links,
//                 links to profile pages on the large social sites). Name, address and logo the plugin reads live.
//   G3 shipping - WooCommerce shipping zones and methods, written only where they are exact for every address of
//                 the destination; the rest is listed in `flags` with the reason.
//   G5 website  - the search address, only when the store answered it with its products.
import type { ShippingZone } from "./checkout";
import { decodeEntities } from "./consistency";

const text = (html: string) => decodeEntities(html.replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ").trim();

// ---- G2 --------------------------------------------------------------------------------------------------------

export type OrgPayload = { type: "OnlineStore"; telephone?: string; email?: string; same_as?: string[] };
const PROFILE = /^https:\/\/(?:www\.)?(?:facebook\.com\/(?!sharer|share|dialog)[A-Za-z0-9.-]+\/?$|instagram\.com\/[A-Za-z0-9._]+\/?$|(?:x|twitter)\.com\/(?!intent|share)[A-Za-z0-9_]+\/?$|linkedin\.com\/(?:company|in)\/[A-Za-z0-9_%-]+\/?$|youtube\.com\/(?:@[A-Za-z0-9._-]+|channel\/[A-Za-z0-9_-]+|c\/[A-Za-z0-9._-]+|user\/[A-Za-z0-9._-]+)\/?$|tiktok\.com\/@[A-Za-z0-9._]+\/?$|pinterest\.com\/[A-Za-z0-9_]+\/?$)/i;
const PHONE = /^\+?[0-9][0-9 ().-]{5,38}$/;

export function orgPayload(pages: { url: string; html: string }[]): { payload: OrgPayload; evidence: string[] } {
  const payload: OrgPayload = { type: "OnlineStore" };
  const evidence: string[] = [];
  const same = new Set<string>();
  for (const page of pages) {
    for (const m of page.html.matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
      const href = decodeEntities(m[1]).trim();
      const label = text(m[2]);
      if (!payload.telephone && /^tel:/i.test(href)) {
        const tel = decodeURIComponent(href.slice(4)).trim();
        if (PHONE.test(tel)) {
          payload.telephone = PHONE.test(label) ? label : tel;
          evidence.push(`telephone: tel: link on ${page.url}`);
        }
      } else if (!payload.telephone && /^https:\/\/wa\.me\/\d{6,15}$/i.test(href)) {
        payload.telephone = PHONE.test(label) ? label : `+${href.split("/").pop()}`;
        evidence.push(`telephone: WhatsApp link "${label}" on ${page.url}`);
      } else if (!payload.email && /^mailto:/i.test(href)) {
        const mail = decodeURIComponent(href.slice(7).split("?")[0]).trim();
        if (/^[^@\s<>"]+@[^@\s<>"]+\.[a-z]{2,}$/i.test(mail)) {
          payload.email = mail;
          evidence.push(`email: mailto: link on ${page.url}`);
        }
      } else if (PROFILE.test(href) && same.size < 10 && !same.has(href)) {
        same.add(href);
        evidence.push(`sameAs: ${href} linked on ${page.url}`);
      }
    }
  }
  if (same.size) payload.same_as = [...same];
  return { payload, evidence };
}

// ---- G3 --------------------------------------------------------------------------------------------------------

export type ShippingRate = { type: "flat"; cost: string } | { type: "free" } | { type: "free_min"; min: string };
export type ShippingZonePayload = { country: string; region?: string; rates: ShippingRate[] };
export type ShippingPayload = { currency: string; zones: ShippingZonePayload[] };

const AMOUNT = /^\d{1,9}(\.\d{1,4})?$/;

// The rates of one method that are exact for a one-item order, or why not.
function rateOf(m: ShippingZone["methods"][number]): ShippingRate | { skip: string } | null {
  const s = m.settings ?? {};
  const name = m.title || m.method_id;
  if (m.method_id === "local_pickup" || m.method_id === "pickup_location") return null; // not delivery
  if (m.method_id === "free_shipping") {
    const req = s.requires ?? "";
    if (req === "") return { type: "free" };
    if (req === "min_amount" && AMOUNT.test((s.min_amount ?? "").trim())) return { type: "free_min", min: s.min_amount.trim() };
    return { skip: `"${name}" needs a coupon` };
  }
  if (m.method_id === "flat_rate") {
    const cost = (s.cost ?? "").trim();
    if (!AMOUNT.test(cost)) return { skip: `"${name}" cost "${cost}" is a formula` };
    const classCosts = Object.entries(s).filter(([k, v]) => (k.startsWith("class_cost_") || k === "no_class_cost") && v.trim() !== "");
    if (classCosts.length) return { skip: `"${name}" has shipping class costs` };
    return { type: "flat", cost };
  }
  return { skip: `"${name}" (${m.method_id}) is calculated by a plugin` };
}

// Zones in WooCommerce order: an address belongs to the first zone that matches it. A zone is written only when
// its destination can be named (a country, or a state by its WooCommerce name) and no earlier zone takes part of it.
export function shippingPayload(input: { zones: ShippingZone[]; currency: string | null; taxes: boolean; stateNames: Record<string, Record<string, string>> }): { payload: ShippingPayload | null; flags: string[] } {
  const flags: string[] = [];
  if (!input.currency) return { payload: null, flags: ["the store currency is not set"] };
  if (input.taxes) return { payload: null, flags: ["taxes are on: a shipping rate can include tax depending on the address, so none is written"] };
  const zones: ShippingZonePayload[] = [];
  const taken = new Map<string, string>(); // country -> "all" | "part"
  for (const z of input.zones.filter((x) => x.id !== 0)) {
    const enabled = z.methods.filter((m) => m.enabled);
    const label = `zone "${z.name}"`;
    const rates: ShippingRate[] = [];
    const skips: string[] = [];
    for (const m of enabled) {
      const r = rateOf(m);
      if (!r) continue;
      if ("skip" in r) skips.push(r.skip);
      else rates.push(r);
    }
    const unsupported = z.locations.filter((l) => l.type !== "country" && l.type !== "state");
    const destinations = z.locations.filter((l) => l.type === "country" || l.type === "state").map((l) => {
      const [cc, st] = l.code.split(":");
      return { cc: cc.toUpperCase(), state: l.type === "state" ? st : null };
    });
    const writable = !unsupported.length && !skips.length && rates.length > 0;
    for (const d of destinations) {
      const before = taken.get(d.cc);
      if (writable && before !== "all" && !(before === "part" && !d.state)) {
        const region = d.state ? input.stateNames[d.cc]?.[d.state.toLowerCase()] ?? null : null;
        if (d.state && !region) flags.push(`${label}: no name for state ${d.cc}:${d.state}`);
        else zones.push({ country: d.cc, ...(region ? { region } : {}), rates });
      } else if (writable && before === "part" && !d.state) {
        flags.push(`${label} (${d.cc}): not written, because an earlier zone takes part of ${d.cc} and schema.org cannot say "the rest of ${d.cc}"`);
      }
      if (!d.state) taken.set(d.cc, "all");
      else if (!taken.has(d.cc)) taken.set(d.cc, "part");
    }
    if (unsupported.length) flags.push(`${label}: ${unsupported.map((l) => l.type).join(", ")} locations cannot be written exactly`);
    if (skips.length) flags.push(`${label}: ${skips.join("; ")}`);
    if (!enabled.length) flags.push(`${label}: no shipping method turned on`);
  }
  const rest = input.zones.find((z) => z.id === 0);
  if (rest?.methods.some((m) => m.enabled)) flags.push(`"Locations not covered by your other zones" has a method: "everywhere else" cannot be written as a destination`);
  return { payload: zones.length ? { currency: input.currency, zones } : null, flags };
}

// ---- G5 --------------------------------------------------------------------------------------------------------

export const searchTemplate = (storeUrl: string) => `${storeUrl.replace(/\/$/, "")}/?s={search_term_string}&post_type=product`;
export const searchProbe = (storeUrl: string, term: string) => `${storeUrl.replace(/\/$/, "")}/?s=${encodeURIComponent(term)}&post_type=product`;

// The search works when the results page answers 200 and links to the product the term came from.
export function searchWorks(res: { status: number; html: string } | null, productUrl: string): boolean {
  return Boolean(res && res.status === 200 && res.html.includes(`href="${productUrl}"`));
}
