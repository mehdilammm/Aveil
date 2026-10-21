import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const ok = () => new Response(JSON.stringify({ choices: [{ message: { content: "Answer" }, finish_reason: "stop" }], usage: { prompt_tokens: 5, completion_tokens: 7 } }), { status: 200 });
const limited = (retryAfter?: string) => new Response(JSON.stringify({ message: "Rate limit exceeded" }), { status: 429, headers: retryAfter ? { "retry-after": retryAfter } : {} });

describe("Mistral queue and 429", () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    vi.resetModules();
    vi.useFakeTimers();
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
    vi.stubEnv("MISTRAL_API_KEY", "test-key");
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("reads Retry-After in seconds or as a date, 2 s by default, at most 10 s", async () => {
    const { mistralRetryWaitMs } = await import("./mistral");
    expect(mistralRetryWaitMs("3")).toBe(3000);
    expect(mistralRetryWaitMs(null)).toBe(2000);
    expect(mistralRetryWaitMs("120")).toBe(10_000);
    expect(mistralRetryWaitMs(new Date(5_000).toUTCString(), 1_000)).toBe(4000);
  });

  it("waits Retry-After on 429, retries once and records the wait", async () => {
    const { askMistral } = await import("./mistral");
    fetchMock.mockResolvedValueOnce(limited("3")).mockResolvedValueOnce(ok());
    const p = askMistral("q");
    await vi.advanceTimersByTimeAsync(2900);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(200);
    const r = await p;
    expect(r).toMatchObject({ ok: true, text: "Answer", requests: 2 });
    expect(r.waitedMs).toBeGreaterThanOrEqual(3000);
  });

  it("a second 429 is an error that says how long it waited", async () => {
    const { askMistral } = await import("./mistral");
    fetchMock.mockResolvedValueOnce(limited()).mockResolvedValueOnce(limited());
    const p = askMistral("q");
    await vi.advanceTimersByTimeAsync(5000);
    const r = await p;
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.requests).toBe(2);
    expect(r.error).toContain("Mistral API error 429");
    expect(r.error).toContain("after waiting 2.0 s");
  });

  it("runs calls one at a time with at least 1.2 s between them", async () => {
    const { askMistral, MISTRAL_GAP_MS } = await import("./mistral");
    const starts: number[] = [];
    let running = 0;
    let maxRunning = 0;
    fetchMock.mockImplementation(async () => {
      starts.push(Date.now());
      running++;
      maxRunning = Math.max(maxRunning, running);
      await new Promise((r) => setTimeout(r, 100));
      running--;
      return ok();
    });
    const all = Promise.all([askMistral("a"), askMistral("b"), askMistral("c")]);
    await vi.advanceTimersByTimeAsync(10_000);
    const rs = await all;
    expect(rs.every((r) => r.ok)).toBe(true);
    expect(maxRunning).toBe(1);
    expect(starts[1] - starts[0]).toBeGreaterThanOrEqual(MISTRAL_GAP_MS + 100);
    expect(starts[2] - starts[1]).toBeGreaterThanOrEqual(MISTRAL_GAP_MS + 100);
  });
});
