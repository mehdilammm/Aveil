"use client";

import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useState } from "react";

export function RefreshOrders({ storeId }: { storeId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const tc = useTranslations("formsUi");
  async function run() {
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch(`/api/stores/${storeId}/orders`, { method: "POST" });
      const body = await res.json().catch(() => ({}));
      setMessage(body.error ?? (body.status === "ok" ? tc("ordersDone", { n: Number(body.aiOrders ?? 0) }) : body.reason));
      router.refresh();
    } catch {
      setMessage(tc("network"));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div>
      <button className="secondary" onClick={run} disabled={busy}>{busy ? tc("readingOrders") : tc("refreshOrders")}</button>
      {message && <p className="small">{message}</p>}
    </div>
  );
}
