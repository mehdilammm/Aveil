"use client";

import { useActionState } from "react";
import { addStore, type AddStoreState } from "./actions";

export function AddStoreForm() {
  const [state, action, pending] = useActionState<AddStoreState, FormData>(addStore, {});
  return (
    <form action={action} className="stack card" autoComplete="off">
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
        <button disabled={pending}>{pending ? "Saving…" : "Add store"}</button>
      </div>
    </form>
  );
}
