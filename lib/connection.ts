// The store connection status shown in the app, set after every scan.
export function connectionAfterScan(result: { ok: true } | { ok: false; message: string }) {
  return result.ok
    ? { connection_status: "connected" as const, connection_error: null }
    : { connection_status: "error" as const, connection_error: result.message.slice(0, 500) };
}
