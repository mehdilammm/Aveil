"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";

export function RunScanButton({ storeId, label = "Run scan" }: { storeId: string; label?: string }) {
  const router = useRouter();
  const running = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    // The ref blocks a second click that lands before React re-renders the disabled button.
    if (running.current) return;
    running.current = true;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/stores/${storeId}/scan`, { method: "POST" });
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
      <button onClick={run} disabled={busy} aria-busy={busy}>{busy ? "Scanning… this can take a minute" : label}</button>
      {error && <p className="error">{error}</p>}
    </div>
  );
}
