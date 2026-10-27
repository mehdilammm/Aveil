import "server-only";
import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

// Counts hits per key in a fixed window (public.public_scan_hit; keys are stored as sha256, never as text).
// Fails open on a database error so a counter problem never blocks the app; the error is logged.
export async function hit(admin: SupabaseClient, key: string, windowSeconds: number): Promise<number> {
  const { data, error } = await admin.rpc("public_scan_hit", { p_ip_hash: createHash("sha256").update(key).digest("hex"), p_window_seconds: windowSeconds });
  if (error) {
    console.error("rate limit: counter failed", error.code);
    return 0;
  }
  return Number(data ?? 0);
}

// Per-store limits on actions a signed-in editor can repeat (each runs requests against the store or an AI API).
export const STORE_LIMITS = {
  scan: { max: 6, windowSeconds: 3600, label: "6 scans an hour" },
  verify: { max: 30, windowSeconds: 3600, label: "30 re-checks an hour" },
  reread: { max: 5, windowSeconds: 3600, label: "5 re-reads an hour" },
  simulate: { max: 5, windowSeconds: 3600, label: "5 agent purchase tests an hour" },
} as const;

export async function storeLimit(admin: SupabaseClient, storeId: string, action: keyof typeof STORE_LIMITS): Promise<string | null> {
  const l = STORE_LIMITS[action];
  const n = await hit(admin, `store:${action}:${storeId}`, l.windowSeconds);
  return n > l.max ? `Too many requests for this store (at most ${l.label}). Try again later.` : null;
}

// A signed ingest request seen before (same signature, so same timestamp and body) inside the clock window.
export async function isReplay(admin: SupabaseClient, signature: string, windowSeconds: number): Promise<boolean> {
  return (await hit(admin, `ingest:${signature}`, windowSeconds)) > 1;
}
