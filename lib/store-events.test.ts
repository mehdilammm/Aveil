import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { breakageAlert, likelyCause, newProblems } from "./breakage";
import type { Finding } from "./rules";
import { validateEvents } from "./store-events";

const now = new Date("2026-10-27T10:00:00Z");
const ev = (over: Record<string, unknown> = {}) => ({ id: "00000000-0000-4000-8000-000000000001", kind: "plugin_updated", subject: "Woo Cache", slug: "woo-cache/woo-cache.php", old_version: "2.1.0", new_version: "2.2.0", product_id: null, at: "2026-10-27T09:58:00Z", ...over });

describe("store events from the plugin", () => {
  it("keeps names and versions; refuses unknown kinds, bad ids, old or future dates, product events without a product", () => {
    const r = validateEvents({ events: [
      ev(),
      ev({ id: "00000000-0000-4000-8000-000000000002", kind: "product_published", product_id: 173, subject: "<b>Round LED Mirror</b>" }),
      ev({ id: "nope" }),
      ev({ id: "00000000-0000-4000-8000-000000000003", kind: "user_login" }),
      ev({ id: "00000000-0000-4000-8000-000000000004", at: "2026-10-01T00:00:00Z" }),
      ev({ id: "00000000-0000-4000-8000-000000000005", at: "2026-10-28T00:00:00Z" }),
      ev({ id: "00000000-0000-4000-8000-000000000006", kind: "product_updated", product_id: null }),
    ] }, now);
    if ("error" in r) throw new Error(r.error);
    expect(r.skipped).toBe(5);
    expect(r.events).toEqual([
      { event_id: "00000000-0000-4000-8000-000000000001", kind: "plugin_updated", subject: "Woo Cache", slug: "woo-cache/woo-cache.php", old_version: "2.1.0", new_version: "2.2.0", product_id: null, occurred_at: "2026-10-27T09:58:00.000Z" },
      { event_id: "00000000-0000-4000-8000-000000000002", kind: "product_published", subject: "Round LED Mirror", slug: "woo-cache/woo-cache.php", old_version: "2.1.0", new_version: "2.2.0", product_id: 173, occurred_at: "2026-10-27T09:58:00.000Z" },
    ]);
    expect(validateEvents({ events: Array.from({ length: 51 }, () => ev()) }, now)).toEqual({ error: "At most 50 events per request" });
    expect(validateEvents({ nope: 1 }, now)).toMatchObject({ error: expect.any(String) });
  });
});

const f = (finding_key: string, type: string, title: string, severity: Finding["severity"] = "high", basis: Finding["basis"] = "observed"): Finding => ({ finding_key, type, title, severity, basis, evidence: "e", guidance: "g", product_id: null });

describe("breakage: new problems after a change", () => {
  it("only breakable problems the last full scan did not have", () => {
    const mini = [
      f("access:GPTBot", "access_blocked", "GPTBot gets HTTP 403"),
      f("access:GPTBot-old", "access_rate_limited", "Rate-limited for this bot: GPTBot", "medium", "heuristic"),
      f("feed_identifier_missing:170", "feed_identifier_missing", "Feed: no GTIN or MPN", "low"),
      f("checkout:captcha", "checkout_captcha", "A captcha on checkout", "medium"),
      f("access:ClaudeBot", "access_check_unavailable", "Could not check", "low", "unavailable"),
    ];
    const last = [{ finding_key: "access:GPTBot-old", basis: "heuristic" }, { finding_key: "feed_identifier_missing:170", basis: "observed" }];
    expect(newProblems(mini, last).map((p) => p.finding_key)).toEqual(["access:GPTBot", "checkout:captcha"]);
  });

  it("names the latest update as the likely cause; no problem, no alert", () => {
    const changes = [
      { kind: "plugin_activated", subject: "Security Pro", old_version: null, new_version: "1.0", occurred_at: "2026-10-27T09:59:00Z" },
      { kind: "plugin_updated", subject: "Woo Cache", old_version: "2.1.0", new_version: "2.2.0", occurred_at: "2026-10-27T09:58:00Z" },
    ];
    expect(likelyCause(changes)?.subject).toBe("Woo Cache");
    const a = breakageAlert(changes, newProblems([f("access:GPTBot", "access_blocked", "GPTBot gets HTTP 403")], []), "scan1");
    expect(a?.title).toBe("After plugin updated Woo Cache (2.1.0 → 2.2.0): GPTBot gets HTTP 403");
    expect(a?.detail).toMatchObject({ changes: 2, compared_scan_id: "scan1", problems: [{ basis: "observed" }] });
    expect(breakageAlert(changes, [], "scan1")).toBeNull();
  });
});

const root = join(__dirname, "..");
const hasPhp = !spawnSync("php", ["-v"]).error;
const php = (c: string) => {
  const r = spawnSync("php", [join(root, "lib/fixtures/events-harness.php"), c], { encoding: "utf8" });
  if (r.status !== 0) throw new Error(r.stderr || r.stdout);
  return JSON.parse(r.stdout);
};
const src = readFileSync(join(root, "wordpress/agentscope-core/includes/class-agsc-events.php"), "utf8");

describe.skipIf(!hasPhp)("plugin 1.7.0 store changes (PHP)", () => {
  it("an update reports the old and new version; theme switch and plugin off too; our own deactivation is not reported", () => {
    const r = php("upgrade");
    expect(r.queue.map((e: { kind: string; subject: string; old_version: string | null; new_version: string | null }) => [e.kind, e.subject, e.old_version, e.new_version])).toEqual([
      ["plugin_updated", "Woo Cache", "2.1.0", "2.2.0"],
      ["theme_switched", "Astra → Storefront", null, "4.6.0"],
      ["plugin_deactivated", "Woo Cache", "2.2.0", null],
    ]);
    expect(r.cron).toBe(true);
    expect(r.no_network_in_hooks).toBe(true);
    // The app accepts what the plugin sends.
    const v = validateEvents({ events: r.queue }, new Date());
    expect("events" in v && v.events.length).toBe(3);
  });

  it("a product is reported at most once every 5 minutes, and nothing is kept when not connected", () => {
    const r = php("product");
    expect(r.debounce).toEqual([true, false, true, true]);
    expect(r.queue).toHaveLength(1);
    expect(r.queue[0]).toMatchObject({ kind: "product_updated", product_id: 173 });
    expect(r.not_connected).toEqual([]);
    expect(r.core).toBe("6.9");
  });

  it("WP-Cron sends one signed request; failures are kept for a retry", () => {
    const r = php("flush");
    expect([r.after_failed, r.ok, r.after_ok, r.url, r.signature_ok]).toEqual([1, "Sent 1 store changes.", 0, "https://app.test/api/ingest/events", true]);
  });

  it("no network call in any hook: only flush() talks to the app", () => {
    const hooks = src.slice(src.indexOf("public static function init"), src.indexOf("public static function endpoint"));
    expect(hooks).not.toMatch(/wp_remote_|curl_|file_get_contents\(\s*['"]https?:|gethostbyaddr|dns_get_record/);
    expect(src).toContain("add_action(self::CRON, array(__CLASS__, 'flush'))");
    const uninstall = readFileSync(join(root, "wordpress/agentscope-core/uninstall.php"), "utf8");
    expect(uninstall).toContain("agsc_event_queue");
  });
});
