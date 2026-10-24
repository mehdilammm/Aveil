import { describe, expect, it } from "vitest";
import { agenticPlugins, checkAgenticSupport, readAcp, readUcp } from "./agentic-protocols";
import { areaOf } from "./categories";

const ok = (status: number, text: string) => ({ ok: true as const, data: { status, text } });
// Shapes from the official specs: ucp.dev business profile, ACP rfc.discovery (2026-04-17).
const UCP = JSON.stringify({ ucp: { version: "2026-01-11", services: { "dev.ucp.shopping": [{ transport: "rest", endpoint: "https://s.test/ucp/v1" }] }, capabilities: { "dev.ucp.shopping.checkout": [{ version: "2026-01-11" }], "dev.ucp.shopping.fulfillment": [{}] } } });
const ACP = JSON.stringify({ protocol: { name: "acp", version: "2026-04-17", supported_versions: ["2026-04-17"] }, api_base_url: "https://s.test/acp", transports: ["rest"], capabilities: { services: ["checkout", "orders"] } });
const none = { ucp: ok(404, ""), acp: ok(404, ""), plugins: { ok: true as const, data: [{ plugin: "woocommerce/woocommerce.php", name: "WooCommerce", version: "10.2" }] } };

describe("agentic checkout support (information only)", () => {
  it("reads a UCP profile and an ACP discovery document; without checkout they are partial", () => {
    expect(readUcp("u", ok(200, UCP)).state).toBe("valid");
    expect(readUcp("u", ok(200, JSON.stringify({ ucp: { version: "2026-01-11", capabilities: { "dev.ucp.shopping.catalog": [] } } }))).state).toBe("partial");
    expect(readUcp("u", ok(200, "<!doctype html><html>")).state).toBe("absent");
    expect(readAcp("a", ok(200, ACP)).state).toBe("valid");
    expect(readAcp("a", ok(200, JSON.stringify({ protocol: { name: "acp" }, capabilities: { services: ["carts"] } }))).state).toBe("partial");
    expect(readAcp("a", ok(200, JSON.stringify({ protocol: { name: "other" } }))).state).toBe("absent");
    expect(readAcp("a", { ok: false, reason: "Blocked by Cloudflare WAF (HTTP 403)" })).toEqual({ state: "unavailable", detail: "Blocked by Cloudflare WAF (HTTP 403)" });
  });

  it("plugins whose name or folder says agent checkout, UCP or ACP; not words that merely contain the letters", () => {
    const list = [
      { plugin: "agentcart/agentcart.php", name: "AgentCart", version: "1.3.4" },
      { plugin: "wpmr-agentic-checkout/x.php", name: "WPMR Agentic Checkout", version: "1" },
      { plugin: "acp-woo/main.php", name: "Something", version: "1" },
      { plugin: "backup-pro/b.php", name: "Backup Pro", version: "1" },
      { plugin: "woocommerce/woocommerce.php", name: "WooCommerce", version: "10" },
    ];
    expect(agenticPlugins(list).map((p) => p.name)).toEqual(["AgentCart", "WPMR Agentic Checkout", "Something"]);
  });

  it("one finding: found or not found, with each source's evidence; area is checkout", () => {
    const no = checkAgenticSupport("https://matha.site", none);
    expect(no).toMatchObject({ finding_key: "agentic:checkout", severity: "low", basis: "observed", title: "No agentic checkout protocol found (information only)" });
    expect(no.evidence).toContain("https://matha.site/.well-known/ucp answered HTTP 404.");
    expect(no.evidence).toContain("No active plugin names agent checkout, UCP or ACP (1 active plugin).");
    expect(areaOf(no)).toBe("checkout");
    const yes = checkAgenticSupport("https://s.test", { ucp: ok(200, UCP), acp: ok(200, ACP), plugins: { ok: false, reason: "HTTP 403" } });
    expect(yes.title).toBe("Agentic checkout support found: UCP profile, ACP discovery (information only)");
    expect(yes.evidence).toContain("Plugins: Unavailable: HTTP 403");
  });

  it("when nothing could be fetched it is Unavailable with the reasons, not 'not found' as a fact", () => {
    const f = checkAgenticSupport("https://s.test", { ucp: { ok: false, reason: "timeout" }, acp: { ok: false, reason: "timeout" }, plugins: { ok: false, reason: "HTTP 401" } });
    expect(f).toMatchObject({ basis: "unavailable", title: "Agentic checkout support could not be checked (information only)" });
  });
});
