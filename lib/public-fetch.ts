import "server-only";
import { lookup } from "node:dns";
import { isIP } from "node:net";
import { Agent, fetch as undiciFetch } from "undici";
import { CHECK_HEADER, LIMITS } from "./public-scan";
import { assertPublicAddresses, isPrivateAddress } from "./url";
import { shopifyFromHeaders, vendorFromHeaders, type PageFetch } from "./woo";

// DNS check at connect time, so a host cannot switch to a private address between our check and the connection.
const agent = new Agent({
  connect: {
    timeout: LIMITS.timeoutMs,
    lookup(hostname, options, callback) {
      lookup(hostname, { all: true }, (err, addresses) => {
        if (err) return callback(err, "", 4);
        const problem = assertPublicAddresses(addresses);
        if (problem) return callback(new Error(`Blocked: ${problem}`), "", 4);
        if ((options as { all?: boolean }).all) return (callback as unknown as (e: null, a: typeof addresses) => void)(null, addresses);
        callback(null, addresses[0].address, addresses[0].family);
      });
    },
  },
  headersTimeout: LIMITS.timeoutMs,
  bodyTimeout: LIMITS.timeoutMs,
});

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function hostAllowed(u: URL): string | null {
  if (u.protocol !== "https:") return "only https is allowed";
  if (u.username || u.password) return "credentials in URL";
  const host = u.hostname.replace(/^\[|\]$/g, "");
  if (isIP(host) && isPrivateAddress(host)) return `${host} is not a public address`;
  if (host === "localhost" || /\.(localhost|local|internal|lan|home\.arpa)$/i.test(host)) return `${host} is not a public host`;
  return null;
}

// One scan's HTTP client: at most LIMITS.httpRequests requests (redirect hops count), 1.5 s apart,
// 10 s timeout, 2 MB per answer, https only, every redirect re-checked (max 3).
export class PublicFetcher {
  requests = 0;
  private last = 0;

  get remaining() {
    return LIMITS.httpRequests - this.requests;
  }

  async get(target: string, userAgent: string): Promise<PageFetch> {
    let current: URL;
    try {
      current = new URL(target);
    } catch {
      return { ok: false, error: "invalid URL" };
    }
    for (let hop = 0; hop <= LIMITS.redirects; hop++) {
      const problem = hostAllowed(current);
      if (problem) return { ok: false, error: problem };
      if (this.requests >= LIMITS.httpRequests) return { ok: false, error: "request budget for this check is used up" };
      const wait = this.last + LIMITS.gapMs - Date.now();
      if (this.last && wait > 0) await sleep(wait);
      this.requests++;
      this.last = Date.now();
      try {
        const res = await undiciFetch(current, {
          dispatcher: agent,
          redirect: "manual",
          headers: { "User-Agent": userAgent, Accept: "text/html,application/xhtml+xml,text/plain,application/xml;q=0.9,*/*;q=0.8", [CHECK_HEADER]: "1" },
          signal: AbortSignal.timeout(LIMITS.timeoutMs),
        });
        const location = res.headers.get("location");
        if (res.status >= 300 && res.status < 400 && location) {
          await res.body?.cancel().catch(() => {});
          current = new URL(location, current);
          continue;
        }
        const chunks: Uint8Array[] = [];
        let bytes = 0;
        if (res.body) {
          const reader = res.body.getReader();
          while (bytes < LIMITS.maxBytes) {
            const { done, value } = await reader.read();
            if (done) break;
            chunks.push(value);
            bytes += value.byteLength;
          }
          await reader.cancel().catch(() => {});
        }
        return {
          ok: true,
          status: res.status,
          finalUrl: current.toString(),
          redirectedTo: null,
          bytes,
          body: new TextDecoder().decode(Buffer.concat(chunks).subarray(0, LIMITS.maxBytes)),
          challengeHeader: (res.headers.get("cf-mitigated") ?? "").toLowerCase() === "challenge",
          retryAfter: res.headers.get("retry-after"),
          vendorHint: vendorFromHeaders(res.headers),
          shopifyHeader: shopifyFromHeaders(res.headers),
        };
      } catch (err) {
        const e = err as Error & { cause?: Error };
        if (e.name === "TimeoutError" || e.name === "AbortError") return { ok: false, error: "no answer within 10 seconds" };
        const msg = e.cause?.message ?? e.message;
        return { ok: false, error: msg.startsWith("Blocked:") ? msg.slice(9) : "request failed" };
      }
    }
    return { ok: false, error: "too many redirects" };
  }
}
