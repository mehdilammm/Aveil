import { createAdminClient } from "@/lib/supabase/admin";
import { getUser } from "@/lib/supabase/server";
import { ensurePersonalWorkspace, listWorkspaces } from "@/lib/workspace";
import { removeMember, revokeInvite } from "./actions";
import { CreateWorkspaceForm, InviteForm } from "./forms";
import { DeleteAccountForm, DeleteWorkspaceForm } from "./danger-forms";
import { storesBlockingAccountDelete } from "@/lib/data-export";
import { getTranslations } from "next-intl/server";

export async function generateMetadata() {
  return { title: (await getTranslations("formsUi"))("workspaces") };
}

export default async function WorkspacesPage() {
  const { supabase, user } = await getUser();
  if (!user) return null;
  const admin = createAdminClient();
  await ensurePersonalWorkspace(admin, user.id).catch(() => null);
  const workspaces = await listWorkspaces(supabase, user.id);
  const ids = workspaces.map((w) => w.id);

  const [{ data: members }, { data: stores }] = await Promise.all([
    ids.length ? supabase.from("workspace_members").select("workspace_id, user_id, role").in("workspace_id", ids) : Promise.resolve({ data: [] }),
    ids.length ? supabase.from("stores").select("id, name, workspace_id").in("workspace_id", ids) : Promise.resolve({ data: [] }),
  ]);
  // Member emails come from Auth (server only), for the workspaces this user belongs to.
  const emails = new Map<string, string>();
  for (const uid of new Set((members ?? []).map((m) => m.user_id))) {
    const { data } = await admin.auth.admin.getUserById(uid);
    if (data.user?.email) emails.set(uid, data.user.email);
  }
  const owned = workspaces.filter((w) => w.role === "owner").map((w) => w.id);
  const t = await getTranslations("dataControl");
  const tc = await getTranslations("formsUi");
  const blocking = await storesBlockingAccountDelete(admin, user.id).catch(() => []);
  const { data: invites } = owned.length
    ? await admin.from("workspace_invites").select("id, workspace_id, role, email, expires_at").in("workspace_id", owned).is("accepted_at", null).is("revoked_at", null).gt("expires_at", new Date().toISOString())
    : { data: [] };

  return (
    <>
      <div className="page-head">
        <h1>{tc("workspaces")}</h1>
        <p className="sub">{tc("wsSub")}</p>
      </div>
      {workspaces.map((w) => (
        <div key={w.id} className="card">
          <div className="row" style={{ justifyContent: "space-between" }}>
            <strong>{w.name}{w.personal ? ` (${tc("personal")})` : ""}</strong>
            <span className="badge">{tc(`role_${w.role}`)}</span>
          </div>
          <p className="muted small">{tc("stores", { list: (stores ?? []).filter((s) => s.workspace_id === w.id).map((s) => s.name).join(", ") || tc("none") })}</p>
          <table className="rtable">
            <thead><tr><th>{tc("member")}</th><th>{tc("role")}</th><th></th></tr></thead>
            <tbody>
              {(members ?? []).filter((m) => m.workspace_id === w.id).map((m) => (
                <tr key={m.user_id}>
                  <td data-label={tc("member")}>{emails.get(m.user_id) ?? tc("unknown")}{m.user_id === user.id ? ` (${tc("you")})` : ""}</td>
                  <td data-label={tc("role")}>{tc(`role_${m.role}`)}</td>
                  <td data-label="">
                    {w.role === "owner" && m.role !== "owner" && (
                      <form action={removeMember}>
                        <input type="hidden" name="workspace_id" value={w.id} />
                        <input type="hidden" name="user_id" value={m.user_id} />
                        <button className="secondary">{tc("remove")}</button>
                      </form>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {w.role === "owner" && (
            <p className="row small">
              <a className="button secondary" href={`/api/workspaces/${w.id}/export`}>{t("export")}</a>
              <span className="muted">{t("exportNote")}</span>
            </p>
          )}
          {w.role === "owner" && <DeleteWorkspaceForm workspaceId={w.id} name={w.name} />}
          {w.role === "owner" && (
            <>
              <h3 className="small">{tc("invite")}</h3>
              <InviteForm workspaceId={w.id} />
              {(invites ?? []).filter((i) => i.workspace_id === w.id).map((i) => (
                <form key={i.id} action={revokeInvite} className="row small" style={{ gap: 8 }}>
                  <input type="hidden" name="workspace_id" value={w.id} />
                  <input type="hidden" name="invite_id" value={i.id} />
                  <span className="muted">{tc("openInvite", { role: tc(`role_${i.role}`), email: i.email ?? "", until: i.expires_at.slice(0, 10) })}</span>
                  <button className="secondary">{tc("cancel")}</button>
                </form>
              ))}
            </>
          )}
        </div>
      ))}
      <h2>{tc("newWs")}</h2>
      <CreateWorkspaceForm />
      <h2>{t("accountTitle")}</h2>
      <div className="card">
        <DeleteAccountForm email={user.email ?? ""} blocking={blocking.map((b) => b.name)} />
      </div>
    </>
  );
}
