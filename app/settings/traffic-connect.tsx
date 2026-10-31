"use client";

import { useTranslations } from "next-intl";
import { useActionState } from "react";
import { createTrafficToken, disconnectTraffic, type TrafficTokenState } from "@/app/stores/actions";

type Props = { storeId: string; connected: { hint: string; lastIngestAt: string | null } | null; endpoint: string };

// The code the plugin's Settings take in one field: "agsc1." + base64url JSON {endpoint, store_id, token}.
function connectionCode(endpoint: string, storeId: string, token: string): string {
  const json = JSON.stringify({ endpoint, store_id: storeId, token });
  return "agsc1." + btoa(json).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function TrafficConnect({ storeId, connected, endpoint }: Props) {
  const [state, action, pending] = useActionState<TrafficTokenState, FormData>(createTrafficToken, {});
  const tc = useTranslations("formsUi");
  return (
    <div className="stack" style={{ display: "grid", gap: 8 }}>
      {connected && <p className="muted small">{tc("connectedWith", { hint: connected.hint })}</p>}
      {state.token && (
        <div className="card" style={{ background: "var(--emerald-soft)" }}>
          <strong>{tc("copyNow")}</strong>
          <p style={{ wordBreak: "break-all" }}>{tc("code")} <code>{connectionCode(endpoint, storeId, state.token)}</code></p>
          <p className="muted small">{tc("old")}</p>
          <p>{tc("endpoint")} <code>{endpoint}</code></p>
          <p>{tc("storeId")} <code>{storeId}</code></p>
          <p style={{ wordBreak: "break-all" }}>{tc("token")} <code>{state.token}</code></p>
        </div>
      )}
      {state.error && <p className="error">{state.error}</p>}
      <div className="row">
        <form action={action}>
          <input type="hidden" name="store_id" value={storeId} />
          <button disabled={pending} aria-busy={pending}>{pending ? tc("creating") : connected ? tc("newToken") : tc("connect")}</button>
        </form>
        {connected && (
          <form action={disconnectTraffic} onSubmit={(e) => { if (!window.confirm(tc("confirmDisconnect"))) e.preventDefault(); }}>
            <input type="hidden" name="store_id" value={storeId} />
            <button className="secondary">{tc("disconnect")}</button>
          </form>
        )}
      </div>
    </div>
  );
}
