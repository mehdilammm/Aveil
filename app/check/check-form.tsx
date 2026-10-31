"use client";

import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";

export function CheckForm() {
  const router = useRouter();
  const t = useTranslations("checkPage");
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
      else setError(body.error ?? t("failed"));
    } catch {
      setError(t("network"));
    } finally {
      running.current = false;
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="card">
      <label htmlFor="url">{t("address")}</label>
      <div className="check-form" style={{ marginTop: 6 }}>
        <input id="url" name="url" inputMode="url" autoComplete="url" placeholder="shop.example.com" required maxLength={200} />
        <button disabled={busy} aria-busy={busy}>{busy ? t("checking") : t("submit")}</button>
      </div>
      {error && <p className="error">{error}</p>}
      <p className="muted small">{t("free")}</p>
    </form>
  );
}
