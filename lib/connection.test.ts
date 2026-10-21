import { describe, expect, it } from "vitest";
import { connectionAfterScan } from "./connection";

describe("connectionAfterScan", () => {
  it("marks a store connected after a successful scan and clears the error", () => {
    expect(connectionAfterScan({ ok: true })).toEqual({ connection_status: "connected", connection_error: null });
  });

  it("marks a store in error with the message after a failed scan", () => {
    expect(connectionAfterScan({ ok: false, message: "WooCommerce rejected the API key." })).toEqual({
      connection_status: "error",
      connection_error: "WooCommerce rejected the API key.",
    });
    expect(connectionAfterScan({ ok: false, message: "x".repeat(900) }).connection_error).toHaveLength(500);
  });
});
