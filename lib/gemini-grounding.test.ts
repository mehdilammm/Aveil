import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

describe("askGemini with grounding", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("sends the google_search tool only when asked and returns the parsed sources", async () => {
    vi.stubEnv("GEMINI_API_KEY", "k");
    const fetchMock = vi.fn().mockImplementation(async () => new Response(JSON.stringify({
      candidates: [{ content: { parts: [{ text: "Try Etsy." }] }, finishReason: "STOP", groundingMetadata: { webSearchQueries: ["argan oil shop"], groundingChunks: [{ web: { uri: "https://vertexaisearch.cloud.google.com/r/1", title: "etsy.com" } }] } }],
      usageMetadata: { promptTokenCount: 3, candidatesTokenCount: 4 },
    }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const { askGemini } = await import("./gemini");
    const g = await askGemini("q", { grounding: true });
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).tools).toEqual([{ google_search: {} }]);
    expect(g.ok && g.grounding?.sources[0].domain).toBe("etsy.com");
    const plain = await askGemini("q");
    expect(JSON.parse(fetchMock.mock.calls[1][1].body).tools).toBeUndefined();
    expect(plain.ok && "grounding" in plain).toBe(false);
  });

  it("grounding is off unless GEMINI_GROUNDING_ENABLED=true", async () => {
    const { groundingEnabled } = await import("./grounding");
    expect(groundingEnabled()).toBe(false);
    vi.stubEnv("GEMINI_GROUNDING_ENABLED", "true");
    expect(groundingEnabled()).toBe(true);
  });
});
