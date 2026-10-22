// X-AgentScope-Check: marks AgentScope's own test requests (full scan and /check, including the AI bot user agents)
// so the agentscope-core plugin does not count them as traffic.
//   Signed:   "v1.<unix seconds>.<hex HMAC-SHA256(connection token, "agentscope-check.<unix seconds>")>"
//             when the store has a traffic connection token (the plugin checks it, ±10 minutes).
//   Unsigned: "1" when there is no token (stores without a connection, most /check runs). A plugin that has a token
//             ignores "1"; a plugin without a token accepts it. Anyone could send "1" to an unconnected plugin to
//             hide their own requests; that only hides requests the sender makes itself, so it stays simple.
import { createHmac, timingSafeEqual } from "node:crypto";

export const CHECK_HEADER = "X-AgentScope-Check";
export const CHECK_MAX_SKEW_SECONDS = 600;

export function checkSignature(token: string, timestamp: string): string {
  return createHmac("sha256", token).update(`agentscope-check.${timestamp}`).digest("hex");
}

export function checkHeaderValue(token: string | null | undefined, nowSeconds = Math.floor(Date.now() / 1000)): string {
  if (!token) return "1";
  const ts = String(nowSeconds);
  return `v1.${ts}.${checkSignature(token, ts)}`;
}

// The plugin's rule, mirrored for tests: with a token only a fresh signed value counts; without one, "1" counts too.
export function isAgentScopeCheck(value: string | null | undefined, token: string | null | undefined, nowSeconds = Math.floor(Date.now() / 1000)): boolean {
  const v = (value ?? "").trim();
  if (!v) return false;
  if (!token) return v === "1" || v.startsWith("v1.");
  const m = /^v1\.(\d{9,11})\.([0-9a-f]{64})$/.exec(v);
  if (!m || Math.abs(nowSeconds - Number(m[1])) > CHECK_MAX_SKEW_SECONDS) return false;
  const expected = Buffer.from(checkSignature(token, m[1]));
  const given = Buffer.from(m[2]);
  return expected.length === given.length && timingSafeEqual(expected, given);
}
