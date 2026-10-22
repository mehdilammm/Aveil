"use client";

import { useActionState } from "react";
import { createInvite, createWorkspace, type WsState } from "./actions";

export function CreateWorkspaceForm() {
  const [state, action, pending] = useActionState<WsState, FormData>(createWorkspace, {});
  return (
    <form action={action} className="row card" style={{ gap: 8 }}>
      <input name="name" maxLength={80} placeholder="Team name" required aria-label="Workspace name" />
      <button disabled={pending}>{pending ? "Creating…" : "Create workspace"}</button>
      {state.error && <p className="error">{state.error}</p>}
      {state.done && <p className="small">{state.done}</p>}
    </form>
  );
}

export function InviteForm({ workspaceId }: { workspaceId: string }) {
  const [state, action, pending] = useActionState<WsState, FormData>(createInvite, {});
  const link = state.link ? (state.link.startsWith("/") ? `${window.location.origin}${state.link}` : state.link) : null;
  return (
    <form action={action} className="stack" style={{ gap: 8 }}>
      <input type="hidden" name="workspace_id" value={workspaceId} />
      <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
        <select name="role" defaultValue="viewer" aria-label="Role">
          <option value="viewer">Viewer (read only)</option>
          <option value="admin">Admin (can change stores, run checks)</option>
        </select>
        <input name="email" type="email" placeholder="Email (optional, must match)" aria-label="Email" />
        <button className="secondary" disabled={pending}>{pending ? "Creating…" : "Create invite link"}</button>
      </div>
      {state.error && <p className="error">{state.error}</p>}
      {link && (
        <p className="small" style={{ wordBreak: "break-all" }}>
          Send this link to the person (shown once, valid 7 days, single use): <code>{link}</code>
        </p>
      )}
    </form>
  );
}
