// Bot protection pages (Cloudflare, Akamai, Sucuri, Imperva, DataDome, or a small error page) answered instead
// of the store. Nothing on such a page says anything about the store, so checks that need the page are unavailable.
import type { PageFetch } from "./woo";

export type Protection = { vendor: string; status: number; title: string | null; bytes: number; reason: string };

const VENDOR_MARKERS: [string, RegExp][] = [
  ["Cloudflare", /attention required!? \| cloudflare|<title>\s*just a moment\.\.\.|cf-chl|challenge-platform|cf_chl_opt|cf-error-details|cloudflare ray id|__cf_chl/i],
  ["Sucuri", /sucuri website firewall|sucuri\.net\/privacy|access denied - sucuri/i],
  ["Imperva", /_incapsula_resource|incapsula incident id|request unsuccessful\. incapsula/i],
  ["DataDome", /captcha-delivery\.com|datadome/i],
  ["Akamai", /errors\.edgesuite\.net|akamai.{0,40}reference\s*#|<title>\s*access denied\s*<\/title>[\s\S]{0,2000}reference\s*#/i],
];

const BLOCK_STATUS = new Set([401, 403, 406, 429, 503]);
const SMALL_PAGE_BYTES = 20 * 1024;

function title(body: string): string | null {
  const t = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(body)?.[1].replace(/\s+/g, " ").trim();
  return t ? t.slice(0, 120) : null;
}

export function detectProtection(f: PageFetch | null): Protection | null {
  if (!f || !f.ok || f.redirectedTo) return null;
  const marker = VENDOR_MARKERS.find(([, re]) => re.test(f.body))?.[0] ?? null;
  const blockedStatus = BLOCK_STATUS.has(f.status);
  const smallHtml = f.bytes < SMALL_PAGE_BYTES && /<html|<!doctype/i.test(f.body);
  // A vendor marker in the page, a challenge header, or a block status with a small page (vendor from headers if known).
  const vendor = marker ?? (f.challengeHeader ? f.vendorHint ?? "Cloudflare" : blockedStatus && smallHtml ? f.vendorHint ?? null : null);
  if (!vendor && !(blockedStatus && smallHtml)) return null;
  const t = title(f.body);
  const name = vendor ?? "unknown service";
  return {
    vendor: name,
    status: f.status,
    title: t,
    bytes: f.bytes,
    reason: `bot protection (${name}) answered instead of the store: HTTP ${f.status}${t ? `, title "${t}"` : ""}, ${Math.max(1, Math.round(f.bytes / 1024))} KB`,
  };
}

// Titles of error and protection pages, never usable as a description of what a store sells.
export const ERROR_TITLE_RE = /attention required|just a moment|access denied|forbidden|not found|\b40[134]\b|\b50[0-4]\b|error|blocked|captcha|security check|verify you are human|unavailable|maintenance|coming soon/i;
