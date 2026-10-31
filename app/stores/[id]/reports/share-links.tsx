"use client";

import { useTranslations, useLocale } from "next-intl";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { formatDate } from "@/components/badges";

type Link = { id: string; created_at: string; expires_at: string; revoked_at: string | null; views: number; state: "ok" | "expired" | "revoked" };

export function ShareLinks({ storeId, links, canShare, hasScan }: { storeId: string; links: Link[]; canShare: boolean; hasScan: boolean }) {
  const locale = useLocale();
  const t = useTranslations("share");
  const router = useRouter();
  const [days, setDays] = useState(30);
  const [busy, setBusy] = useState(false);
  const [url, setUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function call(body: object) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/stores/${storeId}/share`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const out = await res.json().catch(() => ({}));
      if (!res.ok) setError(out.error ?? t("failed"));
      else {
        if (out.url) setUrl(out.url);
        router.refresh();
      }
    } catch {
      setError(t("failed"));
    } finally {
      setBusy(false);
    }
  }
  const label = { ok: t("statusOk"), expired: t("statusExpired"), revoked: t("statusRevoked") };

  return (
    <div className="card">
      <strong>{t("title")}</strong>
      <p className="muted">{t("sub")}</p>
      {canShare ? (
        <div className="row">
          <label>
            {t("days")}{" "}
            <select value={days} onChange={(e) => setDays(Number(e.target.value))}>
              {[7, 30, 90].map((d) => <option key={d} value={d}>{t("dayOption", { days: d })}</option>)}
            </select>
          </label>
          <button type="button" onClick={() => call({ days })} disabled={busy || !hasScan}>{busy ? t("creating") : t("create")}</button>
        </div>
      ) : (
        <p className="muted">{t("viewerOnly")}</p>
      )}
      {url && (
        <div className="row">
          <span className="muted">{t("copyOnce")}</span>
          <code dir="ltr">{url}</code>
          <button type="button" className="secondary" onClick={() => navigator.clipboard.writeText(url).then(() => setCopied(true))}>{copied ? t("copied") : t("copy")}</button>
        </div>
      )}
      {error && <p className="error">{error}</p>}
      <h3>{t("active")}</h3>
      {links.length === 0 ? (
        <p className="muted">{t("none")}</p>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr><th>{t("created")}</th><th>{t("expires")}</th><th className="num">{t("views")}</th><th>{t("status")}</th><th /></tr>
            </thead>
            <tbody>
              {links.map((l) => (
                <tr key={l.id}>
                  <td>{formatDate(l.created_at, locale)}</td>
                  <td>{formatDate(l.expires_at, locale)}</td>
                  <td className="num">{l.views}</td>
                  <td>{label[l.state]}</td>
                  <td>{canShare && l.state === "ok" && <button type="button" className="secondary" disabled={busy} onClick={() => call({ revoke: l.id })}>{t("revoke")}</button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
