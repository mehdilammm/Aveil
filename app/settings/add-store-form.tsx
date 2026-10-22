"use client";

import { useActionState } from "react";
import { addStore, type AddStoreState } from "@/app/stores/actions";

export function AddStoreForm({ workspaces }: { workspaces: { id: string; name: string }[] }) {
  const [state, action, pending] = useActionState<AddStoreState, FormData>(addStore, {});
  return (
    <form action={action} className="stack card" autoComplete="off">
      {workspaces.length > 1 && (
        <label>
          Workspace
          <select name="workspace_id" defaultValue={workspaces[0].id}>
            {workspaces.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
          </select>
        </label>
      )}
      {workspaces.length === 1 && <input type="hidden" name="workspace_id" value={workspaces[0].id} />}
      <label>
        Store name
        <input name="name" maxLength={120} required />
      </label>
      <label>
        Store URL
        <input name="url" type="url" placeholder="https://shop.example.com" pattern="https://.*" required />
      </label>
      <label>
        Consumer key <small className="hint">WooCommerce → Settings → Advanced → REST API, permission: Read</small>
        <input name="consumer_key" placeholder="ck_…" required />
      </label>
      <label>
        Consumer secret
        <input name="consumer_secret" type="password" placeholder="cs_…" required />
      </label>
      <p className="muted">The key and secret are stored encrypted in Supabase Vault and never shown again.</p>
      {state.error && <p className="error">{state.error}</p>}
      <div>
        <button disabled={pending} aria-busy={pending}>{pending ? "Saving…" : "Add store"}</button>
      </div>
    </form>
  );
}
