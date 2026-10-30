import "server-only";
// Checkout by market → Fix Center: the market rows read live, turned into findings and written to the latest
// complete scan under one step key, so each check replaces the previous ones (one finding per market and reason).
import type { SupabaseClient } from "@supabase/supabase-js";
import type { SimResult } from "./agent-sim";
import { COUNTRY, marketCheckout, type MarketRow } from "./market-checkout";
import { marketFindings, type LastTest } from "./market-fixes";
import { defaultMarket, marketOf, type MarketId } from "./markets";
import { wooCommerceAdapter } from "./platform/woocommerce";
import type { Finding } from "./rules";
import { fetchCountryStates, type WooCredentials } from "./woo";

type Store = { id: string; owner_id: string; url: string };
export const MARKET_STEP = "markets";

// The markets the store's AI Visibility questions target, else the store's own country (as the page shows them).
export async function marketRowsFor(admin: SupabaseClient, store: Store, creds: WooCredentials, knownNeedsShipping?: boolean): Promise<MarketRow[] | null> {
  const adapter = wooCommerceAdapter(store.url, creds);
  const [{ data: prompts }, { settings }, { zones, gateways }, page1] = await Promise.all([
    admin.from("visibility_prompts").select("market").eq("store_id", store.id),
    adapter.fetchPolicies(),
    adapter.fetchCheckoutSetup(),
    knownNeedsShipping === undefined ? adapter.fetchProductsPage(1).catch(() => null) : null,
  ]);
  if (!settings.ok) return null;
  const used = [...new Set((prompts ?? []).map((p) => p.market).filter((m): m is MarketId => Boolean(marketOf(m))))];
  const markets: MarketId[] = used.length ? used : [defaultMarket(settings.data.woocommerce_default_country)];
  const states: Record<string, number | null> = {};
  for (const m of markets) states[COUNTRY[m]] = await fetchCountryStates(store.url, creds, COUNTRY[m]);
  const needsShipping = knownNeedsShipping ?? (page1 ? page1.items.some((p) => !p.virtual) : true);
  return marketCheckout({ markets, settings: settings.data, zones: zones.ok ? zones.data : null, gateways: gateways.ok ? gateways.data : null, states, needsShipping });
}

// The last finished purchase test of each market (Store API test).
export async function lastTests(admin: SupabaseClient, storeId: string): Promise<Record<string, LastTest>> {
  const { data: jobs } = await admin.from("jobs").select("id, progress, created_at").eq("store_id", storeId).eq("kind", "agent_sim").eq("status", "succeeded").order("created_at", { ascending: false }).limit(20);
  const out: Record<string, LastTest> = {};
  for (const j of jobs ?? []) {
    const market = String((j.progress as { market?: string } | null)?.market ?? "");
    if (!market || out[market]) continue;
    const { data: step } = await admin.from("job_steps").select("result").eq("job_id", j.id).eq("step_key", "simulate").maybeSingle();
    if (step?.result) out[market] = { jobId: String(j.id), at: String(j.created_at), result: step.result as SimResult };
  }
  return out;
}

// Replaces the market findings of the latest complete scan (or of scanId). Same key → same Fix Center item.
export async function refreshMarketFindings(admin: SupabaseClient, store: Store, creds: WooCredentials, scanId?: string, needsShipping?: boolean): Promise<{ scanId: string | null; findings: number }> {
  let id = scanId ?? null;
  if (!id) {
    const { data } = await admin.from("scans").select("id").eq("store_id", store.id).eq("status", "complete").order("created_at", { ascending: false }).limit(1).maybeSingle();
    id = (data?.id as string | undefined) ?? null;
  }
  if (!id) return { scanId: null, findings: 0 };
  const rows = await marketRowsFor(admin, store, creds, needsShipping);
  if (!rows) return { scanId: id, findings: 0 };
  const findings: Finding[] = marketFindings(store.url, rows, await lastTests(admin, store.id));
  // A re-check keeps each item's state (new / still open) as the scan set it.
  const { data: before } = await admin.from("findings").select("finding_key, state").eq("scan_id", id).eq("job_step", MARKET_STEP);
  const state = new Map((before ?? []).map((f) => [String(f.finding_key), (f.state as string | null) ?? null]));
  const { error: delErr } = await admin.from("findings").delete().eq("scan_id", id).eq("job_step", MARKET_STEP);
  if (delErr) throw delErr;
  if (findings.length) {
    const { error } = await admin.from("findings").insert(findings.map((f) => ({ ...f, scan_id: id, store_id: store.id, owner_id: store.owner_id, job_step: MARKET_STEP, state: state.get(f.finding_key) ?? (scanId ? null : "new") })));
    if (error) throw error;
  }
  return { scanId: id, findings: findings.length };
}
