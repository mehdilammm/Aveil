import "server-only";
import { AsyncLocalStorage } from "node:async_hooks";
import { lookup } from "node:dns";
import { isIP } from "node:net";
import { Agent, fetch as undiciFetch, type RequestInit as UndiciRequestInit } from "undici";
import { assertPublicAddresses, isPrivateAddress } from "./url";

// The one way AgentScope fetches a URL it does not control (stores, product pages, the public check, the WooCommerce
// API). The DNS answer is checked when the connection is opened, inside the HTTP client, so a host cannot point to a
// private, loopback or link-local address (169.254.169.254, ::1, fc00::/7, ...) between a check and the connection
// (DNS rebinding). Redirects are followed by the callers one hop at a time, each hop checked again.

const TIMEOUT_MS = 20_000;

type LookupCallback = (err: Error | null, address: string | { address: string; family: number }[], family?: number) => void;

// Connect-time DNS lookup that refuses non-public answers. Exported for tests.
export function safeLookup(hostname: string, options: { all?: boolean } | number | undefined, callback: LookupCallback) {
  lookup(hostname, { all: true }, (err, addresses) => {
    if (err) return callback(err, "", 4);
    const problem = assertPublicAddresses(addresses);
    if (problem) return callback(new Error(`Blocked: ${problem}`), "", 4);
    if (typeof options === "object" && options?.all) return callback(null, addresses);
    callback(null, addresses[0].address, addresses[0].family);
  });
}

export function safeAgent(timeoutMs = TIMEOUT_MS) {
  return new Agent({
    connect: { timeout: timeoutMs, lookup: safeLookup as never },
    headersTimeout: timeoutMs,
    bodyTimeout: timeoutMs,
  });
}

const defaultAgent = safeAgent();

// Refused before any DNS lookup: other schemes, credentials in the URL, private IP literals, internal names.
export function urlProblem(u: URL, allowHttp = false): string | null {
  if (u.protocol !== "https:" && !(allowHttp && u.protocol === "http:")) return allowHttp ? "only http and https are allowed" : "only https is allowed";
  if (u.username || u.password) return "credentials in URL";
  const host = u.hostname.replace(/^\[|\]$/g, "");
  if (isIP(host) && isPrivateAddress(host)) return `${host} is not a public address`;
  if (host === "localhost" || /\.(localhost|local|internal|lan|home\.arpa)$/i.test(host)) return `${host} is not a public host`;
  return null;
}

export class BlockedUrlError extends Error {}

// Counts the outbound requests made inside countRequests(...), e.g. one scan step (per-scan cost log).
const counter = new AsyncLocalStorage<{ requests: number }>();
export async function countRequests<T>(run: () => Promise<T>): Promise<{ result: T; requests: number }> {
  const box = { requests: 0 };
  const result = await counter.run(box, run);
  return { result, requests: box.requests };
}

// One request (no redirect following) through the guarded client. Throws BlockedUrlError for refused targets.
export async function guardedFetch(url: URL, init: Omit<UndiciRequestInit, "dispatcher" | "redirect"> & { timeoutMs?: number } = {}) {
  const problem = urlProblem(url);
  if (problem) throw new BlockedUrlError(problem);
  const { timeoutMs, ...rest } = init;
  const box = counter.getStore();
  if (box) box.requests++;
  try {
    return await undiciFetch(url, { ...rest, dispatcher: defaultAgent, redirect: "manual", signal: rest.signal ?? AbortSignal.timeout(timeoutMs ?? TIMEOUT_MS) });
  } catch (err) {
    const msg = (err as Error & { cause?: Error }).cause?.message ?? (err as Error).message;
    if (msg.startsWith("Blocked:")) throw new BlockedUrlError(msg.slice(9));
    throw err;
  }
}
