import Link from "next/link";
import { headers } from "next/headers";
import { createAdminClient } from "@/lib/supabase/admin";
import { listStores } from "@/lib/data";
import { getUser } from "@/lib/supabase/server";
import { canEdit, ensurePersonalWorkspace, listWorkspaces } from "@/lib/workspace";
import { AddStoreForm } from "./add-store-form";
import { DeleteStoreForm } from "./delete-store-form";
import { TrafficConnect } from "./traffic-connect";
import { PluginOnboarding } from "@/components/plugin-onboarding";

export default async function SettingsPage() {
  const { supabase, user } = await getUser();
  if (user) await ensurePersonalWorkspace(createAdminClient(), user.id).catch(() => null);
  const workspaces = user ? await listWorkspaces(supabase, user.id) : [];
  const roleOf = new Map(workspaces.map((w) => [w.id, w]));
  const stores = await listStores(supabase);
  const host = (await headers()).get("host") ?? "";
  const endpoint = `https://${host}/api/ingest/traffic`;

  // Connector rows are server-only; read them for the stores RLS returned to this user.
  const connectors = new Map<string, { hint: string; lastIngestAt: string | null }>();
  if (stores.length) {
    try {
      const { data } = await createAdminClient().from("traffic_connectors").select("store_id, token_hint, last_ingest_at").in("store_id", stores.map((s) => s.id));
      for (const c of data ?? []) connectors.set(c.store_id, { hint: c.token_hint, lastIngestAt: c.last_ingest_at });
    } catch {
      // Shown as not connected.
    }
  }

  return (
    <>
      <div className="page-head">
        <h1>Settings</h1>
        <p className="sub">Your stores and their WooCommerce connection. <Link href="/settings/workspaces">Workspaces and members</Link></p>
      </div>

      <h2>Stores</h2>
      {stores.length === 0 && <p className="muted">No stores yet. Add your first store below.</p>}
      {stores.map((s) => (
        <div key={s.id} className="card">
          <div className="row" style={{ justifyContent: "space-between" }}>
            <Link href={`/stores/${s.id}`}><strong>{s.name}</strong></Link>
            <span className={`status-${s.connection_status}`}>{s.connection_status}</span>
          </div>
          <div className="muted">{s.url} · {roleOf.get(s.workspace_id)?.name ?? "workspace"} ({roleOf.get(s.workspace_id)?.role ?? "member"})</div>
          {s.connection_status === "error" && s.connection_error && <p className="error">Last error: {s.connection_error}</p>}
          {canEdit(roleOf.get(s.workspace_id)?.role) ? (
            <>
              <details>
                <summary className="muted">AI traffic plugin{connectors.get(s.id) ? " (connected)" : " (not connected)"}</summary>
                <PluginOnboarding connected={connectors.get(s.id) ?? null} codeHere>
                  <TrafficConnect storeId={s.id} connected={connectors.get(s.id) ?? null} endpoint={endpoint} />
                </PluginOnboarding>
              </details>
              <details>
                <summary className="muted">Delete this store</summary>
                <DeleteStoreForm storeId={s.id} storeName={s.name} />
              </details>
            </>
          ) : (
            <p className="muted small">You are a viewer in this workspace: you can read reports, not change keys or delete.</p>
          )}
        </div>
      ))}

      <h2>Add store</h2>
      <AddStoreForm workspaces={workspaces.filter((w) => canEdit(w.role)).map((w) => ({ id: w.id, name: w.personal ? `${w.name} (personal)` : w.name }))} />
    </>
  );
}
