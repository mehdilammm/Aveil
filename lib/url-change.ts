import "server-only";
import { createHmac } from "node:crypto";
import { META_NAME, TOKEN_PREFIX, WELL_KNOWN_PATH } from "./ownership";

// Changing a store's address (owner only): the new address must first prove it is the owner's, with the same
// DNS TXT / meta tag / file methods, before the address changes. The token is derived from the store and the new
// address (no table needed) so it only works for that change.
export function urlChangeToken(storeId: string, newUrl: string, secret = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ""): string {
  if (!secret) throw new Error("server secret missing");
  return createHmac("sha256", `agentscope-url-change:${secret}`).update(`${storeId}|${newUrl}`).digest("hex").slice(0, 32);
}

export function urlChangeInstructions(newUrl: string, token: string) {
  return {
    dns_txt: { host: new URL(newUrl).hostname, value: `${TOKEN_PREFIX}${token}` },
    meta_tag: { html: `<meta name="${META_NAME}" content="${token}">` },
    well_known_file: { url: `${newUrl}${WELL_KNOWN_PATH}`, content: token },
  };
}
