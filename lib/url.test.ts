import { describe, expect, it } from "vitest";
import { isPrivateAddress, normalizeStoreUrl } from "./url";

describe("normalizeStoreUrl", () => {
  it("accepts public https stores", () => {
    expect(normalizeStoreUrl("https://shop.example.com/")).toEqual({ url: "https://shop.example.com" });
    expect(normalizeStoreUrl(" https://example.com/store/?a=1#x ")).toEqual({ url: "https://example.com/store" });
  });

  it("rejects unsafe or invalid URLs", () => {
    for (const bad of ["http://example.com", "shop.example.com", "https://localhost", "https://10.0.0.1", "https://[::1]", "https://a:b@example.com", "https://intranet", "https://x.internal"]) {
      expect(normalizeStoreUrl(bad)).toHaveProperty("error");
    }
  });
});

describe("isPrivateAddress", () => {
  it("detects private ranges", () => {
    expect(isPrivateAddress("192.168.1.1")).toBe(true);
    expect(isPrivateAddress("169.254.169.254")).toBe(true);
    expect(isPrivateAddress("::ffff:127.0.0.1")).toBe(true);
    expect(isPrivateAddress("8.8.8.8")).toBe(false);
    expect(isPrivateAddress("2606:4700::1111")).toBe(false);
  });
});
