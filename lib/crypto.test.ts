import { beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

beforeAll(() => {
  process.env.CREDENTIALS_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");
});

describe("crypto", () => {
  it("round-trips and binds to the store id", async () => {
    const { encrypt, decrypt } = await import("./crypto");
    const enc = encrypt("ck_secret", "store-1");
    expect(enc).not.toContain("ck_secret");
    expect(decrypt(enc, "store-1")).toBe("ck_secret");
    expect(() => decrypt(enc, "store-2")).toThrow();
  });
});
