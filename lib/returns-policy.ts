// G7: a MerchantReturnPolicy proposed from the store's returns page and WooCommerce selling countries, with the
// exact sentences it is based on. Only what the page says plainly is used: "no returns" / "final sale", or a
// number of days for returns; return method and fees only when the page names them. Anything unclear (both, or
// neither, or selling to every country) becomes a short form for the merchant instead of a guess.
import { createHash } from "node:crypto";
import { decodeEntities } from "./consistency";

export type ReturnsPayload = {
  category: "MerchantReturnNotPermitted" | "MerchantReturnFiniteReturnWindow" | "MerchantReturnUnlimitedWindow";
  countries: string[];
  days?: number;
  method?: "ReturnByMail" | "ReturnInStore";
  fees?: "FreeReturn" | "ReturnFeesCustomerResponsibility";
  link?: string;
};
export type ReturnsProposal = { proposal: ReturnsPayload | null; basis: string[]; unclear: string | null; page: string | null; hash: string | null };

const NOT_PERMITTED = /\b(no returns?|final sale|can ?not be (returned|refunded)|non-?returnable|(do|does) not accept returns|returns are not (accepted|possible)|not eligible for (a )?return)\b/i;
const DAYS = /\b(\d{1,3})\s*(?:-\s*)?(?:calendar\s+|business\s+|working\s+)?days?\b/i;
const RETURN_WORD = /\b(return|returns|returned|refund|refunds|refunded)\b/i;
const UNLIMITED = /\b(any ?time|no time limit|lifetime returns?)\b/i;

// The page's text as sentences (headings and paragraphs kept apart).
export function sentencesOf(html: string): string[] {
  const text = decodeEntities(html.replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ").replace(/<\/(p|h[1-6]|li|div|br)\s*>|<br\s*\/?>/gi, "\n").replace(/<[^>]*>/g, " "));
  return text.split(/\n+|(?<=[.!?])\s+/).map((s) => s.replace(/\s+/g, " ").trim()).filter((s) => s.length > 2);
}

export function proposeReturns(input: { page: { url: string; html: string } | null; sellingCountries: string[] | null }): ReturnsProposal {
  const none = (unclear: string, basis: string[] = [], page: string | null = input.page?.url ?? null): ReturnsProposal => ({ proposal: null, basis, unclear, page, hash: null });
  if (!input.page) return none("No returns page was found (a published page with \"return\" or \"refund\" in its title or address).", [], null);
  if (!input.sellingCountries?.length) return none("The store sells to every country, so the countries the policy applies to must be chosen.");
  const sentences = sentencesOf(input.page.html);
  const notPermitted = sentences.filter((s) => NOT_PERMITTED.test(s));
  const windows = sentences.filter((s) => RETURN_WORD.test(s) && DAYS.test(s));
  const unlimited = sentences.filter((s) => RETURN_WORD.test(s) && UNLIMITED.test(s));
  const kinds = [notPermitted.length > 0, windows.length > 0, unlimited.length > 0].filter(Boolean).length;
  if (kinds === 0) return none("The page does not say plainly whether returns are accepted or for how many days.");
  if (kinds > 1) return none("The page says more than one thing about returns.", [...notPermitted, ...windows, ...unlimited]);
  const base = { countries: input.sellingCountries, link: input.page.url };
  let proposal: ReturnsPayload;
  let basis: string[];
  if (notPermitted.length) {
    proposal = { category: "MerchantReturnNotPermitted", ...base };
    basis = notPermitted;
  } else {
    const days = [...new Set(windows.flatMap((s) => [...s.matchAll(new RegExp(DAYS.source, "gi"))].map((m) => Number(m[1]))))];
    if (unlimited.length) {
      proposal = { category: "MerchantReturnUnlimitedWindow", ...base };
      basis = unlimited;
    } else if (days.length !== 1 || days[0] < 1 || days[0] > 365) {
      return none(`The page gives ${days.length > 1 ? "several numbers of days" : "a number of days that is not a return window"}.`, windows);
    } else {
      proposal = { category: "MerchantReturnFiniteReturnWindow", days: days[0], ...base };
      basis = windows;
    }
    const all = sentences.join(" ");
    if (/\bfree returns?\b|\breturn shipping is free\b|\bwe pay (for )?(the )?return shipping\b/i.test(all)) proposal.fees = "FreeReturn";
    else if (/\b(at|for) (your|the customer'?s?) (own )?(cost|expense)\b|\bcustomer pays (for )?(the )?return\b/i.test(all)) proposal.fees = "ReturnFeesCustomerResponsibility";
    if (/\b(by|through the) (mail|post|courier)\b|\bsend (it|the item|the product)s? back\b/i.test(all)) proposal.method = "ReturnByMail";
    else if (/\bin[- ]store\b/i.test(all)) proposal.method = "ReturnInStore";
  }
  return { proposal, basis, unclear: null, page: input.page.url, hash: returnsHash(proposal) };
}

// The proposal the merchant saw is the one applied: the apply step builds it again and compares this hash.
export const returnsHash = (p: ReturnsPayload) => createHash("sha256").update(JSON.stringify(p)).digest("hex").slice(0, 16);

// The merchant's own answer (the short form when the page is unclear), checked like the plugin checks it.
export function checkReturnsAnswer(raw: string): { ok: true; value: ReturnsPayload } | { ok: false; reason: string } {
  let v: Partial<ReturnsPayload> & { days?: unknown };
  try {
    v = JSON.parse(raw);
  } catch {
    return { ok: false, reason: "The answer could not be read." };
  }
  const categories = ["MerchantReturnNotPermitted", "MerchantReturnFiniteReturnWindow", "MerchantReturnUnlimitedWindow"];
  if (!categories.includes(String(v.category))) return { ok: false, reason: "Choose whether returns are accepted." };
  const countries = (Array.isArray(v.countries) ? v.countries : []).map((c) => String(c).trim().toUpperCase()).filter((c) => /^[A-Z]{2}$/.test(c));
  if (!countries.length || countries.length > 50) return { ok: false, reason: "Enter the countries as 2-letter codes (for example MA, FR)." };
  const out: ReturnsPayload = { category: v.category as ReturnsPayload["category"], countries };
  if (out.category === "MerchantReturnFiniteReturnWindow") {
    const d = Number(v.days);
    if (!Number.isInteger(d) || d < 1 || d > 365) return { ok: false, reason: "Enter the number of days (1 to 365)." };
    out.days = d;
  }
  if (out.category !== "MerchantReturnNotPermitted") {
    if (v.method === "ReturnByMail" || v.method === "ReturnInStore") out.method = v.method;
    if (v.fees === "FreeReturn" || v.fees === "ReturnFeesCustomerResponsibility") out.fees = v.fees;
  }
  if (typeof v.link === "string" && /^https:\/\/\S+$/.test(v.link)) out.link = v.link;
  return { ok: true, value: out };
}
