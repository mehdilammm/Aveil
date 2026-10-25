import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { csvCell } from "./csv";
import { descriptionsCsv } from "./fixes/description";
import { fakeSupabase } from "./fixtures/fake-supabase";
import { clientIp } from "./public-scan";
import { isReplay, storeLimit } from "./rate-limit";
import { urlChangeInstructions, urlChangeToken } from "./url-change";

describe("client IP", () => {
  it("uses Vercel's x-real-ip first, then x-vercel-forwarded-for, then x-forwarded-for", () => {
    expect(clientIp(new Headers({ "x-real-ip": "203.0.113.7", "x-forwarded-for": "1.2.3.4" }))).toBe("203.0.113.7");
    expect(clientIp(new Headers({ "x-vercel-forwarded-for": "203.0.113.8, 10.0.0.1", "x-forwarded-for": "1.2.3.4" }))).toBe("203.0.113.8");
    expect(clientIp(new Headers({ "x-forwarded-for": "198.51.100.1, 10.0.0.1" }))).toBe("198.51.100.1");
    expect(clientIp(new Headers())).toBe("unknown");
  });
});

describe("per-store limits and ingest replay", () => {
  const counter = () => {
    const seen = new Map<string, number>();
    return fakeSupabase({}, { public_scan_hit: (a) => { const k = String(a.p_ip_hash); seen.set(k, (seen.get(k) ?? 0) + 1); return seen.get(k); } }).client;
  };
  it("the 7th scan of a store within an hour is refused; another store is counted apart", async () => {
    const admin = counter();
    for (let i = 0; i < 6; i++) expect(await storeLimit(admin, "s1", "scan")).toBeNull();
    expect(await storeLimit(admin, "s1", "scan")).toMatch(/at most 6 scans an hour/);
    expect(await storeLimit(admin, "s2", "scan")).toBeNull();
  });
  it("the same signed ingest request twice is a replay; a re-signed one is not", async () => {
    const admin = counter();
    expect(await isReplay(admin, "s1:sha256=aa", 600)).toBe(false);
    expect(await isReplay(admin, "s1:sha256=aa", 600)).toBe(true);
    expect(await isReplay(admin, "s1:sha256=bb", 600)).toBe(false);
  });
  it("a counter error does not block (fails open)", async () => {
    const admin = fakeSupabase({}, { public_scan_hit: () => { throw new Error("db down"); } }).client;
    expect(await storeLimit(admin, "s1", "verify")).toBeNull();
  });
});

describe("CSV formulas", () => {
  it("neutralises formula signs after spaces and cells starting with tab or line break", () => {
    expect(csvCell("  =HYPERLINK(\"x\")")).toBe("\"'  =HYPERLINK(\"\"x\"\")\"");
    expect(csvCell(" +1")).toBe("' +1");
    expect(csvCell("\t@SUM(A1)")).toBe("'\t@SUM(A1)");
    expect(csvCell("Price 10 - 20")).toBe("Price 10 - 20");
    expect(descriptionsCsv([{ productId: 1, html: " =1+1" }])).toBe("ID,Description\r\n1,\"' =1+1\"\r\n");
  });
});

describe("store address change token", () => {
  it("bound to the store and the new address", () => {
    const a = urlChangeToken("s1", "https://new.example", "secret");
    expect(a).toMatch(/^[0-9a-f]{32}$/);
    expect(urlChangeToken("s1", "https://new.example", "secret")).toBe(a);
    expect(urlChangeToken("s2", "https://new.example", "secret")).not.toBe(a);
    expect(urlChangeToken("s1", "https://other.example", "secret")).not.toBe(a);
    expect(urlChangeInstructions("https://new.example", a).dns_txt).toEqual({ host: "new.example", value: `agentscope-verification=${a}` });
  });
});
