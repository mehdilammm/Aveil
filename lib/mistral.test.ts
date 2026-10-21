import { beforeEach, describe, expect, it, vi } from "vitest";
import { EXTRACTION_JSON_SCHEMA, parseMistralResponse } from "./visibility";

vi.mock("server-only", () => ({}));

const answer = (text: string) => ({ ok: true as const, text, finishReason: "stop", inputTokens: 10, outputTokens: 20, blocked: null, requests: 1 });
const extraction = JSON.stringify({ brands: [{ name: "Etsy", type: "marketplace", url_if_present: null }, { name: "SGS", type: "service", url_if_present: null }], store_mentioned: false, rank_if_listed: null });

const askGemini = vi.fn();
const askMistral = vi.fn();
let mistralKey = true;
vi.mock("./gemini", () => ({ askGemini: (...a: unknown[]) => askGemini(...a), geminiConfigured: () => true, GEMINI_MODEL: "gemini-test" }));
vi.mock("./mistral", () => ({ askMistral: (...a: unknown[]) => askMistral(...a), mistralConfigured: () => mistralKey, MISTRAL_MODEL: "mistral-test" }));

describe("parseMistralResponse", () => {
  it("reads text content, text chunks and token usage", () => {
    expect(parseMistralResponse({ choices: [{ message: { content: " Hello " }, finish_reason: "stop" }], usage: { prompt_tokens: 12, completion_tokens: 30 } })).toEqual({
      text: "Hello", finishReason: "stop", inputTokens: 12, outputTokens: 30, blocked: null,
    });
    expect(parseMistralResponse({ choices: [{ message: { content: [{ type: "thinking", text: "x" }, { type: "text", text: "A" }, { type: "text", text: "B" }] } }] }).text).toBe("AB");
    expect(parseMistralResponse({}).text).toBe("");
  });

  it("uses a standard JSON Schema for Mistral's json_schema mode", () => {
    expect(EXTRACTION_JSON_SCHEMA.type).toBe("object");
    expect(EXTRACTION_JSON_SCHEMA.properties.brands.items.properties.type.enum).toEqual(["store", "marketplace", "brand", "service", "other"]);
    expect(EXTRACTION_JSON_SCHEMA.additionalProperties).toBe(false);
  });
});

describe("extractNames", () => {
  beforeEach(() => {
    askGemini.mockReset();
    askMistral.mockReset();
    mistralKey = true;
  });
  const terms = { names: ["Matha"], host: "matha.site", keys: ["matha"] };

  it("Mistral extracts its own answer when json_schema works", async () => {
    const { extractNames, emptyUsage } = await import("./engines");
    askMistral.mockResolvedValueOnce(answer(extraction));
    const usage = emptyUsage();
    const x = await extractNames("mistral", "1. **Etsy** 2. **SGS**", terms, "Matha", usage);
    expect(x.extractor).toBe("mistral");
    expect(x.analysis.competitors).toEqual(["Etsy"]);
    expect(usage.mistral).toEqual({ requests: 1, input: 10, output: 20, waitedMs: 0 });
    expect(askGemini).not.toHaveBeenCalled();
  });

  it("a 429 on Mistral's extraction falls back to Gemini", async () => {
    const { extractNames, emptyUsage } = await import("./engines");
    askMistral.mockResolvedValueOnce({ ok: false, error: "Mistral API error 429 (free plan rate limit or quota reached) after waiting 2.0 s: Rate limit exceeded", requests: 2, waitedMs: 2000 });
    askGemini.mockResolvedValueOnce(answer(extraction));
    const usage = emptyUsage();
    const x = await extractNames("mistral", "text", terms, "Matha", usage);
    expect(x.extractor).toBe("gemini");
    expect(x.analysis.competitors).toEqual(["Etsy"]);
    expect(usage.mistral.requests).toBe(2);
  });

  it("falls back to Gemini when Mistral's extraction fails, and records who extracted", async () => {
    const { extractNames, emptyUsage } = await import("./engines");
    askMistral.mockResolvedValueOnce({ ok: false, error: "Mistral API error 422: schema not supported", requests: 1 });
    askGemini.mockResolvedValueOnce(answer(extraction));
    const usage = emptyUsage();
    const x = await extractNames("mistral", "text", terms, "Matha", usage);
    expect(x.extractor).toBe("gemini");
    expect(x.analysis.competitors).toEqual(["Etsy"]);
    expect(usage.mistral.requests).toBe(1);
    expect(usage.gemini.requests).toBe(1);
  });

  it("Gemini answers are extracted by Gemini only", async () => {
    const { extractNames, emptyUsage } = await import("./engines");
    askGemini.mockResolvedValueOnce(answer("not json"));
    const x = await extractNames("gemini", "text", terms, "Matha", emptyUsage());
    expect(askMistral).not.toHaveBeenCalled();
    expect(x).toMatchObject({ extractor: null, analysis: { method: "failed", competitors: [] } });
    expect(x.problem).toContain("Gemini extraction: reply was not valid JSON");
  });
});

