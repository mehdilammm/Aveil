// Agentic checkout support (G9, information only): whether the store publishes a Universal Commerce Protocol
// business profile (/.well-known/ucp, ucp.dev) or an Agentic Commerce Protocol discovery document
// (/.well-known/acp.json, agentic-commerce-protocol spec 2026-04-17), and whether an active plugin says it adds
// agent checkout. Only what the store serves or reports is used; nothing here is a ranking or a requirement.
import type { Source } from "./pages";
import type { Finding } from "./rules";
import type { RobotsFetch } from "./robots";

export type Detected = { kind: "ucp" | "acp" | "plugin"; label: string; detail: string };
type Doc = { state: "valid"; detail: string } | { state: "partial"; detail: string } | { state: "absent"; detail: string } | { state: "unavailable"; detail: string };

function json(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

export function readUcp(url: string, res: Source<RobotsFetch>): Doc {
  if (!res.ok) return { state: "unavailable", detail: res.reason };
  const { status, text } = res.data;
  if (status < 200 || status >= 300) return { state: "absent", detail: `${url} answered HTTP ${status}.` };
  const ucp = (json(text) as { ucp?: { version?: unknown; capabilities?: unknown; services?: unknown } } | null)?.ucp;
  if (!ucp || typeof ucp.version !== "string") return { state: "absent", detail: `${url} is not a UCP profile (no "ucp.version").` };
  const caps = ucp.capabilities && typeof ucp.capabilities === "object" ? Object.keys(ucp.capabilities as object) : [];
  const services = ucp.services && typeof ucp.services === "object" ? Object.keys(ucp.services as object) : [];
  const checkout = caps.includes("dev.ucp.shopping.checkout");
  const detail = `${url}: UCP ${ucp.version}${services.length ? `, services ${services.join(", ")}` : ""}${caps.length ? `, capabilities ${caps.slice(0, 6).join(", ")}` : ""}.`;
  return checkout ? { state: "valid", detail } : { state: "partial", detail: `${detail} No checkout capability (dev.ucp.shopping.checkout).` };
}

export function readAcp(url: string, res: Source<RobotsFetch>): Doc {
  if (!res.ok) return { state: "unavailable", detail: res.reason };
  const { status, text } = res.data;
  if (status < 200 || status >= 300) return { state: "absent", detail: `${url} answered HTTP ${status}.` };
  const doc = json(text) as { protocol?: { name?: unknown; version?: unknown }; capabilities?: { services?: unknown } } | null;
  if (doc?.protocol?.name !== "acp") return { state: "absent", detail: `${url} is not an ACP discovery document (no protocol.name "acp").` };
  const services = Array.isArray(doc.capabilities?.services) ? (doc.capabilities!.services as unknown[]).filter((s): s is string => typeof s === "string") : [];
  const detail = `${url}: ACP ${typeof doc.protocol.version === "string" ? doc.protocol.version : "(no version)"}${services.length ? `, services ${services.join(", ")}` : ""}.`;
  return services.includes("checkout") ? { state: "valid", detail } : { state: "partial", detail: `${detail} The checkout service is not listed.` };
}

// Plugins whose own name or folder says they add agent checkout or one of the two protocols.
const PLUGIN_RE = /agentcart|agentic[\s_-]*(checkout|commerce)|universal[\s_-]*commerce[\s_-]*protocol|agentic[\s_-]*commerce[\s_-]*protocol|(^|[\s/_-])(ucp|acp)([\s/_.-]|$)/i;
export function agenticPlugins(plugins: { plugin: string; name: string; version: string }[]) {
  return plugins.filter((p) => PLUGIN_RE.test(p.name) || PLUGIN_RE.test(p.plugin.split("/")[0] ?? ""));
}

export function checkAgenticSupport(storeUrl: string, input: { ucp: Source<RobotsFetch>; acp: Source<RobotsFetch>; plugins: Source<{ plugin: string; name: string; version: string }[]> }): Finding {
  const ucp = readUcp(`${storeUrl}/.well-known/ucp`, input.ucp);
  const acp = readAcp(`${storeUrl}/.well-known/acp.json`, input.acp);
  const plugins = input.plugins.ok ? agenticPlugins(input.plugins.data) : null;
  const found: string[] = [];
  if (ucp.state === "valid" || ucp.state === "partial") found.push(`UCP profile${ucp.state === "partial" ? " (no checkout)" : ""}`);
  if (acp.state === "valid" || acp.state === "partial") found.push(`ACP discovery${acp.state === "partial" ? " (no checkout)" : ""}`);
  for (const p of plugins ?? []) found.push(`plugin "${p.name}"`);
  const pluginLine = input.plugins.ok
    ? plugins!.length ? `Active plugins: ${plugins!.map((p) => `${p.name} ${p.version}`.trim()).join(", ")}.` : `No active plugin names agent checkout, UCP or ACP (${input.plugins.data.length} active ${input.plugins.data.length === 1 ? "plugin" : "plugins"}).`
    : `Plugins: Unavailable: ${input.plugins.reason}`;
  const unavailable = ucp.state === "unavailable" && acp.state === "unavailable";
  return {
    finding_key: "agentic:checkout",
    type: "agentic_checkout_support",
    product_id: null,
    title: (found.length ? `Agentic checkout support found: ${found.join(", ")} (information only)` : unavailable ? "Agentic checkout support could not be checked (information only)" : "No agentic checkout protocol found (information only)").slice(0, 200),
    severity: "low",
    basis: unavailable && !found.length ? "unavailable" : "observed",
    evidence: [ucp.detail, acp.detail, pluginLine, "The ChatGPT product feed (ACP) is sent to OpenAI, not published on the store, so it cannot be checked here."].join(" ").slice(0, 1500),
    guidance: found.length
      ? "Information only. A published profile or plugin says agents may check out; whether an agent uses it depends on that agent. AI-referred and agent orders are on the AI Revenue page."
      : "Information only, not required today. UCP (/.well-known/ucp) and ACP (/.well-known/acp.json) are open protocols that let AI agents discover a store and check out without a browser. Most stores sell to agents through their normal checkout.",
    fix_url: `${storeUrl}/.well-known/ucp`,
  };
}
