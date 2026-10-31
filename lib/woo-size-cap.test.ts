import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
let body: () => ReadableStream<Uint8Array>;
vi.mock("./safe-fetch", () => ({
  BlockedUrlError: class extends Error {},
  guardedFetch: async () => new Response(body(), { status: 200, headers: { "content-type": "application/json" } }),
}));
const { fetchSiteName } = await import("./woo");

// A stream of `chunks` × 1 MB of spaces, then a small JSON object.
const stream = (chunks: number) =>
  new ReadableStream<Uint8Array>({
    start(c) {
      for (let i = 0; i < chunks; i++) c.enqueue(new Uint8Array(1024 * 1024).fill(32));
      c.enqueue(new TextEncoder().encode('{"name":"Shop"}'));
      c.close();
    },
  });

describe("WooCommerce answers are read with a size cap", () => {
  it("a normal answer is read", async () => {
    body = () => stream(1);
    await expect(fetchSiteName("https://shop.example")).resolves.toEqual({ ok: true, data: "Shop" });
  });
  it("an answer over 16 MB is refused instead of filling memory", async () => {
    body = () => stream(20);
    const r = await fetchSiteName("https://shop.example");
    expect(r.ok).toBe(false);
    expect(JSON.stringify(r)).toContain("more than 16 MB");
  });
});
