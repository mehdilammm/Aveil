import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const { runBrowserRemote } = await import("./browser-remote");
const { BrowserUnavailableError } = await import("./browser-sim");
const { NotVerifiedError } = await import("./agent-sim-run");

const reply = (status: number, body: unknown) => vi.fn(async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;

describe("browser test in its own function", () => {
  beforeEach(() => { process.env.CRON_SECRET = "s".repeat(40); });
  afterEach(() => { delete process.env.CRON_SECRET; });

  it("calls /api/jobs/browser with the job id and the secret, and returns the result", async () => {
    const f = reply(200, { result: { stoppedAt: null } });
    await expect(runBrowserRemote("job-1", f)).resolves.toEqual({ stoppedAt: null });
    const [url, init] = (f as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls[0];
    expect(url).toMatch(/\/api\/jobs\/browser$/);
    expect(JSON.parse(String(init.body))).toEqual({ jobId: "job-1" });
    expect((init.headers as Record<string, string>).authorization).toBe(`Bearer ${"s".repeat(40)}`);
  });

  it("no browser there (503) or no secret: the job waits", async () => {
    await expect(runBrowserRemote("j", reply(503, { error: "no chromium" }))).rejects.toBeInstanceOf(BrowserUnavailableError);
    delete process.env.CRON_SECRET;
    await expect(runBrowserRemote("j", reply(200, {}))).rejects.toBeInstanceOf(BrowserUnavailableError);
  });

  it("store not verified stays a permanent stop", async () => {
    await expect(runBrowserRemote("j", reply(409, { error: "not verified", notVerified: true }))).rejects.toBeInstanceOf(NotVerifiedError);
  });
});
