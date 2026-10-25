"use client";

import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useState } from "react";

type Methods = { dns_txt: { host: string; value: string }; meta_tag: { html: string }; well_known_file: { url: string; content: string } };

// Change the store address (owner only): get a token, put it on the new address, check it; only then it changes.
export function ChangeUrlForm({ storeId }: { storeId: string }) {
  const t = useTranslations("urlChange");
  const router = useRouter();
  const [url, setUrl] = useState("");
  const [methods, setMethods] = useState<Methods | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function call(body: object) {
    setBusy(true);
    setMsg(null);
    const res = await fetch(`/api/stores/${storeId}/url`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const out = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    setBusy(false);
    return { ok: res.ok, out };
  }

  return (
    <div className="stack">
      <p className="muted small">{t("note")}</p>
      <label>
        {t("newUrl")}
        <input type="url" value={url} placeholder="https://shop.example.com" onChange={(e) => { setUrl(e.target.value); setMethods(null); }} />
      </label>
      <div>
        <button type="button" className="secondary" disabled={busy || !url} onClick={async () => {
          const r = await call({ url, action: "start" });
          if (r.ok) setMethods(r.out.methods as Methods);
          else setMsg({ ok: false, text: String(r.out.error ?? t("failed")) });
        }}>{t("start")}</button>
      </div>
      {methods && (
        <ul className="small">
          <li>{t("dns", { host: methods.dns_txt.host })} <code dir="ltr">{methods.dns_txt.value}</code></li>
          <li>{t("meta")} <code dir="ltr">{methods.meta_tag.html}</code></li>
          <li>{t("file", { url: methods.well_known_file.url })} <code dir="ltr">{methods.well_known_file.content}</code></li>
        </ul>
      )}
      {methods && (
        <div className="row">
          {(["dns_txt", "meta_tag", "well_known_file"] as const).map((m) => (
            <button key={m} type="button" disabled={busy} onClick={async () => {
              const r = await call({ url, action: "confirm", method: m });
              setMsg({ ok: r.ok, text: r.ok ? t("done") : String(r.out.evidence ?? r.out.error ?? t("failed")) });
              if (r.ok) router.refresh();
            }}>{t(`check_${m}`)}</button>
          ))}
        </div>
      )}
      {msg && <p className={msg.ok ? "notice" : "error"}>{msg.text}</p>}
    </div>
  );
}
