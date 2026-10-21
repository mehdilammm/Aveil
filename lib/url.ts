import { isIP } from "node:net";

// Store URLs are user input that the server fetches, so block local and private targets.

export function isPrivateAddress(ip: string): boolean {
  const v = isIP(ip);
  if (v === 4) {
    const [a, b] = ip.split(".").map(Number);
    return (
      a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || a >= 224
    );
  }
  if (v === 6) {
    const s = ip.toLowerCase();
    if (s.startsWith("::ffff:")) return isPrivateAddress(s.slice(7)) || isIP(s.slice(7)) === 0;
    return s === "::" || s === "::1" || s.startsWith("fc") || s.startsWith("fd") || s.startsWith("fe8") ||
      s.startsWith("fe9") || s.startsWith("fea") || s.startsWith("feb") || s.startsWith("ff");
  }
  return false;
}

const BLOCKED_SUFFIXES = [".localhost", ".local", ".internal", ".lan", ".home.arpa"];

// Returns the normalized store base URL (no query, hash or trailing slash), or an error message.
export function normalizeStoreUrl(input: string): { url: string } | { error: string } {
  let u: URL;
  try {
    u = new URL(input.trim());
  } catch {
    return { error: "Enter a full URL, for example https://shop.example.com" };
  }
  if (u.protocol !== "https:") return { error: "The store URL must start with https://" };
  if (u.username || u.password) return { error: "The URL must not contain a user name or password" };

  const host = u.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (host === "localhost" || BLOCKED_SUFFIXES.some((s) => host.endsWith(s)) || isPrivateAddress(host)) {
    return { error: "This address is not reachable from the internet" };
  }
  if (isIP(host) === 0 && !host.includes(".")) return { error: "Enter a public domain name" };

  const path = u.pathname.replace(/\/+$/, "");
  return { url: `${u.protocol}//${u.host}${path}` };
}

// DNS answers for a host we are about to connect to: refuse if any address is private, loopback, link-local
// (cloud metadata 169.254.169.254) or otherwise not public. Checked again at connect time and on every redirect.
export function assertPublicAddresses(addresses: { address: string }[]): string | null {
  if (!addresses.length) return "no address";
  const bad = addresses.find((a) => isPrivateAddress(a.address) || isIP(a.address) === 0);
  return bad ? `${bad.address} is not a public address` : null;
}
