import { describe, expect, it, vi } from "vitest";
vi.mock("@supabase/ssr", () => ({ createServerClient: () => ({}) }));
const { crossSiteWrite } = await import("../proxy");

const req = (method: string, path: string, headers: Record<string, string> = {}) => ({ method, headers: new Headers(headers), nextUrl: new URL(`https://agentscope-peach.vercel.app${path}`) }) as never;

describe("cross-site writes to the API are refused (audit run 2 hardening)", () => {
  it("refuses a POST from another site", () => {
    expect(crossSiteWrite(req("POST", "/api/stores/x/scan", { origin: "https://evil.example" }))).toBe(true);
    expect(crossSiteWrite(req("POST", "/api/stores/x/scan", { "sec-fetch-site": "cross-site" }))).toBe(true);
  });
  it("allows our own pages, server-to-server callers and reads", () => {
    expect(crossSiteWrite(req("POST", "/api/stores/x/scan", { origin: "https://agentscope-peach.vercel.app", "sec-fetch-site": "same-origin" }))).toBe(false);
    expect(crossSiteWrite(req("POST", "/api/ingest/traffic"))).toBe(false); // the plugin: no Origin
    expect(crossSiteWrite(req("GET", "/api/plugin/latest", { origin: "https://evil.example" }))).toBe(false);
    expect(crossSiteWrite(req("POST", "/login", { origin: "https://evil.example" }))).toBe(false); // pages: Next.js checks server actions
  });
});
