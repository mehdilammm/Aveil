"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";

export function ShareLink({ path }: { path: string }) {
  const [copied, setCopied] = useState(false);
  const tc = useTranslations("formsUi");
  const url = typeof window === "undefined" ? path : `${window.location.origin}${path}`;
  return (
    <div className="row">
      <code className="inline" style={{ wordBreak: "break-all" }}>{url}</code>
      <button
        className="secondary"
        style={{ padding: "4px 10px" }}
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(`${window.location.origin}${path}`);
            setCopied(true);
          } catch {
            setCopied(false);
          }
        }}
      >
        {copied ? tc("copied") : tc("copyLink")}
      </button>
    </div>
  );
}
