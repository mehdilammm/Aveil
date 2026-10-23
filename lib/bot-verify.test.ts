import { describe, expect, it } from "vitest";
import { botOfUa, ipInCidr, parseRanges, providerOf, verifyHit } from "./bot-verify";

// claude.com/crawling/bots.json as read on 2026-10-23 (first prefixes).
const anthropic = { creationTime: "2026-10-20T00:00:00Z", prefixes: [{ ipv4Prefix: "216.73.216.0/22" }, { ipv4Prefix: "34.162.230.222/32" }, { ipv4Prefix: "34.162.244.71/32" }] };
const noRdns = async () => ({ hostnames: [], forward: async () => [] });

describe("bot identity", () => {
  it("user agents map to the right bot (most specific token first)", () => {
    expect(botOfUa("Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; OAI-SearchBot/1.0; +https://openai.com/searchbot)")).toBe("OAI-SearchBot");
    expect(botOfUa("Mozilla/5.0 (compatible; GPTBot/1.1; +https://openai.com/gptbot)")).toBe("GPTBot");
    expect(botOfUa("Mozilla/5.0 (compatible; Claude-SearchBot/1.0; +Claude-SearchBot@anthropic.com)")).toBe("Claude-SearchBot");
    expect(botOfUa("Mozilla/5.0 (Windows NT 10.0) Chrome/130")).toBeNull();
    expect(providerOf("Claude-User")).toBe("anthropic");
  });

  it("published lists: parsed, or refused with the reason", () => {
    expect(parseRanges(anthropic)).toEqual({ ok: true, cidrs: ["216.73.216.0/22", "34.162.230.222/32", "34.162.244.71/32"], creationTime: "2026-10-20T00:00:00Z" });
    expect(parseRanges({ prefixes: [{ ipv6Prefix: "2001:4860:4801:10::/64" }, { ipv4Prefix: "999.1.1.1/8" }] })).toEqual({ ok: true, cidrs: ["2001:4860:4801:10::/64"], creationTime: null });
    expect(parseRanges("<html>")).toEqual({ ok: false, reason: "not the published format (no prefixes list)" });
  });

  it("CIDR matching, IPv4, IPv6 and IPv4-mapped", () => {
    expect(ipInCidr("216.73.219.255", "216.73.216.0/22")).toBe(true);
    expect(ipInCidr("216.73.220.1", "216.73.216.0/22")).toBe(false);
    expect(ipInCidr("::ffff:34.162.230.222", "34.162.230.222/32")).toBe(true);
    expect(ipInCidr("2001:4860:4801:10::abcd", "2001:4860:4801:10::/64")).toBe(true);
    expect(ipInCidr("2001:4860:4801:11::1", "2001:4860:4801:10::/64")).toBe(false);
    expect(ipInCidr("10.0.0.1", "2001:4860:4801:10::/64")).toBe(false);
  });

  it("verified by list = Observed; UA only = claim with the reason", async () => {
    const ranges = new Map([["ClaudeBot", parseRanges(anthropic).ok ? (parseRanges(anthropic) as { cidrs: string[] }).cidrs : []]]);
    expect(await verifyHit({ bot: "ClaudeBot", ip: "216.73.216.10" }, ranges, noRdns)).toMatchObject({ verified: true, method: "ip_range" });
    expect(await verifyHit({ bot: "ClaudeBot", ip: "203.0.113.9" }, ranges, noRdns)).toEqual({ verified: false, method: null, detail: "IP not in anthropic's published list for ClaudeBot" });
    expect(await verifyHit({ bot: "GPTBot", ip: "203.0.113.9" }, ranges, noRdns)).toEqual({ verified: false, method: null, detail: "no usable IP list for GPTBot right now" });
  });

  it("Google: reverse DNS on googlebot.com confirmed by the forward lookup; a lookalike name is refused", async () => {
    const good = async () => ({ hostnames: ["crawl-66-249-66-1.googlebot.com."], forward: async () => ["66.249.66.1"] });
    expect(await verifyHit({ bot: "Googlebot", ip: "66.249.66.1" }, new Map(), good)).toMatchObject({ verified: true, method: "rdns" });
    const fake = async () => ({ hostnames: ["googlebot.com.evil.test"], forward: async () => ["66.249.66.1"] });
    expect((await verifyHit({ bot: "Googlebot", ip: "66.249.66.1" }, new Map(), fake)).verified).toBe(false);
    const mismatch = async () => ({ hostnames: ["crawl.googlebot.com"], forward: async () => ["66.249.66.2"] });
    expect((await verifyHit({ bot: "Googlebot", ip: "66.249.66.1" }, new Map(), mismatch)).verified).toBe(false);
    // OpenAI publishes no reverse DNS names: never asked.
    let asked = false;
    await verifyHit({ bot: "GPTBot", ip: "1.2.3.4" }, new Map(), async () => ((asked = true), { hostnames: [], forward: async () => [] }));
    expect(asked).toBe(false);
  });
});
