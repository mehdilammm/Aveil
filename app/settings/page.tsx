import Link from "next/link";
import { cookies, headers } from "next/headers";
import { getTranslations } from "next-intl/server";
import { checkPrefill, HANDOFF_COOKIE } from "@/lib/check-handoff";
import { createAdminClient } from "@/lib/supabase/admin";
import { listStores } from "@/lib/data";
import { getUser } from "@/lib/supabase/server";
import { canEdit, ensurePersonalWorkspace, listWorkspaces } from "@/lib/workspace";
import { AddStoreForm } from "./add-store-form";
import { ChangeUrlForm } from "./change-url-form";
import { DeleteStoreForm } from "./delete-store-form";
import { TrafficConnect } from "./traffic-connect";
import { PluginOnboarding } from "@/components/plugin-onboarding";
import { EmptyState, PageHead } from "@/components/ui";

export async function generateMetadata() {
  return { title: (await getTranslations("nav"))("settings") };
}

export default async function SettingsPage({ searchParams }: { searchParams: Promise<{ from_check?: string }> }) {
  const { supabase, user } = await getUser();
  const tu = await getTranslations("urlChange");
  const t = await getTranslations("settingsPage");
  const to = await getTranslations("overview");
  if (user) await ensurePersonalWorkspace(createAdminClient(), user.id).catch(() => null);
  const workspaces = user ? await listWorkspaces(supabase, user.id) : [];
  const roleOf = new Map(workspaces.map((w) => [w.id, w]));
  const stores = await listStores(supabase);
  const host = (await headers()).get("host") ?? "";
  const endpoint = `https://${host}/api/ingest/traffic`;
  const { from_check } = await searchParams;
  const prefill = user ? await checkPrefill(createAdminClient(), from_check ?? (await cookies()).get(HANDOFF_COOKIE)?.value) : null;

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
      <PageHead title={t("title")} icon="settings" sub={<>{t("sub")} <Link href="/settings/workspaces">{t("workspaces")}</Link></>} action={<a className="button secondary" href="#add-store">{t("addStore")}</a>} />

      <h2>{t("stores")}</h2>
      {stores.length === 0 && <EmptyState icon="store" title={t("noStoresTitle")} text={t("noStores")} action={<a className="button" href="#add-store">{t("addStore")}</a>} />}
      {stores.map((s) => (
        <div key={s.id} className="card">
          <div className="row" style={{ justifyContent: "space-between" }}>
            <Link href={`/stores/${s.id}`}><strong>{s.name}</strong></Link>
            <span className={`status-${s.connection_status}`}>{["connected", "error", "not-connected"].includes(s.connection_status) ? to(`status.${s.connection_status}`) : s.connection_status}</span>
          </div>
          <div className="muted"><bdi>{s.url}</bdi> · {roleOf.get(s.workspace_id)?.name ?? t("workspace")} ({roleOf.get(s.workspace_id)?.role ?? "member"})</div>
          {s.connection_status === "error" && s.connection_error && <p className="error">{t("lastError")}: {s.connection_error}</p>}
          {canEdit(roleOf.get(s.workspace_id)?.role) ? (
            <>
              <details className="fold">
                <summary>{t("plugin")} · {connectors.get(s.id) ? to("status.connected") : to("status.not-connected")}</summary>
                <PluginOnboarding connected={connectors.get(s.id) ?? null} codeHere>
                  <TrafficConnect storeId={s.id} connected={connectors.get(s.id) ?? null} endpoint={endpoint} />
                </PluginOnboarding>
              </details>
              {roleOf.get(s.workspace_id)?.role === "owner" && (
                <details className="fold">
                  <summary>{tu("title")}</summary>
                  <ChangeUrlForm storeId={s.id} />
                </details>
              )}
              <details className="fold">
                <summary>{t("delete")}</summary>
                <DeleteStoreForm storeId={s.id} storeName={s.name} />
              </details>
            </>
          ) : (
            <p className="muted small">{t("viewer")}</p>
          )}
        </div>
      ))}

      <h2 id="add-store">{t("addStore")}</h2>
      <AddStoreForm prefill={prefill} workspaces={workspaces.filter((w) => canEdit(w.role)).map((w) => ({ id: w.id, name: w.personal ? `${w.name} (personal)` : w.name }))} />
    </>
  );
}
