"use client";

import { useActionState } from "react";
import { deleteStore, type DeleteStoreState } from "@/app/stores/actions";

export function DeleteStoreForm({ storeId, storeName }: { storeId: string; storeName: string }) {
  const [state, action, pending] = useActionState<DeleteStoreState, FormData>(deleteStore, {});
  return (
    <form
      action={action}
      className="stack card"
      onSubmit={(e) => {
        if (!window.confirm(`Delete "${storeName}"? Its scans, findings and saved API key will be removed. This cannot be undone.`)) e.preventDefault();
      }}
    >
      <input type="hidden" name="store_id" value={storeId} />
      <label>
        Type <strong>{storeName}</strong> to confirm
        <input name="confirm_name" autoComplete="off" required />
      </label>
      {state.error && <p className="error">{state.error}</p>}
      <div>
        <button className="danger" disabled={pending}>{pending ? "Deleting…" : "Delete store"}</button>
      </div>
    </form>
  );
}
