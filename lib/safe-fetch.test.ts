import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

// DNS is faked: every name resolves to whatever `answer` holds at connection time.
let answer: { address: string; family: number }[] = [];
let lookups = 0;
vi.mock("node:dns", () => ({
  lookup: (_host: string, _opts: unknown, cb: (err: Error | null, a: { address: string; family: number }[]) => void) => {
    lookups++;
    cb(null, answer);
  },
}));

const lookupOnce = async (addrs: { address: string; family: number }[]) => {
  const { safeLookup } = await import("./safe-fetch");
  answer = addrs;
  return new Promise<{ err: Error | null; address: unknown }>((resolve) => safeLookup("store.test", { all: true }, (err, address) => resolve({ err, address })));
};

describe("one hardened fetcher: DNS checked at connect time", () => {
  it("refuses private, loopback, link-local and IPv6-internal answers", async () => {
    for (const address of ["10.0.0.5", "127.0.0.1", "169.254.169.254", "192.168.1.10", "100.64.0.1"]) {
      expect((await lookupOnce([{ address, family: 4 }])).err?.message).toContain("is not a public address");
    }
    for (const address of ["::1", "fd00::1", "fe80::1", "::ffff:127.0.0.1"]) {
      expect((await lookupOnce([{ address, family: 6 }])).err?.message).toContain("is not a public address");
    }
    // one bad address among good ones is enough to refuse
    expect((await lookupOnce([{ address: "93.184.216.34", family: 4 }, { address: "10.1.1.1", family: 4 }])).err).not.toBeNull();
  });

  it("lets public answers through", async () => {
    const r = await lookupOnce([{ address: "93.184.216.34", family: 4 }]);
    expect(r.err).toBeNull();
    expect(r.address).toEqual([{ address: "93.184.216.34", family: 4 }]);
  });

  it("a WooCommerce page fetch whose host resolves to a private IP at connect time is refused", async () => {
    vi.resetModules();
    const { fetchPublicPage } = await import("./woo");
    answer = [{ address: "169.254.169.254", family: 4 }];
    lookups = 0;
    const r = await fetchPublicPage("https://rebind.store.test/product/x/", "GPTBot");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("169.254.169.254 is not a public address");
    expect(lookups).toBeGreaterThan(0); // the refusal came from the connect-time lookup
  });

  it("the public check's fetcher uses the same guard", async () => {
    vi.resetModules();
    const { PublicFetcher } = await import("./public-fetch");
    answer = [{ address: "127.0.0.1", family: 4 }];
    const r = await new PublicFetcher(0).get("https://rebind.store.test/", "test", "home page");
    expect(r).toMatchObject({ ok: false });
    if (!r.ok) expect(r.error).toContain("127.0.0.1 is not a public address");
  });

  it("refuses other schemes, credentials and private IP literals before any lookup", async () => {
    const { guardedFetch, BlockedUrlError } = await import("./safe-fetch");
    lookups = 0;
    for (const url of ["http://store.test/", "ftp://store.test/", "https://user:pw@store.test/", "https://10.0.0.1/", "https://[::1]/", "https://metadata.google.internal/"]) {
      await expect(guardedFetch(new URL(url))).rejects.toBeInstanceOf(BlockedUrlError);
    }
    expect(lookups).toBe(0);
  });
});
