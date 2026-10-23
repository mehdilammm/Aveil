"use client";

import { useTranslations } from "next-intl";
import { useActionState } from "react";
import { INPUT_FIELDS, MAX_INPUT } from "@/lib/fixes/description";
import { generateDraft, type DraftState } from "./actions";

export function DraftForm({ storeId, productId, inputs }: { storeId: string; productId: number; inputs: Record<string, string> }) {
  const t = useTranslations("descriptions");
  const [state, action, pending] = useActionState<DraftState, FormData>(generateDraft, {});
  return (
    <form action={action} className="stack">
      <input type="hidden" name="store_id" value={storeId} />
      <input type="hidden" name="product_id" value={productId} />
      <p className="muted small">{t("inputsIntro")}</p>
      {INPUT_FIELDS.map((k) => (
        <label key={k} className="small">
          {t(`f_${k}`)}
          <input name={k} defaultValue={inputs[k] ?? ""} maxLength={MAX_INPUT} dir="auto" />
        </label>
      ))}
      <div><button disabled={pending}>{pending ? t("building") : t("build")}</button></div>
      {state.error && <p className="error">{state.error}</p>}
    </form>
  );
}
