// Bot protection pages (Cloudflare, Akamai, Sucuri, Imperva, DataDome, or a small error page) answered instead
// of the store. Nothing on such a page says anything about the store, so checks that need the page are unavailable.
//
// Not protection: a normal 200 page served through a CDN. Cloudflare adds a cf-ray header and a
// /cdn-cgi/challenge-platform/... script to ordinary pages too, so those alone never mean "blocked".
import type { PageFetch } from "./woo";

export type Protection = { vendor: string; status: number; title: string | null; bytes: number; reason: string };

const BLOCK_STATUS = new Set([401, 403, 429, 503]);
const SMALL_PAGE_BYTES = 20 * 1024;

// Titles of challenge and block pages.
const CHALLENGE_TITLE_RE =
  /^(just a moment\.{0,3}|attention required!?(\s*\|\s*cloudflare)?|access denied|please wait\.{0,3}|checking your browser.*|one moment, please.*|ddos-guard|security check.*|verify you are human.*|request unsuccessful.*|sucuri website firewall.*|you have been blocked|sorry, you have been blocked)$/i;

// Markers that only appear on challenge / block pages (never on a normal page), checked on small pages only.
const CHALLENGE_MARKERS: [string, RegExp][] = [
  ["Cloudflare", /cf-chl-bypass|cf_chl_opt|__cf_chl_|cf-error-details|checking your browser before accessing|enable javascript and cookies to continue/i],
  ["Sucuri", /sucuri website firewall|access denied - sucuri/i],
  ["Imperva", /_incapsula_resource|incapsula incident id/i],
  ["DataDome", /captcha-delivery\.com/i],
  ["Akamai", /errors\.edgesuite\.net|reference\s*#\s*\d+\.[0-9a-f]+/i],
];

// A 503 that is a maintenance page is the store's own placeholder, handled as maintenance, not as protection.
const MAINTENANCE_RE = /briefly unavailable for scheduled maintenance|maintenance mode|under maintenance/i;

function title(body: string): string | null {
  const t = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(body)?.[1].replace(/\s+/g, " ").trim();
  return t ? t.slice(0, 120) : null;
}

export function detectProtection(f: PageFetch | null): Protection | null {
  if (!f || !f.ok || f.redirectedTo) return null;
  const t = title(f.body);
  const small = f.bytes < SMALL_PAGE_BYTES;
  const marker = small ? (CHALLENGE_MARKERS.find(([, re]) => re.test(f.body))?.[0] ?? null) : null;
  const challengeTitle = t !== null && CHALLENGE_TITLE_RE.test(t);
  const blockedStatus = BLOCK_STATUS.has(f.status) && !(f.status === 503 && MAINTENANCE_RE.test(f.body));

  // cf-mitigated: challenge is only sent on challenge answers.
  if (!(blockedStatus || challengeTitle || marker || f.challengeHeader)) return null;
  const vendor = marker ?? (t && /cloudflare|^just a moment|^attention required/i.test(t) ? "Cloudflare" : null) ?? f.vendorHint ?? (f.challengeHeader ? "Cloudflare" : null) ?? "unknown service";
  return {
    vendor,
    status: f.status,
    title: t,
    bytes: f.bytes,
    reason: `bot protection (${vendor}) answered instead of the store: HTTP ${f.status}${t ? `, title "${t}"` : ""}, ${Math.max(1, Math.round(f.bytes / 1024))} KB`,
  };
}

// "served via Cloudflare" (information only) for a normal page behind a CDN or firewall service.
export function servedVia(f: PageFetch | null): string | null {
  return f && f.ok && !detectProtection(f) ? (f.vendorHint ?? null) : null;
}

// Titles of error and protection pages, never usable as a description of what a store sells.
export const ERROR_TITLE_RE = /attention required|just a moment|access denied|forbidden|not found|\b40[134]\b|\b50[0-4]\b|error|blocked|captcha|security check|verify you are human|unavailable|maintenance|coming soon/i;
