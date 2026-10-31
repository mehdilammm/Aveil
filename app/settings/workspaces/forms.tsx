"use client";

import { useTranslations } from "next-intl";
import { useActionState } from "react";
import { createInvite, createWorkspace, type WsState } from "./actions";

export function CreateWorkspaceForm() {
  const [state, action, pending] = useActionState<WsState, FormData>(createWorkspace, {});
  const tc = useTranslations("formsUi");
  return (
    <form action={action} className="row card" style={{ gap: 8 }}>
      <input name="name" maxLength={80} placeholder={tc("teamName")} required aria-label={tc("wsName")} />
      <button disabled={pending}>{pending ? tc("creating") : tc("createWs")}</button>
      {state.error && <p className="error">{state.error}</p>}
      {state.done && <p className="small">{state.done}</p>}
    </form>
  );
}

export function InviteForm({ workspaceId }: { workspaceId: string }) {
  const [state, action, pending] = useActionState<WsState, FormData>(createInvite, {});
  const tc = useTranslations("formsUi");
  const link = state.link ? (state.link.startsWith("/") ? `${window.location.origin}${state.link}` : state.link) : null;
  return (
    <form action={action} className="stack" style={{ gap: 8 }}>
      <input type="hidden" name="workspace_id" value={workspaceId} />
      <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
        <select name="role" defaultValue="viewer" aria-label={tc("role")}>
          <option value="viewer">{tc("viewer")}</option>
          <option value="admin">{tc("admin")}</option>
        </select>
        <input name="email" type="email" placeholder={tc("emailMatch")} aria-label={tc("email")} />
        <button className="secondary" disabled={pending}>{pending ? tc("creating") : tc("createInvite")}</button>
      </div>
      {state.error && <p className="error">{state.error}</p>}
      {link && (
        <p className="small" style={{ wordBreak: "break-all" }}>
          {tc("sendLink")} <code>{link}</code>
        </p>
      )}
    </form>
  );
}
