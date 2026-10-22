"use client";

import { useActionState } from "react";
import { joinWaitlist, type WaitlistState } from "./actions";

export function WaitlistForm({ plan }: { plan: string }) {
  const [state, action, pending] = useActionState<WaitlistState, FormData>(joinWaitlist, {});
  if (state.done) return <p className="notice">You are on the waitlist. We will email you when payments open.</p>;
  return (
    <form action={action} className="waitlist">
      <input type="hidden" name="plan" value={plan} />
      <input name="website" tabIndex={-1} autoComplete="off" aria-hidden="true" className="hp" />
      <input name="email" type="email" required placeholder="you@store.com" aria-label="Email" autoComplete="email" />
      <button disabled={pending}>{pending ? "Saving…" : "Join the waitlist"}</button>
      {state.error && <p className="error small">{state.error}</p>}
    </form>
  );
}
