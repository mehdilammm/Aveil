import { createAdminClient } from "@/lib/supabase/admin";
import { getUser } from "@/lib/supabase/server";
import { ensurePersonalWorkspace, listWorkspaces } from "@/lib/workspace";
import { removeMember, revokeInvite } from "./actions";
import { CreateWorkspaceForm, InviteForm } from "./forms";

export const metadata = { title: "Workspaces · Settings" };

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
  const { data: invites } = owned.length
    ? await admin.from("workspace_invites").select("id, workspace_id, role, email, expires_at").in("workspace_id", owned).is("accepted_at", null).is("revoked_at", null).gt("expires_at", new Date().toISOString())
    : { data: [] };

  return (
    <>
      <div className="page-head">
        <h1>Workspaces</h1>
        <p className="sub">A workspace holds stores and the people who can see them. Owner and Admin change things; Viewer only reads.</p>
      </div>
      {workspaces.map((w) => (
        <div key={w.id} className="card">
          <div className="row" style={{ justifyContent: "space-between" }}>
            <strong>{w.name}{w.personal ? " (personal)" : ""}</strong>
            <span className="badge">{w.role}</span>
          </div>
          <p className="muted small">Stores: {(stores ?? []).filter((s) => s.workspace_id === w.id).map((s) => s.name).join(", ") || "none"}</p>
          <table>
            <thead><tr><th>Member</th><th>Role</th><th></th></tr></thead>
            <tbody>
              {(members ?? []).filter((m) => m.workspace_id === w.id).map((m) => (
                <tr key={m.user_id}>
                  <td>{emails.get(m.user_id) ?? "unknown"}{m.user_id === user.id ? " (you)" : ""}</td>
                  <td>{m.role}</td>
                  <td>
                    {w.role === "owner" && m.role !== "owner" && (
                      <form action={removeMember}>
                        <input type="hidden" name="workspace_id" value={w.id} />
                        <input type="hidden" name="user_id" value={m.user_id} />
                        <button className="secondary" style={{ padding: "2px 8px" }}>Remove</button>
                      </form>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {w.role === "owner" && (
            <>
              <h3 className="small">Invite</h3>
              <InviteForm workspaceId={w.id} />
              {(invites ?? []).filter((i) => i.workspace_id === w.id).map((i) => (
                <form key={i.id} action={revokeInvite} className="row small" style={{ gap: 8 }}>
                  <input type="hidden" name="workspace_id" value={w.id} />
                  <input type="hidden" name="invite_id" value={i.id} />
                  <span className="muted">Open invite: {i.role}{i.email ? ` for ${i.email}` : ""}, until {i.expires_at.slice(0, 10)}</span>
                  <button className="secondary" style={{ padding: "2px 8px" }}>Cancel</button>
                </form>
              ))}
            </>
          )}
        </div>
      ))}
      <h2>New workspace</h2>
      <CreateWorkspaceForm />
    </>
  );
}
