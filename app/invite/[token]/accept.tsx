"use client";

import { useActionState } from "react";
import { acceptInvite, type WsState } from "@/app/settings/workspaces/actions";

export function AcceptInvite({ token }: { token: string }) {
  const [state, action, pending] = useActionState<WsState, FormData>(acceptInvite, {});
  return (
    <form action={action}>
      <input type="hidden" name="token" value={token} />
      <button disabled={pending}>{pending ? "Joining…" : "Join workspace"}</button>
      {state.error && <p className="error">{state.error}</p>}
    </form>
  );
}
