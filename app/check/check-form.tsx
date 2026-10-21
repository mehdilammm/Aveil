"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";

export function CheckForm() {
  const router = useRouter();
  const running = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (running.current) return;
    const url = String(new FormData(e.currentTarget).get("url") ?? "");
    running.current = true;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/check", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ url }) });
      const body = await res.json().catch(() => ({}));
      if (body.id) router.push(`/check/${body.id}`);
      else setError(body.error ?? "Something went wrong. Please try again.");
    } catch {
      setError("Network error. Please try again.");
    } finally {
      running.current = false;
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="card">
      <label htmlFor="url">Store address</label>
      <div className="check-form" style={{ marginTop: 6 }}>
        <input id="url" name="url" inputMode="url" autoComplete="url" placeholder="shop.example.com" required maxLength={200} />
        <button disabled={busy} aria-busy={busy}>{busy ? "Checking… up to 2 minutes" : "Check my store"}</button>
      </div>
      {error && <p className="error">{error}</p>}
      <p className="muted small">Free, no account. We load a few public pages, like a visitor would: at most 10 requests, spaced out.</p>
    </form>
  );
}
