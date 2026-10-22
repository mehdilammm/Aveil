import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const askGemini = vi.fn();
let geminiOn = true;
vi.mock("./gemini", () => ({ askGemini: (...a: unknown[]) => askGemini(...a), geminiConfigured: () => geminiOn, GEMINI_MODEL: "gemini-test" }));

const extraction = JSON.stringify({ brands: [{ name: "Etsy", type: "marketplace", url_if_present: null }, { name: "SGS", type: "service", url_if_present: null }], store_mentioned: false, rank_if_listed: null });
const chat = (content: string) => new Response(JSON.stringify({ choices: [{ message: { content }, finish_reason: "stop" }], usage: { prompt_tokens: 11, completion_tokens: 22 } }), { status: 200 });
const limited = () => new Response(JSON.stringify({ error: { message: "Rate limit reached" } }), { status: 429, headers: { "retry-after": "1" } });
const geminiAnswer = (text: string) => ({ ok: true as const, text, finishReason: "STOP", inputTokens: 5, outputTokens: 6, blocked: null, requests: 1 });

const terms = { names: ["Matha"], host: "matha.site", keys: ["matha"] };
const fx = (name: string) => readFileSync(join(__dirname, "fixtures", name), "utf8");
const json = (status: number, body: string) => new Response(body, { status, headers: { "content-type": "application/json" } });

