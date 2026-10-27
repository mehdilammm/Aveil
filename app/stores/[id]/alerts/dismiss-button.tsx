"use client";

import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useState } from "react";

export function DismissButton({ storeId, alertId }: { storeId: string; alertId: string }) {
  const t = useTranslations("alerts");
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  return (
    <button type="button" className="secondary" disabled={busy} onClick={async () => {
      setBusy(true);
      await fetch(`/api/stores/${storeId}/alerts`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ dismiss: alertId }) }).catch(() => null);
      setBusy(false);
      router.refresh();
    }}>{t("dismiss")}</button>
  );
}
