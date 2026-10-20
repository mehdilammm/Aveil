"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function RunScanButton({ storeId }: { storeId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/stores/${storeId}/scan`, { method: "POST" });
      const body = await res.json().catch(() => ({}));
      if (body.error) setError(body.error);
      if (body.scanId && !body.error) router.push(`/stores/${storeId}/scans/${body.scanId}`);
      else router.refresh();
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <button onClick={run} disabled={busy}>{busy ? "Scanning… this can take a minute" : "Run scan"}</button>
      {error && <p className="error">{error}</p>}
    </div>
  );
}