describe("internal task chain: Groq → NVIDIA → Gemini → heuristic", () => {
  const fetchMock = vi.fn();
  const hosts = () => fetchMock.mock.calls.map((c) => new URL(String(c[0])).host);
  beforeEach(() => {
    vi.resetModules();
    vi.useFakeTimers({ shouldAdvanceTime: true, advanceTimeDelta: 1000 });
    fetchMock.mockReset();
    askGemini.mockReset();
    geminiOn = true;
    vi.stubGlobal("fetch", fetchMock);
    vi.stubEnv("GROQ_API_KEY", "g");
    vi.stubEnv("NVIDIA_API_KEY", "n");
    vi.stubEnv("GROQ_ENABLED", "");
    vi.stubEnv("NVIDIA_ENABLED", "");
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("Groq succeeds: one request, json_schema sent, nothing else asked", async () => {
    const { extractNames, emptyUsage } = await import("./engines");
    fetchMock.mockResolvedValueOnce(chat(extraction));
    const usage = emptyUsage();
    const x = await extractNames("1. **Etsy** 2. **SGS**", terms, "Matha", usage);
    expect(x.extractor).toBe("groq");
    expect(x.analysis.competitors).toEqual(["Etsy"]);
    expect(hosts()).toEqual(["api.groq.com"]);
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.model).toBe("openai/gpt-oss-20b");
    expect(body.response_format.type).toBe("json_schema");
    expect(usage.groq).toMatchObject({ requests: 1, input: 11, output: 22 });
    expect(askGemini).not.toHaveBeenCalled();
  });

  it("Groq 429 twice (after Retry-After) → NVIDIA", async () => {
    const { extractNames, emptyUsage } = await import("./engines");
    fetchMock.mockResolvedValueOnce(limited()).mockResolvedValueOnce(limited()).mockResolvedValueOnce(chat("```json\n" + extraction + "\n```"));
    const usage = emptyUsage();
    const x = await extractNames("text", terms, "Matha", usage);
    expect(x.extractor).toBe("nvidia");
    expect(hosts()).toEqual(["api.groq.com", "api.groq.com", "integrate.api.nvidia.com"]);
    const nv = JSON.parse(fetchMock.mock.calls[2][1].body);
    expect(nv.model).toBe("openai/gpt-oss-20b");
    expect(nv.response_format).toBeUndefined();
    expect(nv.messages[0].content).toContain("matching this JSON Schema");
    expect(usage.groq.requests).toBe(2);
    expect(usage.nvidia.requests).toBe(1);
    expect(x.attempts.map((a) => a.by)).toEqual(["groq", "nvidia"]);
    expect(x.attempts[0].problem).toContain("Groq API error 429");
  });

  it("a 429 then success on Groq is one task with 2 requests", async () => {
    const { extractNames, emptyUsage } = await import("./engines");
    fetchMock.mockResolvedValueOnce(limited()).mockResolvedValueOnce(chat(extraction));
    const usage = emptyUsage();
    const x = await extractNames("text", terms, "Matha", usage);
    expect(x.extractor).toBe("groq");
    expect(usage.groq.requests).toBe(2);
  });

  it("invalid JSON from Groq and NVIDIA → Gemini", async () => {
    const { extractNames, emptyUsage } = await import("./engines");
    fetchMock.mockResolvedValueOnce(chat("Here are the names: Etsy")).mockResolvedValueOnce(chat('{"brands": "Etsy"}'));
    askGemini.mockResolvedValueOnce(geminiAnswer(extraction));
    const usage = emptyUsage();
    const x = await extractNames("text", terms, "Matha", usage);
    expect(x.extractor).toBe("gemini");
    expect(x.attempts.map((a) => [a.by, a.problem])).toEqual([["groq", "reply did not pass validation"], ["nvidia", "reply did not pass validation"], ["gemini", null]]);
    expect(usage.gemini.requests).toBe(1);
  });

  it("everything fails → heuristic: no names, the text match still decides 'mentioned'", async () => {
    const { extractNames, emptyUsage } = await import("./engines");
    fetchMock.mockResolvedValue(new Response("down", { status: 503 }));
    askGemini.mockResolvedValueOnce({ ok: false, error: "Gemini API error 429: quota", requests: 2 });
    const x = await extractNames("Try Matha or Etsy.", terms, "Matha", emptyUsage());
    expect(x.extractor).toBeNull();
    expect(x.analysis).toMatchObject({ method: "failed", competitors: [], mentioned: true });
    expect(x.problem).toContain("groq: Groq API error 503");
    expect(x.problem).toContain("nvidia: NVIDIA API error 503");
    expect(x.problem).toContain("gemini: Gemini API error 429");
  });

  it("GROQ_ENABLED=false / NVIDIA_ENABLED=false skip them without a request; Gemini can be refused by its budget", async () => {
    vi.stubEnv("GROQ_ENABLED", "false");
    vi.stubEnv("NVIDIA_ENABLED", "false");
    const { extractNames, emptyUsage } = await import("./engines");
    const x = await extractNames("text", terms, "Matha", emptyUsage(), async () => false);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(askGemini).not.toHaveBeenCalled();
    expect(x.extractor).toBeNull();
  });

  it("topic: Groq's phrase is validated (brand → next model)", async () => {
    const { runTask } = await import("./task-models");
    const { validateTopic } = await import("./public-scan");
    fetchMock.mockResolvedValueOnce(chat("Offerman handmade furniture")).mockResolvedValueOnce(chat("handmade wooden furniture and home goods"));
    const t = await runTask({ prompt: "p", maxOutputTokens: 60, validate: (s) => validateTopic(s, ["offerman"]) });
    expect(t).toMatchObject({ value: "handmade wooden furniture and home goods", by: "nvidia" });
    // gpt-oss reasons first, so Groq gets room for it even for a 60-token task.
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).max_tokens).toBe(1024);
  });
  it("Groq reply with rank_if_listed: null is accepted (fixture)", async () => {
    const { extractNames, emptyUsage } = await import("./engines");
    fetchMock.mockResolvedValueOnce(json(200, fx("groq-extraction-rank-null.json")));
    const usage = emptyUsage();
    const x = await extractNames("1. Etsy 2. Hot Sauce Store", terms, "Matha", usage);
    expect(x.extractor).toBe("groq");
    expect(x.analysis.competitors).toEqual(["Etsy", "Hot Sauce Store"]);
    expect(x.analysis.rank).toBeNull();
    expect(usage.groq).toMatchObject({ requests: 1, input: 410, output: 96 });
    const schema = JSON.parse(fetchMock.mock.calls[0][1].body).response_format.json_schema.schema;
    expect(schema.properties.rank_if_listed.type).toEqual(["integer", "null"]);
    expect(schema.required).toContain("rank_if_listed");
    expect(schema.properties.brands.items.properties.url_if_present.type).toEqual(["string", "null"]);
    expect(schema.properties.brands.items.required).toContain("url_if_present");
  });

  it("Groq json_validate_failed: the failed_generation is checked by our own validation", async () => {
    const { extractNames, emptyUsage } = await import("./engines");
    const failed = { brands: [{ name: "Etsy", type: "marketplace", url_if_present: null }], store_mentioned: false };
    fetchMock.mockResolvedValueOnce(json(400, JSON.stringify({ error: { message: "Generated JSON does not match the expected schema. Please adjust your prompt. See 'failed_generation' for more details. Error: jsonschema: '' does not validate: missing properties: 'rank_if_listed'", type: "invalid_request_error", code: "json_validate_failed", failed_generation: JSON.stringify(failed) } })));
    const x = await extractNames("Etsy", terms, "Matha", emptyUsage());
    expect(x.extractor).toBe("groq");
    expect(x.analysis.competitors).toEqual(["Etsy"]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("NVIDIA 410 (model end of life, fixture) is reported clearly and the chain goes on to Gemini", async () => {
    vi.stubEnv("GROQ_ENABLED", "false");
    const { extractNames, emptyUsage } = await import("./engines");
    fetchMock.mockResolvedValueOnce(json(410, fx("nvidia-model-410.json")));
    askGemini.mockResolvedValueOnce(geminiAnswer(extraction));
    const x = await extractNames("text", terms, "Matha", emptyUsage());
    expect(x.extractor).toBe("gemini");
    expect(x.attempts[0].by).toBe("nvidia");
    expect(x.attempts[0].problem).toContain('NVIDIA model "openai/gpt-oss-20b" is not available (HTTP 410');
    expect(x.attempts[0].problem).toContain("end of life");
    expect(x.attempts[0].problem).toContain("Set NVIDIA_MODEL");
  });

  it("NVIDIA_MODEL changes the model without code", async () => {
    vi.stubEnv("GROQ_ENABLED", "false");
    vi.stubEnv("NVIDIA_MODEL", "nvidia/some-small-model");
    const { extractNames, emptyUsage } = await import("./engines");
    fetchMock.mockResolvedValueOnce(chat(extraction));
    await extractNames("text", terms, "Matha", emptyUsage());
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).model).toBe("nvidia/some-small-model");
  });
});
