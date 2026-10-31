// Content-Security-Policy with a per-request nonce (set by proxy.ts; Next.js reads the nonce from the request's CSP
// header and puts it on its own scripts). No external script, no framing of our pages, forms only to ourselves.
// Inline style attributes are used across the UI, so styles allow 'unsafe-inline'; scripts never do.
export function contentSecurityPolicy(nonce: string, dev = process.env.NODE_ENV === "development"): string {
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${dev ? " 'unsafe-eval'" : ""}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: https:",
    "font-src 'self' data:",
    `connect-src 'self'${dev ? " ws:" : ""}`,
    "frame-src 'self'",
    "frame-ancestors 'none'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "upgrade-insecure-requests",
  ].join("; ");
}

// Enforced; set to false to send Content-Security-Policy-Report-Only instead (for trying a change first).
export const CSP_ENFORCE = false;
export const cspHeaderName = () => (CSP_ENFORCE ? "Content-Security-Policy" : "Content-Security-Policy-Report-Only");

// The rest of the security headers, the same on every response (next.config.ts).
export const STATIC_SECURITY_HEADERS = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
];

// Supabase session cookie: HTTPS only, not readable by page scripts (the app has no browser-side Supabase client;
// every auth call runs on the server), Lax, and 7 days, renewed on each visit that refreshes the session.
export const SESSION_COOKIE = { secure: true, httpOnly: true, sameSite: "lax" as const, path: "/", maxAge: 7 * 24 * 60 * 60 };
