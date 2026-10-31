import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { simulatePurchase, type Send, type SimResult } from "./agent-sim";
import type { MarketId } from "./markets";
import { isOwnershipVerified } from "./ownership-store";
import { guardedSend } from "./agent-send";

export { guardedSend };

export class NotVerifiedError extends Error {}

// One agent purchase test of a store whose ownership is verified now (checked again when the job runs).
export async function runAgentSim(admin: SupabaseClient, store: { id: string; url: string }, market: MarketId, send: Send = guardedSend): Promise<SimResult> {
  if (!(await isOwnershipVerified(admin, store.id))) throw new NotVerifiedError("Store ownership is not verified, so the agent purchase test does not run.");
  const { data: connector } = await admin.rpc("get_traffic_connector_secret", { p_store_id: store.id }).maybeSingle<{ token: string }>();
  return simulatePurchase({ storeUrl: store.url, market, checkToken: connector?.token ?? null, send });
}
