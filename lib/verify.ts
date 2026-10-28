// Verify loop (D5), technical part: after the merchant fixes something, the check that produced the finding runs
// again on just that resource, with caches bypassed (no-cache headers and a unique query string). The finding is
// "Resolved (Observed)" only when the re-check ran and no longer finds it. A re-check that cannot run is
// "Unavailable" with the reason, never "resolved". Pure: the reads are passed in.
import type { Finding } from "./rules";

export type RecheckGroup = "product" | "product_page" | "robots" | "store_pages" | "checkout" | "access" | "jsonld" | "hidden";
export type VerifyStatus = "resolved" | "still_open" | "unavailable";
export type VerifyResult = { status: VerifyStatus; evidence: string };

export function groupOf(f: { type: string; product_id: number | null; finding_key: string }): RecheckGroup {
  if (f.type.startsWith("jsonld_")) return "jsonld";
  if (f.type === "page_noindex" || f.type === "page_canonical_elsewhere") return "hidden";
  if (f.type.startsWith("schema_")) return "product_page";
  if (f.type.startsWith("robots_") || f.type.startsWith("llms_")) return "robots";
  if (f.type.startsWith("checkout_")) return "checkout";
  if (f.type.startsWith("access_") || f.type === "bot_protection_blocked" || f.type === "store_coming_soon") return "access";
  if (f.product_id !== null) return "product";
  return "store_pages";
}

// A re-check result is "unavailable" for the finding when it reports its own scope as not checkable.
const UNAVAILABLE_FOR: Record<RecheckGroup, (f: Finding, target: { product_id: number | null }) => boolean> = {
  product: () => false,
  product_page: (f, t) => f.basis === "unavailable" && f.product_id === t.product_id,
  robots: (f) => f.basis === "unavailable" && (f.type.startsWith("robots_") || f.type.startsWith("llms_")),
  store_pages: (f) => f.basis === "unavailable" && (f.type === "page_check_unavailable" || f.type.endsWith("_unavailable")),
  checkout: (f) => f.basis === "unavailable" && f.type.startsWith("checkout_"),
  access: (f) => f.basis === "unavailable" && f.type.startsWith("access_"),
  jsonld: (f) => f.basis === "unavailable" && f.type.startsWith("jsonld_"),
  hidden: (f) => f.basis === "unavailable" && f.type.startsWith("page_"),
};

export function judge(target: { finding_key: string; type: string; product_id: number | null }, recheck: Finding[] | { unavailable: string }): VerifyResult {
  if ("unavailable" in recheck) return { status: "unavailable", evidence: recheck.unavailable };
  const same = recheck.find((f) => f.finding_key === target.finding_key);
  if (same) return { status: "still_open", evidence: same.evidence };
  const blocked = recheck.find((f) => UNAVAILABLE_FOR[groupOf(target)](f, target));
  if (blocked) return { status: "unavailable", evidence: blocked.evidence };
  return { status: "resolved", evidence: "The same check ran again just now with caches bypassed and no longer finds it." };
}

// Visibility re-checks after a resolved fix: 7, 14 and 30 days later. Never shown as proof; they are what the
// models answered on those days.
export const RECHECK_DAYS = [7, 14, 30];
export const recheckDue = (from: Date, days: number) => new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate() + days, 6)).toISOString();

export const bust = (url: string, token: string) => {
  const u = new URL(url);
  u.searchParams.set("agsc_verify", token);
  return u.toString();
};
