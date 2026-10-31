"use client";

import { useTranslations } from "next-intl";
import { useActionState } from "react";
import { deleteStore, type DeleteStoreState } from "@/app/stores/actions";

export function DeleteStoreForm({ storeId, storeName }: { storeId: string; storeName: string }) {
  const [state, action, pending] = useActionState<DeleteStoreState, FormData>(deleteStore, {});
  const tc = useTranslations("formsUi");
  return (
    <form
      action={action}
      className="stack card"
      onSubmit={(e) => {
        if (!window.confirm(tc("confirmDeleteStore", { name: storeName }))) e.preventDefault();
      }}
    >
      <input type="hidden" name="store_id" value={storeId} />
      <label>
        {tc("typeToConfirm")} <strong>{storeName}</strong>
        <input name="confirm_name" autoComplete="off" required />
      </label>
      {state.error && <p className="error">{state.error}</p>}
      <div>
        <button className="danger" disabled={pending}>{pending ? tc("deleting") : tc("deleteStore")}</button>
      </div>
    </form>
  );
}
