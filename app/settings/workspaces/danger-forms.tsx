"use client";

import { useTranslations } from "next-intl";
import { useActionState } from "react";
import { deleteAccountAction, deleteWorkspaceAction, type DeleteState } from "./actions";

export function DeleteWorkspaceForm({ workspaceId, name }: { workspaceId: string; name: string }) {
  const t = useTranslations("dataControl");
  const [state, action, pending] = useActionState<DeleteState, FormData>(deleteWorkspaceAction, {});
  return (
    <details>
      <summary className="small error">{t("deleteWorkspace")}</summary>
      <form action={action} className="stack small" onSubmit={(e) => { if (!window.confirm(t("confirmWorkspace", { name }))) e.preventDefault(); }}>
        <p className="muted">{t("deleteWorkspaceNote")}</p>
        <input type="hidden" name="workspace_id" value={workspaceId} />
        <label>{t("typeName", { name })}<input name="confirm_name" autoComplete="off" required /></label>
        {state.error && <p className="error">{state.error}</p>}
        <div><button className="danger" disabled={pending}>{pending ? t("deleting") : t("deleteForever")}</button></div>
      </form>
    </details>
  );
}

export function DeleteAccountForm({ email, blocking }: { email: string; blocking: string[] }) {
  const t = useTranslations("dataControl");
  const [state, action, pending] = useActionState<DeleteState, FormData>(deleteAccountAction, {});
  return (
    <form action={action} className="stack small" onSubmit={(e) => { if (!window.confirm(t("confirmAccount"))) e.preventDefault(); }}>
      <p className="muted">{t("deleteAccountNote")}</p>
      {blocking.length > 0 && <p className="error">{t("blocking", { stores: blocking.join(", ") })}</p>}
      <label>{t("typeEmail", { email })}<input name="confirm_email" type="email" autoComplete="off" required /></label>
      {state.error && <p className="error">{state.error}</p>}
      <div><button className="danger" disabled={pending || blocking.length > 0}>{pending ? t("deleting") : t("deleteAccount")}</button></div>
    </form>
  );
}
