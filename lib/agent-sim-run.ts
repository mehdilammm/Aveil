import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { simulatePurchase, type Send, type SimResult } from "./agent-sim";
import type { MarketId } from "./markets";
import { isOwnershipVerified } from "./ownership-store";
import { guardedFetch } from "./safe-fetch";

const MAX_BYTES = 1_000_000;
const TIMEOUT_MS = 12_000;

// The simulator's requests go through the guarded client (public addresses only, checked at connect time).
export const guardedSend: Send = async (url, init) => {
  const res = await guardedFetch(url, { method: init.method, headers: init.headers, body: init.body, timeoutMs: TIMEOUT_MS });
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  if (res.body) {
    const reader = res.body.getReader();
    while (bytes < MAX_BYTES) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      bytes += value.byteLength;
    }
    await reader.cancel().catch(() => {});
  }
  return { status: res.status, headers: res.headers, text: new TextDecoder().decode(Buffer.concat(chunks).subarray(0, MAX_BYTES)) };
};

export class NotVerifiedError extends Error {}

// One agent purchase test of a store whose ownership is verified now (checked again when the job runs).
export async function runAgentSim(admin: SupabaseClient, store: { id: string; url: string }, market: MarketId, send: Send = guardedSend): Promise<SimResult> {
  if (!(await isOwnershipVerified(admin, store.id))) throw new NotVerifiedError("Store ownership is not verified, so the agent purchase test does not run.");
  const { data: connector } = await admin.rpc("get_traffic_connector_secret", { p_store_id: store.id }).maybeSingle<{ token: string }>();
  return simulatePurchase({ storeUrl: store.url, market, checkToken: connector?.token ?? null, send });
}
