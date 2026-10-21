"use client";

import { useState } from "react";

export function WaitlistForm({ reportId }: { reportId: string }) {
  const [state, setState] = useState<"idle" | "busy" | "done">("idle");
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (state === "busy") return;
    setState("busy");
    setError(null);
    const email = String(new FormData(e.currentTarget).get("email") ?? "");
    try {
      const res = await fetch("/api/waitlist", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ reportId, email }) });
      const body = await res.json().catch(() => ({}));
      if (body.ok) setState("done");
      else {
        setError(body.error ?? "Something went wrong.");
        setState("idle");
      }
    } catch {
      setError("Network error. Please try again.");
      setState("idle");
    }
  }

  if (state === "done") return <p><strong>You are on the list.</strong> Thank you.</p>;
  return (
    <form onSubmit={submit} className="check-form">
      <input name="email" type="email" placeholder="Email (optional)" maxLength={254} autoComplete="email" style={{ background: "#fff" }} />
      <button className="button" disabled={state === "busy"}>{state === "busy" ? "Saving…" : "Join the waitlist"}</button>
      {error && <p className="error" style={{ width: "100%" }}>{error}</p>}
      <p className="small" style={{ width: "100%", margin: 0 }}>We only use it to tell you when the Shopify scan is ready.</p>
    </form>
  );
}
