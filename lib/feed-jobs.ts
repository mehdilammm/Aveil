import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { fixContext, pushFeed } from "./autofix";
import { buildStoreFeed } from "./feed-run";
import { planOf } from "./orders-sync";
import { PLANS } from "./plans";

type Store = { id: string; owner_id: string; url: string; workspace_id?: string };

// The applied feed fix of a store (the one the plugin serves), or null.
export async function activeFeedFix(admin: SupabaseClient, storeId: string): Promise<{ id: string; fixId: string } | null> {
  const { data } = await admin.from("fix_audit_log").select("id, after").eq("store_id", storeId).eq("kind", "feed").eq("status", "applied").order("applied_at", { ascending: false }).limit(1).maybeSingle();
  if (!data) return null;
  const fixId = String((data.after as { fix_id?: string } | null)?.fix_id ?? data.id);
  return { id: data.id as string, fixId };
}

// G1 refresh: builds the feed again from the store's products and replaces the plugin's copy (same fix id).
// Runs after a product publish / update (F3) and every day; does nothing when the merchant has no feed or undid it.
export async function refreshFeed(admin: SupabaseClient, store: Store) {
  const active = await activeFeedFix(admin, store.id);
  if (!active) return { skipped: "no feed applied" };
  if (!PLANS[await planOf(admin, store.id)].productFeed) return { skipped: "plan" };
  const ctx = await fixContext(admin, store);
  const feed = await buildStoreFeed(store, ctx.read);
  const change = await pushFeed(ctx, active.fixId, feed);
  return {
    audit_id: active.id,
    updated_at: feed.metadata.updated_at,
    counts: feed.counts,
    bytes: feed.bytes,
    describe: change.describe,
    rows: feed.rows.slice(0, 300),
  };
}

// Queues one refresh (none when one is already waiting); `delaySeconds` groups several product updates.
export async function enqueueFeedRefresh(admin: SupabaseClient, store: { id: string; workspace_id?: string | null }, delaySeconds: number) {
  if (!(await activeFeedFix(admin, store.id))) return null;
  const { data: open } = await admin.from("jobs").select("id").eq("store_id", store.id).eq("kind", "feed_refresh").in("status", ["queued", "running"]).limit(1).maybeSingle();
  if (open) return open.id as string;
  const { data: job } = await admin.from("jobs").insert({ workspace_id: store.workspace_id ?? null, store_id: store.id, kind: "feed_refresh", max_attempts: 3, run_after: new Date(Date.now() + delaySeconds * 1000).toISOString() }).select("id").single();
  return (job?.id as string | undefined) ?? null;
}
