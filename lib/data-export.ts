import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

// Everything a workspace holds, for its owner: one JSON document. Secrets are never included (API keys, write
// keys, plugin connection tokens and their hashes stay out).
export const STORE_TABLES = [
  "scans", "findings", "scan_schema_pages", "traffic_daily", "bot_hits", "visibility_prompts", "visibility_runs",
  "visibility_results", "ai_orders", "order_syncs", "store_verifications", "finding_verifications", "visibility_rechecks",
  "description_drafts", "fix_audit_log", "jobs",
] as const;
const STORE_COLUMNS = "id, name, url, owner_id, workspace_id, connection_status, created_at, bot_hit_retention_days, auto_fix_enabled, auto_fix_approved_at, auto_fix_preview";
const MAX_ROWS = 100_000;

async function all(admin: SupabaseClient, table: string, column: string, ids: string[]) {
  const rows: unknown[] = [];
  if (!ids.length) return rows;
  for (let from = 0; from < MAX_ROWS; from += 1000) {
    const { data, error } = await admin.from(table).select("*").in(column, ids).range(from, from + 999);
    if (error) throw new Error(`${table}: ${error.message}`);
    rows.push(...(data ?? []));
    if (!data || data.length < 1000) break;
  }
  return rows;
}

export async function exportWorkspace(admin: SupabaseClient, workspaceId: string) {
  const { data: workspace } = await admin.from("workspaces").select("id, name, personal, plan, created_at").eq("id", workspaceId).single();
  const { data: stores } = await admin.from("stores").select(STORE_COLUMNS).eq("workspace_id", workspaceId);
  const ids = (stores ?? []).map((s) => s.id as string);
  const tables: Record<string, unknown[]> = {};
  for (const t of STORE_TABLES) tables[t] = await all(admin, t, "store_id", ids);
  // job_steps hold step results of this workspace's jobs.
  tables.job_steps = await all(admin, "job_steps", "job_id", (tables.jobs as { id: string }[]).map((j) => j.id));
  tables.usage_events = await all(admin, "usage_events", "workspace_id", [workspaceId]);
  const { data: members } = await admin.from("workspace_members").select("user_id, role, created_at").eq("workspace_id", workspaceId);
  const { data: invites } = await admin.from("workspace_invites").select("id, role, email, expires_at, accepted_at, revoked_at, created_at").eq("workspace_id", workspaceId);
  const { data: connectors } = ids.length ? await admin.from("traffic_connectors").select("store_id, token_hint, created_at, last_ingest_at").in("store_id", ids) : { data: [] };
  return {
    exported_at: new Date().toISOString(),
    format: "agentscope-workspace-export/1",
    note: "API keys, write keys and plugin connection tokens are not included.",
    workspace,
    members: members ?? [],
    invites: invites ?? [],
    stores: stores ?? [],
    plugin_connections: connectors ?? [],
    ...tables,
  };
}

// Stores the user added to workspaces they do not own: deleting the account would delete them from someone
// else's workspace (stores belong to the user who added them), so the account cannot be deleted while they exist.
export async function storesBlockingAccountDelete(admin: SupabaseClient, userId: string): Promise<{ id: string; name: string }[]> {
  const { data: owned } = await admin.from("workspace_members").select("workspace_id").eq("user_id", userId).eq("role", "owner");
  const ownedIds = new Set((owned ?? []).map((w) => w.workspace_id as string));
  const { data: mine } = await admin.from("stores").select("id, name, workspace_id").eq("owner_id", userId);
  return (mine ?? []).filter((s) => !ownedIds.has(s.workspace_id as string)).map((s) => ({ id: s.id as string, name: s.name as string }));
}

// Hard delete: the workspace row; its stores and everything under them go by foreign-key cascade, and the
// triggers delete the Vault secrets (API keys, write keys, plugin tokens).
export async function deleteWorkspace(admin: SupabaseClient, workspaceId: string) {
  const { error } = await admin.from("workspaces").delete().eq("id", workspaceId);
  if (error) throw new Error(error.message);
}

// Hard delete of the account: every workspace the user owns, their waitlist sign-ups, then the user.
export async function deleteAccount(admin: SupabaseClient, userId: string, email: string | null) {
  const blocking = await storesBlockingAccountDelete(admin, userId);
  if (blocking.length) throw new Error(`First remove the stores you added to other workspaces: ${blocking.map((s) => s.name).join(", ")}.`);
  const { data: owned } = await admin.from("workspace_members").select("workspace_id").eq("user_id", userId).eq("role", "owner");
  for (const w of owned ?? []) await deleteWorkspace(admin, w.workspace_id as string);
  if (email) {
    await admin.from("plan_waitlist").delete().ilike("email", email);
    await admin.from("shopify_waitlist").delete().ilike("email", email);
  }
  const { error } = await admin.auth.admin.deleteUser(userId);
  if (error) throw new Error(error.message);
}
