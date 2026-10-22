"use client";

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
  return (
    <div className="stack" style={{ display: "grid", gap: 8 }}>
      {connected && <p className="muted small">Connected with token {connected.hint}.</p>}
      {state.token && (
        <div className="card" style={{ background: "var(--emerald-soft)" }}>
          <strong>Copy this into the plugin now (AgentScope → Settings → Connection token). It is shown only once.</strong>
          <p style={{ wordBreak: "break-all" }}>Connection code: <code>{connectionCode(endpoint, storeId, state.token)}</code></p>
          <p className="muted small">Plugin 1.0 with the separate Connect page uses the three values below instead.</p>
          <p>Endpoint: <code>{endpoint}</code></p>
          <p>Store ID: <code>{storeId}</code></p>
          <p style={{ wordBreak: "break-all" }}>Token: <code>{state.token}</code></p>
        </div>
      )}
      {state.error && <p className="error">{state.error}</p>}
      <div className="row">
        <form action={action}>
          <input type="hidden" name="store_id" value={storeId} />
          <button disabled={pending} aria-busy={pending}>{pending ? "Creating…" : connected ? "Create new token" : "Connect traffic plugin"}</button>
        </form>
        {connected && (
          <form action={disconnectTraffic} onSubmit={(e) => { if (!window.confirm("Disconnect the traffic plugin? The current token stops working.")) e.preventDefault(); }}>
            <input type="hidden" name="store_id" value={storeId} />
            <button className="secondary">Disconnect</button>
          </form>
        )}
      </div>
    </div>
  );
}
