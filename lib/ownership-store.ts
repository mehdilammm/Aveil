import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { OwnershipMethod } from "./platform/adapter";
import { VERIFICATION_DAYS } from "./ownership";

type Store = { id: string; owner_id: string };

// Records the result of a verification check. A failed check keeps an earlier success until it expires.
export async function recordVerification(admin: SupabaseClient, store: Store, method: OwnershipMethod, result: { verified: boolean; evidence: string }, token: string | null = null) {
  const now = new Date();
  const row: Record<string, unknown> = { store_id: store.id, owner_id: store.owner_id, method, checked_at: now.toISOString(), evidence: result.evidence.slice(0, 500) };
  if (token) row.token = token;
  if (result.verified) {
    row.verified_at = now.toISOString();
    row.expires_at = new Date(now.getTime() + VERIFICATION_DAYS * 86_400_000).toISOString();
  }
  const { error } = await admin.from("store_verifications").upsert(row, { onConflict: "store_id,method" });
  if (error) throw error;
}

// Verified now by any method (deep scans and, later, write actions require this).
export async function isOwnershipVerified(admin: SupabaseClient, storeId: string): Promise<boolean> {
  const { data } = await admin.from("store_verifications").select("method").eq("store_id", storeId).gt("expires_at", new Date().toISOString()).not("verified_at", "is", null).limit(1);
  return Boolean(data?.length);
}
