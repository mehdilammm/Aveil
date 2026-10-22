// Ownership verification without platform access: a DNS TXT record, a <meta> tag on the home page, or a file at
// /.well-known/agentscope-verification.txt, each carrying the store's token. The WooCommerce API key is the other
// method (see lib/platform/woocommerce.ts). Pure parsing here; network calls are passed in.
import { randomBytes } from "node:crypto";
import type { OwnershipMethod } from "./platform/adapter";

export const TOKEN_PREFIX = "agentscope-verification=";
export const META_NAME = "agentscope-verification";
export const WELL_KNOWN_PATH = "/.well-known/agentscope-verification.txt";
export const VERIFICATION_DAYS = 90; // re-checked after this
export type ManualMethod = Extract<OwnershipMethod, "dns_txt" | "meta_tag" | "well_known_file">;
export const MANUAL_METHODS: ManualMethod[] = ["dns_txt", "meta_tag", "well_known_file"];

export function newVerificationToken(): string {
  return randomBytes(16).toString("hex");
}

export const isToken = (t: string) => /^[0-9a-f]{32}$/.test(t);

// TXT answers come as arrays of chunks per record.
export function txtHasToken(records: string[][], token: string): boolean {
  return records.some((chunks) => chunks.join("").trim() === `${TOKEN_PREFIX}${token}`);
}

// <meta name="agentscope-verification" content="..."> in either attribute order, in the page's <head>.
export function metaHasToken(html: string, token: string): boolean {
  const head = html.slice(0, Math.max(0, html.search(/<\/head>/i)) || 200_000);
  for (const tag of head.match(/<meta\b[^>]*>/gi) ?? []) {
    const name = /\bname\s*=\s*["']([^"']*)["']/i.exec(tag)?.[1];
    const content = /\bcontent\s*=\s*["']([^"']*)["']/i.exec(tag)?.[1];
    if (name?.toLowerCase() === META_NAME && content?.trim() === token) return true;
  }
  return false;
}

export function fileHasToken(body: string, token: string): boolean {
  return body.split(/\r?\n/).some((line) => line.trim() === token || line.trim() === `${TOKEN_PREFIX}${token}`);
}

export type Fetched = { ok: true; status: number; body: string; redirectedTo: string | null } | { ok: false; error: string };
export type OwnershipDeps = {
  resolveTxt: (host: string) => Promise<string[][]>;
  fetchPage: (url: string) => Promise<Fetched>;
};

export async function checkManual(storeUrl: string, method: ManualMethod, token: string, deps: OwnershipDeps): Promise<{ verified: boolean; evidence: string }> {
  const host = new URL(storeUrl).hostname;
  if (method === "dns_txt") {
    try {
      const records = await deps.resolveTxt(host);
      return txtHasToken(records, token)
        ? { verified: true, evidence: `DNS TXT record "${TOKEN_PREFIX}…" found on ${host}.` }
        : { verified: false, evidence: `No TXT record "${TOKEN_PREFIX}${token}" on ${host} (${records.length} TXT records seen). DNS changes can take up to an hour.` };
    } catch (err) {
      const code = (err as { code?: string }).code;
      return { verified: false, evidence: `DNS lookup for ${host} failed${code ? ` (${code})` : ""}.` };
    }
  }
  const url = method === "meta_tag" ? `${storeUrl}/` : `${storeUrl}${WELL_KNOWN_PATH}`;
  const res = await deps.fetchPage(url);
  if (!res.ok) return { verified: false, evidence: `${url} could not be loaded: ${res.error}.` };
  if (res.redirectedTo) return { verified: false, evidence: `${url} redirects to ${res.redirectedTo}; the token must be on ${host} itself.` };
  if (res.status !== 200) return { verified: false, evidence: `${url} answered HTTP ${res.status}.` };
  const found = method === "meta_tag" ? metaHasToken(res.body, token) : fileHasToken(res.body, token);
  return found
    ? { verified: true, evidence: method === "meta_tag" ? `The home page has the ${META_NAME} meta tag.` : `${WELL_KNOWN_PATH} contains the token.` }
    : { verified: false, evidence: method === "meta_tag" ? `The home page has no <meta name="${META_NAME}" content="${token}"> in its head. A cached page can take a while to update.` : `${WELL_KNOWN_PATH} does not contain the token.` };
}

export const isCurrent = (row: { verified_at: string | null; expires_at: string | null } | null, now = Date.now()) =>
  Boolean(row?.verified_at && row.expires_at && Date.parse(row.expires_at) > now);
