"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { aiOrdersLabel } from "@/lib/ai-orders";

export function RefreshOrders({ storeId }: { storeId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  async function run() {
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch(`/api/stores/${storeId}/orders`, { method: "POST" });
      const body = await res.json().catch(() => ({}));
      setMessage(body.error ?? (body.status === "ok" ? `Done: ${aiOrdersLabel(body.aiOrders)}.` : body.reason));
      router.refresh();
    } catch {
      setMessage("Network error. Please try again.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div>
      <button className="secondary" onClick={run} disabled={busy}>{busy ? "Reading orders…" : "Refresh orders"}</button>
      {message && <p className="small">{message}</p>}
    </div>
  );
}
