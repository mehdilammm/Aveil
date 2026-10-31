import "server-only";
import type { Send } from "./agent-sim";
import { guardedFetch } from "./safe-fetch";

const MAX_BYTES = 1_000_000;
const TIMEOUT_MS = 12_000;

// The simulator's requests go through the guarded client (public addresses only, checked at connect time).
export const guardedSend: Send = async (url, init) => {
  const res = await guardedFetch(url, { method: init.method, headers: init.headers, body: init.body, timeoutMs: TIMEOUT_MS });
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  if (res.body) {
    const reader = res.body.getReader();
    while (bytes < MAX_BYTES) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      bytes += value.byteLength;
    }
    await reader.cancel().catch(() => {});
  }
  return { status: res.status, headers: res.headers, text: new TextDecoder().decode(Buffer.concat(chunks).subarray(0, MAX_BYTES)) };
};
