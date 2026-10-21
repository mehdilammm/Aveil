import { describe, expect, it } from "vitest";
import { checkLlmsTxt, checkRobots, isAllowed, parseRobots } from "./robots";

const WP_DEFAULT = `User-agent: *
Disallow: /wp-admin/
Allow: /wp-admin/admin-ajax.php

Sitemap: https://shop.test/wp-sitemap.xml
`;

describe("parseRobots / isAllowed", () => {
  it("allows everything on the WordPress default", () => {
    const r = parseRobots(WP_DEFAULT);
    expect(r.sitemaps).toEqual(["https://shop.test/wp-sitemap.xml"]);
    expect(isAllowed(r, "GPTBot", "/")).toBe(true);
    expect(isAllowed(r, "GPTBot", "/wp-admin/")).toBe(false);
    expect(isAllowed(r, "GPTBot", "/wp-admin/admin-ajax.php")).toBe(true);
  });

  it("uses the bot's own group instead of *", () => {
    const r = parseRobots("User-agent: *\nDisallow: /\n\nUser-agent: GPTBot\nAllow: /\n");
    expect(isAllowed(r, "GPTBot", "/product/x/")).toBe(true);
    expect(isAllowed(r, "ClaudeBot", "/product/x/")).toBe(false);
  });

  it("supports grouped agents, wildcards and $", () => {
    const r = parseRobots("User-agent: GPTBot\nUser-agent: ClaudeBot\nDisallow: /product/*$\nDisallow: /*.pdf$\n");
    expect(isAllowed(r, "claudebot", "/product/tea/")).toBe(false);
    expect(isAllowed(r, "GPTBot", "/file.pdf")).toBe(false);
    expect(isAllowed(r, "GPTBot", "/file.pdf?x=1")).toBe(true);
    expect(isAllowed(r, "PerplexityBot", "/product/tea/")).toBe(true);
  });
});

describe("checkRobots", () => {
  const url = "https://shop.test";
  it("passes the WordPress default", () => {
    expect(checkRobots(url, { ok: true, data: { status: 200, text: WP_DEFAULT } }, "/product/tea/")).toEqual([]);
  });

  it("flags each blocked bot with its own severity", () => {
    const text = "User-agent: GPTBot\nDisallow: /\n\nUser-agent: OAI-SearchBot\nDisallow: /product/\n\nSitemap: https://shop.test/s.xml";
    const f = checkRobots(url, { ok: true, data: { status: 200, text } }, "/product/tea/");
    expect(f.map((x) => `${x.finding_key}/${x.severity}/${x.basis}`)).toEqual(["robots:GPTBot/medium/observed", "robots:OAI-SearchBot/high/observed"]);
  });

  it("notes a missing sitemap, a 5xx and an unreadable file", () => {
    expect(checkRobots(url, { ok: true, data: { status: 404, text: "" } }, null).map((x) => x.finding_key)).toEqual(["robots:no_sitemap"]);
    expect(checkRobots(url, { ok: true, data: { status: 503, text: "" } }, null)[0].severity).toBe("high");
    expect(checkRobots(url, { ok: false, reason: "timeout" }, null)[0].basis).toBe("unavailable");
  });
});

describe("checkLlmsTxt", () => {
  const url = "https://shop.test";
  it("is low and informational when missing", () => {
    const [f] = checkLlmsTxt(url, { ok: true, data: { status: 404, text: "" } });
    expect(f.severity).toBe("low");
    expect(checkLlmsTxt(url, { ok: true, data: { status: 200, text: "<!doctype html><html>" } })).toHaveLength(1);
    expect(checkLlmsTxt(url, { ok: true, data: { status: 200, text: "# Shop\n> Tea and soap" } })).toEqual([]);
  });
});
