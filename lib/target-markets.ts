// Target markets: the countries a store wants to sell to. By default they are WooCommerce's Selling location(s);
// the owner can choose them in Settings (stores.target_markets, null = follow WooCommerce). A checkout blocker in a
// market that is not a target is information (the store does not sell there by choice), not a critical issue.
import type { SupabaseClient } from "@supabase/supabase-js";
import { COUNTRY, soldTo } from "./market-checkout";
import { MARKET_IDS, type MarketId } from "./markets";

export const cleanMarkets = (v: unknown): MarketId[] | null =>
  Array.isArray(v) ? [...new Set(v.filter((m): m is MarketId => (MARKET_IDS as string[]).includes(String(m))))] : null;

// The owner's choice when set (non-empty), else every market WooCommerce sells to.
export function resolveTargets(saved: MarketId[] | null, settings: Record<string, unknown>): { markets: MarketId[]; source: "owner" | "woocommerce" } {
  if (saved && saved.length) return { markets: saved, source: "owner" };
  return { markets: MARKET_IDS.filter((m) => soldTo(settings, COUNTRY[m])), source: "woocommerce" };
}

// The saved list, or null (follow WooCommerce). A read error (for example before the column exists) means null.
export async function savedTargets(admin: SupabaseClient, storeId: string): Promise<MarketId[] | null> {
  const { data, error } = await admin.from("stores").select("target_markets").eq("id", storeId).maybeSingle();
  if (error || !data) return null;
  return cleanMarkets((data as { target_markets?: unknown }).target_markets);
}
