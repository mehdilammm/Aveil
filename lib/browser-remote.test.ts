import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
let verified = true;
vi.mock("./ownership-store", () => ({ isOwnershipVerified: async () => verified }));
const { runBrowserRemote } = await import("./browser-remote");
const { BrowserUnavailableError } = await import("./browser-sim");
const { NotVerifiedError } = await import("./agent-sim-run");
const { verifyRunnerRequest, parseRunnerPayload, TIMESTAMP_HEADER, SIGNATURE_HEADER } = await import("./browser-signing");

const SECRET = "r".repeat(48);
const admin = { rpc: () => ({ maybeSingle: async () => ({ data: { token: "store-plugin-token" } }) }) } as never;
const store = { id: "s1", url: "https://shop.example" };
const reply = (status: number, body: unknown) => vi.fn(async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;
const calls = (f: typeof fetch) => (f as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls;

describe("browser test through the separate runner", () => {
  beforeEach(() => { process.env.BROWSER_RUNNER_URL = "https://runner.example/"; process.env.BROWSER_RUNNER_SECRET = SECRET; verified = true; });
  afterEach(() => { delete process.env.BROWSER_RUNNER_URL; delete process.env.BROWSER_RUNNER_SECRET; });

  it("signs the request; the runner gets a signed check value, never the store token", async () => {
    const f = reply(200, { result: { stoppedAt: null } });
    await expect(runBrowserRemote(admin, store, "job-1", f)).resolves.toEqual({ stoppedAt: null });
    const [url, init] = calls(f)[0];
    expect(url).toBe("https://runner.example/api/run");
    const headers = init.headers as Record<string, string>;
    expect(verifyRunnerRequest(SECRET, headers[TIMESTAMP_HEADER], headers[SIGNATURE_HEADER], String(init.body))).toBe(true);
    expect(String(init.body)).not.toContain("store-plugin-token");
    expect(parseRunnerPayload(String(init.body))).toMatchObject({ storeUrl: "https://shop.example", jobId: "job-1" });
    expect(parseRunnerPayload(String(init.body))!.checkValue).toMatch(/^v1\.\d+\.[0-9a-f]+$/);
  });

  it("no runner configured, or the runner has no browser: the job waits", async () => {
    await expect(runBrowserRemote(admin, store, "j", reply(503, { error: "no chromium" }))).rejects.toBeInstanceOf(BrowserUnavailableError);
    delete process.env.BROWSER_RUNNER_SECRET;
    await expect(runBrowserRemote(admin, store, "j", reply(200, {}))).rejects.toBeInstanceOf(BrowserUnavailableError);
  });

  it("ownership is checked in the app before anything is sent", async () => {
    verified = false;
    const f = reply(200, {});
    await expect(runBrowserRemote(admin, store, "j", f)).rejects.toBeInstanceOf(NotVerifiedError);
    expect(calls(f)).toHaveLength(0);
  });
});

describe("runner request signature", () => {
  const body = JSON.stringify({ storeUrl: "https://a.example", checkValue: "1", jobId: "j", nonce: "n" });
  const now = 1_800_000_000;
  it("accepts a fresh signature and refuses a changed body, an old timestamp, a short secret", async () => {
    const { signRunnerRequest } = await import("./browser-signing");
    const h = signRunnerRequest(SECRET, body, now);
    expect(verifyRunnerRequest(SECRET, h[TIMESTAMP_HEADER], h[SIGNATURE_HEADER], body, now + 10)).toBe(true);
    expect(verifyRunnerRequest(SECRET, h[TIMESTAMP_HEADER], h[SIGNATURE_HEADER], body.replace("a.example", "b.example"), now)).toBe(false);
    expect(verifyRunnerRequest(SECRET, h[TIMESTAMP_HEADER], h[SIGNATURE_HEADER], body, now + 400)).toBe(false);
    expect(verifyRunnerRequest("short", h[TIMESTAMP_HEADER], h[SIGNATURE_HEADER], body, now)).toBe(false);
  });
  it("payload: https only, origin kept", () => {
    expect(parseRunnerPayload(JSON.stringify({ storeUrl: "http://a.example", checkValue: "1", jobId: "j", nonce: "n" }))).toBeNull();
    expect(parseRunnerPayload(JSON.stringify({ storeUrl: "https://a.example/shop?x=1", checkValue: "1", jobId: "j", nonce: "n" }))!.storeUrl).toBe("https://a.example");
  });
});
