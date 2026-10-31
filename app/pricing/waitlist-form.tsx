"use client";

import { useTranslations } from "next-intl";
import { useActionState } from "react";
import { joinWaitlist, type WaitlistState } from "./actions";

export function WaitlistForm({ plan }: { plan: string }) {
  const [state, action, pending] = useActionState<WaitlistState, FormData>(joinWaitlist, {});
  const t = useTranslations("addStore");
  if (state.done) return <p className="notice">{t("waitlistDone")}</p>;
  return (
    <form action={action} className="waitlist">
      <input type="hidden" name="plan" value={plan} />
      <input name="website" tabIndex={-1} autoComplete="off" aria-hidden="true" className="hp" />
      <input name="email" type="email" required placeholder="you@store.com" aria-label={t("email")} autoComplete="email" />
      <button disabled={pending}>{pending ? t("saving") : t("waitlist")}</button>
      {state.error && <p className="error small">{state.error}</p>}
    </form>
  );
}
