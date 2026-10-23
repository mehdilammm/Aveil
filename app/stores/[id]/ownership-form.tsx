"use client";

import { useTranslations } from "next-intl";
import { useActionState } from "react";
import { ownershipAction, type OwnershipState } from "./ownership-actions";

export function OwnershipForm({ storeId, method, hasToken }: { storeId: string; method: string; hasToken: boolean }) {
  const t = useTranslations("ownership");
  const [state, action, pending] = useActionState<OwnershipState, FormData>(ownershipAction, {});
  return (
    <form action={action} className="row">
      <input type="hidden" name="store_id" value={storeId} />
      <input type="hidden" name="method" value={method} />
      <button name="intent" value={hasToken ? "check" : "start"} className="secondary" disabled={pending}>
        {pending ? t("checking") : hasToken ? t("checkNow") : t("start")}
      </button>
      {state.error && <span className="error small">{state.error}</span>}
      {state.result && <span className={state.result.verified ? "status-connected small" : "error small"}>{state.result.evidence}</span>}
    </form>
  );
}
