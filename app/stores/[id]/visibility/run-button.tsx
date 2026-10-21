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
