"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";

export function RunVisibilityButton({ storeId, disabledReason }: { storeId: string; disabledReason: string | null }) {
  const router = useRouter();
  const running = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    if (running.current) return;
    running.current = true;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/stores/${storeId}/visibility`, { method: "POST" });
      const body = await res.json().catch(() => ({}));
      if (body.error) setError(body.error);
      router.refresh();
    } catch {
      setError("Network error. Please try again.");
    } finally {
      running.current = false;
      setBusy(false);
    }
  }

  return (
    <div>
      <button onClick={run} disabled={busy || Boolean(disabledReason)} aria-busy={busy}>{busy ? "Asking Gemini… up to a few minutes" : "Run questions now"}</button>
      {disabledReason && <p className="muted small">{disabledReason}</p>}
      {error && <p className="error">{error}</p>}
    </div>
  );
}

export function RereadButton({ storeId, count }: { storeId: string; count: number }) {
  const router = useRouter();
  const running = useRef(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function run() {
    if (running.current) return;
    running.current = true;
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch(`/api/stores/${storeId}/visibility/reread`, { method: "POST" });
      const body = await res.json().catch(() => ({}));
      setMessage(body.error ?? `Re-read ${body.updated} answers.`);
      router.refresh();
    } catch {
      setMessage("Network error. Please try again.");
    } finally {
      running.current = false;
      setBusy(false);
    }
  }

  return (
    <div style={{ marginTop: 8 }}>
      <button className="secondary" onClick={run} disabled={busy} aria-busy={busy}>
        {busy ? "Re-reading…" : `Re-read ${count} stored answer${count === 1 ? "" : "s"}`}
      </button>
      <p className="muted small">Reads the shop names again from answers saved before the structured extraction. One small Gemini request per answer, once.</p>
      {message && <p className="muted">{message}</p>}
    </div>
  );
}
