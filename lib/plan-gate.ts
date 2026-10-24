import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { planOf } from "./orders-sync";
import { planFor, PLANS, type Plan, type PlanFeature } from "./plans";

// G7: every plan limit is checked on the server (routes, actions, jobs); the UI only mirrors it.
export const lockedReason = (f: PlanFeature) => `Unavailable: needs ${PLANS[planFor(f)].name} plan.`;
export async function storePlan(admin: SupabaseClient, storeId: string): Promise<Plan> {
  return PLANS[await planOf(admin, storeId)];
}
export async function workspacePlan(admin: SupabaseClient, workspaceId: string): Promise<Plan> {
  const { data } = await admin.from("workspaces").select("plan").eq("id", workspaceId).maybeSingle();
  const id = data?.plan as keyof typeof PLANS | undefined;
  return PLANS[id && id in PLANS ? id : "free"];
}
