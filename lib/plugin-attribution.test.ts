import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { AI_REFERRAL_SOURCES } from "./ai-orders";

const root = join(__dirname, "..");
const file = join(root, "wordpress/agentscope-core/includes/class-agsc-attribution.php");
const hasPhp = !spawnSync("php", ["-v"]).error;
const php = (code: string, ...args: string[]) => {
  const r = spawnSync("php", ["-r", `define('ABSPATH', '/'); require '${file}'; ${code}`, "--", ...args], { encoding: "utf8" });
  if (r.status !== 0) throw new Error(r.stderr || r.stdout);
  return JSON.parse(r.stdout);
};

describe.skipIf(!hasPhp)("plugin AI referral note (PHP)", () => {
  it("matches utm_source first, then the referrer host; lookalikes do not match", () => {
    const c = (ref: string, utm: string) => php("echo json_encode(AGSC_Attribution::classify($argv[1], $argv[2]));", ref, utm);
    expect(c("", "chatgpt.com")).toEqual({ source: "ChatGPT", via: "utm_source" });
    expect(c("https://www.perplexity.ai/search?q=x", "")).toEqual({ source: "Perplexity", via: "referrer" });
    expect(c("https://gemini.google.com/app", "newsletter")).toEqual({ source: "Gemini", via: "referrer" });
    expect(c("https://claude.ai.evil.example/", "")).toBeNull();
    expect(c("https://fake-chatgpt.com/", "")).toBeNull();
    expect(c("https://www.google.com/", "")).toBeNull();
  });

  it("keeps the landing path without its query string", () => {
    expect(php("echo json_encode(AGSC_Attribution::entry_path($argv[1]));", "/product/lamp/?utm_source=chatgpt.com&email=a@b.co")).toBe("/product/lamp/");
  });

  it("uses the same AI sources as the app", () => {
    const names = php("echo json_encode(array_keys(AGSC_Attribution::sources()));");
    expect(names).toEqual(AI_REFERRAL_SOURCES.map((s) => s.source));
  });

  it("writes on order creation for classic and block checkout, never on the thank-you page, and declares HPOS", () => {
    const src = readFileSync(file, "utf8");
    expect(src).toContain("woocommerce_checkout_order_processed");
    expect(src).toContain("woocommerce_store_api_checkout_order_processed");
    expect(src).not.toContain("woocommerce_thankyou");
    expect(src).toContain("'custom_order_tables'");
    expect(src).toMatch(/wp_has_consent\('statistics'\)/);
    expect(src).not.toMatch(/wp_remote_|REMOTE_ADDR|HTTP_USER_AGENT/);
  });
});
