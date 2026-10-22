import "server-only";
import { fetch as undiciFetch } from "undici";
import { safeAgent, urlProblem } from "./safe-fetch";
import { checkHeaderValue } from "./check-header";
import { applyCanonical, CHECK_HEADER, learnCanonical, LIMITS, NOT_CHECKED, type RequestLogEntry } from "./public-scan";
import { shopifyFromHeaders, vendorFromHeaders, type PageFetch } from "./woo";

// Connect-time DNS check (see safe-fetch.ts).
const agent = safeAgent(LIMITS.timeoutMs);

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const hostAllowed = (u: URL) => urlProblem(u);

// One scan's HTTP client: at most LIMITS.httpRequests requests (redirect hops count), 1.5 s apart,
// 10 s timeout, 2 MB per answer, https only, every redirect re-checked (max 3).
export class PublicFetcher {
  requests = 0;
  log: RequestLogEntry[] = [];
  private last = 0;
  private canonical: { from: string; to: string } | null = null;

  // checkToken: the store's traffic connection token, when AgentScope knows the store, to sign X-AgentScope-Check.
  constructor(private readonly gapMs: number = LIMITS.gapMs, private readonly checkToken: string | null = null) {}

  get remaining() {
    return LIMITS.httpRequests - this.requests;
  }

  // The host to build later URLs with, after a same-site redirect (example.com → www.example.com).
  url(path: string, origin: string): string {
    return applyCanonical(`${origin}${path}`, this.canonical);
  }

  // step: what this request is for, shown in the report's request list.
  async get(target: string, userAgent: string, step: string): Promise<PageFetch> {
    const result = await this.fetchOne(applyCanonical(target, this.canonical), userAgent);
    if (result.ok && !this.canonical) this.canonical = learnCanonical(target, result.finalUrl);
    this.log.push({ step, outcome: result.ok ? `HTTP ${result.status}${result.redirectedTo ? `, redirect to ${result.redirectedTo}` : ""}` : result.error });
    return result;
  }

  private async fetchOne(target: string, userAgent: string): Promise<PageFetch> {
    let current: URL;
    try {
      current = new URL(target);
    } catch {
      return { ok: false, error: "invalid URL" };
    }
    for (let hop = 0; hop <= LIMITS.redirects; hop++) {
      const problem = hostAllowed(current);
      if (problem) return { ok: false, error: problem };
      if (this.requests >= LIMITS.httpRequests) return { ok: false, error: NOT_CHECKED, skipped: true };
      const wait = this.last + this.gapMs - Date.now();
      if (this.last && wait > 0) await sleep(wait);
      this.requests++;
      this.last = Date.now();
      try {
        const res = await undiciFetch(current, {
          dispatcher: agent,
          redirect: "manual",
          headers: { "User-Agent": userAgent, Accept: "text/html,application/xhtml+xml,text/plain,application/xml;q=0.9,*/*;q=0.8", [CHECK_HEADER]: checkHeaderValue(this.checkToken) },
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
