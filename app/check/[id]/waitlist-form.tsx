"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";

export function WaitlistForm({ reportId }: { reportId: string }) {
  const [state, setState] = useState<"idle" | "busy" | "done">("idle");
  const tc = useTranslations("formsUi");
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
        setError(body.error ?? tc("failed"));
        setState("idle");
      }
    } catch {
      setError(tc("network"));
      setState("idle");
    }
  }

  if (state === "done") return <p><strong>{tc("onList")}</strong> {tc("thanks")}</p>;
  return (
    <form onSubmit={submit} className="check-form">
      <input name="email" type="email" placeholder={tc("emailOptional")} maxLength={254} autoComplete="email" style={{ background: "#fff" }} />
      <button className="button" disabled={state === "busy"}>{state === "busy" ? tc("saving") : tc("join")}</button>
      {error && <p className="error" style={{ width: "100%" }}>{error}</p>}
      <p className="small" style={{ width: "100%", margin: 0 }}>{tc("onlyUse")}</p>
    </form>
  );
}
