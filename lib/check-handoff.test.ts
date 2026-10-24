import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const jar = new Map<string, string>();
vi.mock("next/headers", () => ({ cookies: async () => ({ get: (k: string) => (jar.has(k) ? { value: jar.get(k) } : undefined) }) }));
import { fakeSupabase } from "./fixtures/fake-supabase";
import { addStorePath, afterAuthPath, checkPrefill, HANDOFF_COOKIE, isReportId } from "./check-handoff";

const id = "0b3c6f2e-7a1d-4c55-9a0e-2f1b8c9d7e6a";
const now = Date.parse("2026-10-24T00:00:00Z");
const db = (row: Record<string, unknown>) => fakeSupabase({ public_reports: [{ id, host: "matha.site", status: "complete", report: { platform: { shopify: false } }, expires_at: "2026-11-20T00:00:00Z", ...row }] }).client as never;

describe("/check → full scan handoff", () => {
  it("only a report id goes through, and auth sends the user to the add-store form", async () => {
    expect(isReportId(id)).toBe(true);
    expect(isReportId("../stores")).toBe(false);
    expect(isReportId(`${id}?x=1`)).toBe(false);
    expect(await afterAuthPath()).toBe("/stores");
    jar.set(HANDOFF_COOKIE, "https://evil.example");
    expect(await afterAuthPath()).toBe("/stores");
    jar.set(HANDOFF_COOKIE, id);
    expect(await afterAuthPath()).toBe(addStorePath(id));
    expect(addStorePath(id)).toBe(`/settings?from_check=${id}#add-store`);
  });

  it("prefills from a finished, unexpired WooCommerce check only", async () => {
    expect(await checkPrefill(db({}), id, now)).toEqual({ reportId: id, host: "matha.site", url: "https://matha.site" });
    expect(await checkPrefill(db({ status: "running" }), id, now)).toBeNull();
    expect(await checkPrefill(db({ expires_at: "2026-10-01T00:00:00Z" }), id, now)).toBeNull();
    expect(await checkPrefill(db({ report: { platform: { shopify: true } } }), id, now)).toBeNull();
    expect(await checkPrefill(db({}), "not-an-id", now)).toBeNull();
  });
});
