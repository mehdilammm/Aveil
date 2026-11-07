"use client";

import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { MARKET_IDS, type MarketId } from "@/lib/markets";

// The countries the store wants to sell to (owner or admin). Nothing ticked = follow WooCommerce's Selling location(s).
export function TargetMarketsForm({ storeId, saved }: { storeId: string; saved: MarketId[] | null }) {
  const t = useTranslations("targetMarkets");
  const router = useRouter();
  const [picked, setPicked] = useState<MarketId[]>(saved ?? []);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  return (
    <form className="stack" onSubmit={async (e) => {
      e.preventDefault();
      setBusy(true);
      setMsg(null);
      const res = await fetch(`/api/stores/${storeId}/target-markets`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ markets: picked }) });
      const out = (await res.json().catch(() => ({}))) as { error?: string };
      setBusy(false);
      setMsg(res.ok ? { ok: true, text: t("saved") } : { ok: false, text: out.error ?? t("failed") });
      if (res.ok) router.refresh();
    }}>
      <p className="muted small">{t("note")} {t("follow")}</p>
      <fieldset className="row" style={{ border: 0, padding: 0, margin: 0, flexWrap: "wrap", gap: "var(--s-3)" }}>
        <legend className="small"><strong>{t("title")}</strong></legend>
        {MARKET_IDS.map((m) => (
          <label key={m} className="row small" style={{ gap: 6 }}>
            <input type="checkbox" checked={picked.includes(m)} onChange={(e) => setPicked((p) => (e.target.checked ? [...p, m] : p.filter((x) => x !== m)))} />
            {t(`c_${m}`)}
          </label>
        ))}
      </fieldset>
      <p className="muted small">{saved?.length ? t("current_owner", { list: saved.map((m) => t(`c_${m}`)).join(", ") }) : t("current_woo")}</p>
      <div><button type="submit" className="secondary" disabled={busy}>{busy ? t("saving") : t("save")}</button></div>
      {msg && <p className={msg.ok ? "notice" : "error"} role="status">{msg.text}</p>}
    </form>
  );
}
