"use client";

import { useActionState } from "react";
import { createTrafficToken, disconnectTraffic, type TrafficTokenState } from "@/app/stores/actions";

type Props = { storeId: string; connected: { hint: string; lastIngestAt: string | null } | null; endpoint: string };

export function TrafficConnect({ storeId, connected, endpoint }: Props) {
  const [state, action, pending] = useActionState<TrafficTokenState, FormData>(createTrafficToken, {});
  return (
    <div className="stack" style={{ display: "grid", gap: 8 }}>
      {connected ? (
        <p className="muted">
          Connected with token {connected.hint}. Last data: {connected.lastIngestAt ? new Date(connected.lastIngestAt).toUTCString() : "none yet"}.
        </p>
      ) : (
        <p className="muted">Not connected. The agentscope-core plugin can send daily AI traffic totals to this store.</p>
      )}
      {state.token && (
        <div className="card" style={{ background: "var(--emerald-soft)" }}>
          <strong>Copy these into the plugin now. The token is shown only once.</strong>
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
