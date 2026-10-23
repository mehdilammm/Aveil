import { describe, expect, it } from "vitest";
import { isAllowed, parseRobots } from "../robots";
import { patchRobots, SEARCH_AGENTS, TRAINING_CRAWLERS } from "./robots-patch";

// WordPress's default virtual robots.txt (as matha.site serves it), and a file that blocks GPTBot and all bots' cart.
const wpDefault = "User-agent: *\nDisallow: /wp-admin/\nAllow: /wp-admin/admin-ajax.php\n\nSitemap: https://matha.site/wp-sitemap.xml\n";
const blocking = "# shop rules\nUser-agent: *\nDisallow: /cart/\nDisallow: /checkout/\n\nUser-agent: GPTBot\nUser-agent: Bingbot\nDisallow: /\n\nUser-agent: ClaudeBot\nDisallow: /\n\nSitemap: https://shop.test/sitemap.xml\n";

describe("robots.txt patch", () => {
  it("default WordPress file: AI agents allowed, /wp-admin/ still closed to them, training follows the choice", () => {
    const r = patchRobots(wpDefault, "block", "/product/round-led-mirror/");
    expect(r.problems).toEqual([]);
    const p = parseRobots(r.text);
    for (const b of SEARCH_AGENTS) {
      expect(isAllowed(p, b, "/product/round-led-mirror/")).toBe(true);
      expect(isAllowed(p, b, "/wp-admin/")).toBe(false);
    }
    for (const b of TRAINING_CRAWLERS) expect(isAllowed(p, b, "/")).toBe(false);
    expect(r.text).toContain("Sitemap: https://matha.site/wp-sitemap.xml");
    expect(patchRobots(wpDefault, "allow", null).checks.every((c) => c.actual)).toBe(true);
  });

  it("existing bot rules are replaced; other bots in the same group keep theirs", () => {
    const r = patchRobots(blocking, "allow", "/product/x/");
    expect(r.problems).toEqual([]);
    expect(r.removed).toEqual(expect.arrayContaining(["User-agent: GPTBot", "User-agent: ClaudeBot"]));
    const p = parseRobots(r.text);
    expect(isAllowed(p, "Bingbot", "/product/x/")).toBe(false); // Bingbot's own rule kept
    expect(isAllowed(p, "GPTBot", "/product/x/")).toBe(true);
    expect(isAllowed(p, "GPTBot", "/cart/")).toBe(false); // the merchant's "*" closures follow the AI bots
    expect(isAllowed(p, "SomeOtherBot", "/cart/")).toBe(false);
    expect(r.text.startsWith("# shop rules")).toBe(true);
  });

  it("a comment inside a removed group does not leave its rules behind", () => {
    const r = patchRobots("User-agent: GPTBot\nDisallow: /a/\n# note\nDisallow: /\n", "allow", null);
    expect(r.text).not.toContain("Disallow: /\n# AgentScope");
    expect(isAllowed(parseRobots(r.text), "GPTBot", "/x")).toBe(true);
  });

  it("running it again gives the same file", () => {
    const once = patchRobots(blocking, "block", null).text;
    expect(patchRobots(once, "block", null).text).toBe(once);
    expect(patchRobots(once, "block", null).unchanged).toBe(true);
  });

  it("an empty or missing robots.txt gets just the AI groups", () => {
    const r = patchRobots("", "allow", "/p/");
    expect(r.problems).toEqual([]);
    expect(r.text.startsWith("# AgentScope")).toBe(true);
  });
});
