"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";

// A read-only text the merchant copies or downloads. AgentScope writes nothing to the store.
export function CopyBox({ text, filename, rows = 12 }: { text: string; filename?: string; rows?: number }) {
  const t = useTranslations("copyBox");
  const [copied, setCopied] = useState(false);
  return (
    <div className="stack">
      <textarea readOnly value={text} rows={rows} dir="ltr" spellCheck={false} style={{ fontFamily: "ui-monospace, monospace", fontSize: 13, width: "100%" }} />
      <div className="row">
        <button
          type="button"
          className="secondary"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(text);
              setCopied(true);
            } catch {
              setCopied(false);
            }
          }}
        >
          {copied ? t("copied") : t("copy")}
        </button>
        {filename && <a className="button secondary" download={filename} href={`data:text/plain;charset=utf-8,${encodeURIComponent(text)}`}>{t("download", { filename })}</a>}
      </div>
    </div>
  );
}
