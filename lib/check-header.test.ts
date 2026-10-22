import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { CHECK_HEADER, checkHeaderValue, checkSignature, isAgentScopeCheck } from "./check-header";

const token = "agsc_test_token_0123456789abcdefghijklmnopqrstuvwxyz";
const now = 1792660000;
const plugin = join(__dirname, "..", "wordpress", "agentscope-core", "includes");

// Runs the plugin's own PHP code (no WordPress needed for these pure functions).
function php(code: string, args: string[]): string | null {
  const r = spawnSync("php", ["-r", `define('ABSPATH', '/'); require '${plugin}/class-agsc-check.php'; require '${plugin}/class-agsc-sender.php'; ${code}`, "--", ...args], { encoding: "utf8" });
  return r.error ? null : r.stdout.trim();
}
const hasPhp = php("echo 'ok';", []) === "ok";

describe("X-AgentScope-Check", () => {
  it("header name and format", () => {
    expect(CHECK_HEADER).toBe("X-AgentScope-Check");
    expect(checkHeaderValue(null, now)).toBe("1");
    expect(checkHeaderValue(token, now)).toBe(`v1.${now}.${checkSignature(token, String(now))}`);
    expect(checkHeaderValue(token, now)).toMatch(/^v1\.\d{10}\.[0-9a-f]{64}$/);
  });

  it("with a token: only a fresh value signed with that token counts", () => {
    const v = checkHeaderValue(token, now);
    expect(isAgentScopeCheck(v, token, now)).toBe(true);
    expect(isAgentScopeCheck(v, token, now + 600)).toBe(true);
    expect(isAgentScopeCheck(v, token, now + 601)).toBe(false);
    expect(isAgentScopeCheck(v, "agsc_other", now)).toBe(false);
    expect(isAgentScopeCheck("1", token, now)).toBe(false);
    expect(isAgentScopeCheck(v.slice(0, -1) + (v.endsWith("0") ? "1" : "0"), token, now)).toBe(false);
  });

  it("without a token: the unsigned '1' counts", () => {
    expect(isAgentScopeCheck("1", null, now)).toBe(true);
    expect(isAgentScopeCheck("", null, now)).toBe(false);
  });

  it.skipIf(!hasPhp)("the plugin's PHP verify agrees with the app's signature", () => {
    const verify = (value: string, tok: string, at: number) => php("echo AGSC_Check::verify($argv[1], $argv[2], (int) $argv[3]) ? 'yes' : 'no';", [value, tok, String(at)]);
    const v = checkHeaderValue(token, now);
    expect(verify(v, token, now)).toBe("yes");
    expect(verify(v, token, now + 601)).toBe("no");
    expect(verify(v, "agsc_other", now)).toBe("no");
    expect(verify("1", token, now)).toBe("no");
    expect(verify("1", "", now)).toBe("yes");
    expect(verify("v1.123.abc", token, now)).toBe("no");
  });

  it.skipIf(!hasPhp)("the plugin reads the app's connection code", () => {
    const code = "agsc1." + Buffer.from(JSON.stringify({ endpoint: "https://agentscope-peach.vercel.app/api/ingest/traffic", store_id: "8d1f9a52-3c4b-4d7e-9f10-2a3b4c5d6e7f", token })).toString("base64url");
    const parse = (c: string) => php("$r = AGSC_Sender::parse_code($argv[1], array('endpoint' => '', 'store_id' => '', 'token' => '')); echo is_string($r) ? 'error: ' . $r : json_encode($r);", [c]);
    expect(JSON.parse(parse(code)!)).toEqual({ endpoint: "https://agentscope-peach.vercel.app/api/ingest/traffic", store_id: "8d1f9a52-3c4b-4d7e-9f10-2a3b4c5d6e7f", token });
    expect(parse("agsc1.not-base64!")).toMatch(/^error: /);
    expect(parse("hello")).toMatch(/^error: /);
    const http = "agsc1." + Buffer.from(JSON.stringify({ endpoint: "http://x.test", store_id: "8d1f9a52-3c4b-4d7e-9f10-2a3b4c5d6e7f", token })).toString("base64url");
    expect(parse(http)).toMatch(/^error: .*https/);
  });
});