describe("runVisibility with both engines", () => {
  beforeEach(() => {
    askGemini.mockReset();
    askMistral.mockReset();
    mistralKey = true;
  });

  // Minimal stand-in for the Supabase client: records inserts, answers the few selects the run makes.
  function fakeAdmin(prompts: { id: string; prompt: string }[]) {
    const inserted: Record<string, unknown>[] = [];
    const builder = (table: string) => {
      let op = "select";
      let payload: unknown = null;
      const b: Record<string, unknown> = {};
      for (const m of ["eq", "neq", "order", "limit", "in", "is", "not"]) b[m] = () => b;
      b.select = () => b;
      b.insert = (p: unknown) => ((op = "insert"), (payload = p), b);
      b.update = () => ((op = "update"), b);
      b.single = () => Promise.resolve({ data: { id: "run-1" }, error: null });
      b.then = (resolve: (v: unknown) => void) => {
        if (op === "insert") {
          if (table === "visibility_results") inserted.push(payload as Record<string, unknown>);
          return resolve({ data: null, error: null });
        }
        if (op === "update") return resolve({ data: null, error: null });
        return resolve({ data: table === "visibility_prompts" ? prompts : [], error: null });
      };
      return b;
    };
    return { admin: { from: builder } as never, inserted };
  }

  it("keeps Gemini going when the Mistral key is refused, and marks Mistral unavailable with the reason", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true, advanceTimeDelta: 2000 });
    const { runVisibility } = await import("./visibility-run");
    const { admin, inserted } = fakeAdmin([{ id: "p1", prompt: "best tea shop?" }, { id: "p2", prompt: "argan oil shop?" }]);
    askGemini.mockImplementation((prompt: string) => Promise.resolve(answer(prompt.startsWith("Read the text") ? extraction : "1. **Etsy**: tea")));
    askMistral.mockResolvedValue({ ok: false, error: "Mistral API error 401 (API key not accepted): Unauthorized", requests: 1 });

    const r = await runVisibility(admin, { id: "s1", owner_id: "u1", name: "Matha", url: "https://matha.site" });
    vi.useRealTimers();
    expect(r.error).toBeUndefined();
    const gem = inserted.filter((x) => x.engine === "gemini");
    const mis = inserted.filter((x) => x.engine === "mistral");
    expect(gem.map((x) => x.mentioned)).toEqual([false, false]);
    expect(gem[0]).toMatchObject({ extractor: "gemini", competitors: ["Etsy"] });
    expect(mis[0].error).toContain("401");
    expect(mis[1].error).toContain("stopped earlier in this run");
    // Mistral was not asked again after the key was refused.
    expect(askMistral).toHaveBeenCalledTimes(1);
  }, 30_000);
});
