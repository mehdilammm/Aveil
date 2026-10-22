import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { costMicros, PROVIDERS, utcDay, type Provider, type ProviderUsage } from "./usage";

// Requests used today by a workspace, per provider.
export async function usageToday(admin: SupabaseClient, workspaceId: string): Promise<Record<Provider, number>> {
  const out = Object.fromEntries(PROVIDERS.map((p) => [p, 0])) as Record<Provider, number>;
  const { data } = await admin.from("usage_events").select("provider, requests").eq("workspace_id", workspaceId).gte("created_at", `${utcDay()}T00:00:00Z`);
  for (const r of data ?? []) if (r.provider in out) out[r.provider as Provider] += r.requests;
  return out;
}

// One row per provider that was used.
export async function recordUsage(
  admin: SupabaseClient,
  ctx: { workspaceId: string; storeId: string | null; kind: string; refId?: string | null },
  usage: Partial<Record<Provider, ProviderUsage>>,
) {
  const rows = PROVIDERS.filter((p) => (usage[p]?.requests ?? 0) > 0).map((p) => ({
    workspace_id: ctx.workspaceId,
    store_id: ctx.storeId,
    kind: ctx.kind,
    ref_id: ctx.refId ?? null,
    provider: p,
    requests: usage[p]!.requests,
    input_tokens: usage[p]!.input,
    output_tokens: usage[p]!.output,
    cost_usd_micros: costMicros(p, usage[p]!),
  }));
  if (rows.length) await admin.from("usage_events").insert(rows);
}
