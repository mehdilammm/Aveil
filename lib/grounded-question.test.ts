import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const askGemini = vi.fn();
vi.mock("./gemini", () => ({ askGemini: (...a: unknown[]) => askGemini(...a), GEMINI_MODEL: "gemini-3.5-flash-lite" }));

const ok = (text: string, extra: object = {}) => ({ ok: true, text, finishReason: "STOP", inputTokens: 1, outputTokens: 2, blocked: null, requests: 1, ...extra });
const sources = { queries: ["q"], sources: [{ title: "etsy.com", domain: "etsy.com", uri: "u" }], supports: [], entryPoint: null };

function fakeAdmin(reserve: boolean) {
  const calls: { fn: string; args: unknown }[] = [];
  return { calls, admin: { rpc: async (fn: string, args: unknown) => (calls.push({ fn, args }), { data: fn === "grounding_reserve_capped" ? reserve : null, error: null }) } as never };
}

describe("visibility question with grounding", () => {
  beforeEach(() => {
    vi.resetModules();
    askGemini.mockReset();
    vi.stubEnv("GEMINI_GROUNDING_ENABLED", "true");
  });
  afterEach(() => vi.unstubAllEnvs());

  it("off: plain question on the default model, no reservation", async () => {
    vi.stubEnv("GEMINI_GROUNDING_ENABLED", "");
    const { askVisibilityQuestion } = await import("./grounded-question");
    const { admin, calls } = fakeAdmin(true);
    askGemini.mockResolvedValueOnce(ok("answer"));
    const q = await askVisibilityQuestion(admin, "best tea shop?");
    expect(askGemini).toHaveBeenCalledWith("best tea shop?");
    expect(calls).toEqual([]);
    expect(q).toMatchObject({ citations: { unavailable: "grounding skipped: flag off (GEMINI_GROUNDING_ENABLED is set but empty)" }, grounded: false, attempted: false });
  });

  it("flag not set, or a value that is not true: skipped with the exact reason", async () => {
    vi.stubEnv("GEMINI_GROUNDING_ENABLED", "false");
    const { askVisibilityQuestion } = await import("./grounded-question");
    askGemini.mockResolvedValue(ok("answer"));
    const q = await askVisibilityQuestion(fakeAdmin(true).admin, "q");
    expect(q.citations).toEqual({ unavailable: 'grounding skipped: flag off (GEMINI_GROUNDING_ENABLED is "false" (not true))' });
  });

  it("flag values with quotes or 1/yes/on count as on", async () => {
    const { groundingFlag } = await import("./grounding");
    for (const v of ["true", " TRUE ", '"true"', "'true'", "1", "yes", "on"]) expect(groundingFlag(v).enabled).toBe(true);
    for (const v of ["false", "0", "", "tru"]) expect(groundingFlag(v).enabled).toBe(false);
    vi.stubEnv("GEMINI_GROUNDING_ENABLED", undefined);
    expect(groundingFlag()).toEqual({ enabled: false, read: "not set on the server" });
  });

  it("on: grounding model with google_search and both caps (50/day, 1000/month)", async () => {
    vi.stubEnv("GEMINI_GROUNDING_MODEL", "gemini-test-flash");
    const { askVisibilityQuestion } = await import("./grounded-question");
    const { admin, calls } = fakeAdmin(true);
    askGemini.mockResolvedValueOnce(ok("Try Etsy.", { grounding: sources }));
    const q = await askVisibilityQuestion(admin, "q");
    expect(calls[0]).toEqual({ fn: "grounding_reserve_capped", args: { p_month_limit: 1000, p_day_limit: 50 } });
    expect(askGemini).toHaveBeenCalledWith("q", { grounding: true, model: "gemini-test-flash" });
    expect(q).toMatchObject({ grounded: true, attempted: true, citations: sources });
  });

  it("Google refuses grounding (free tier 400): reason kept word for word, question asked again without grounding", async () => {
    const { askVisibilityQuestion } = await import("./grounded-question");
    const { admin } = fakeAdmin(true);
    const refusal = "Gemini API error 400: Search Grounding is not supported for this model on the free tier.";
    askGemini.mockResolvedValueOnce({ ok: false, error: refusal, requests: 1 }).mockResolvedValueOnce(ok("Plain answer"));
    const q = await askVisibilityQuestion(admin, "q");
    expect(askGemini.mock.calls[1]).toEqual(["q"]);
    expect(q.result).toMatchObject({ ok: true, text: "Plain answer", requests: 2 });
    expect(q.grounded).toBe(false);
    expect(q.citations).toEqual({ unavailable: `Google Search grounding failed on gemini-2.5-flash: ${refusal}. Asked again without grounding.` });
  });

  it("429 and 403 are handled the same way", async () => {
    const { askVisibilityQuestion } = await import("./grounded-question");
    for (const error of ["Gemini API error 429: Resource has been exhausted", "Gemini API error 403: Permission denied"]) {
      askGemini.mockReset();
      askGemini.mockResolvedValueOnce({ ok: false, error, requests: 2 }).mockResolvedValueOnce(ok("A"));
      const { admin, calls } = fakeAdmin(true);
      const q = await askVisibilityQuestion(admin, "q");
      expect(q.result.ok && q.result.text).toBe("A");
      expect(q.citations && "unavailable" in q.citations && q.citations.unavailable).toContain(error);
      expect(calls.some((c) => c.fn === "grounding_record")).toBe(true); // the retry is counted
    }
  });

  it("cap reached: no grounded request, the reason is shown", async () => {
    const { askVisibilityQuestion } = await import("./grounded-question");
    const { admin } = fakeAdmin(false);
    askGemini.mockResolvedValueOnce(ok("A"));
    const q = await askVisibilityQuestion(admin, "q");
    expect(askGemini).toHaveBeenCalledTimes(1);
    expect(askGemini).toHaveBeenCalledWith("q");
    expect(q.citations).toEqual({ unavailable: "grounding skipped: limit reached (50 per day, 1000 per month for the app); asked without Google Search" });
  });

  it("grounded answer without sources is UNAVAILABLE, not an empty citation list", async () => {
    const { askVisibilityQuestion } = await import("./grounded-question");
    const { admin } = fakeAdmin(true);
    askGemini.mockResolvedValueOnce(ok("A", { grounding: null }));
    const q = await askVisibilityQuestion(admin, "q");
    expect(q.grounded).toBe(false);
    expect(q.citations).toEqual({ unavailable: "gemini-2.5-flash answered with Google Search on, but returned no sources." });
  });
});
