// AI Revenue funnel: six questions from "can agents reach the store" to "do people buy", each answered only from
// data AgentScope observed (scan findings, AI answers, plugin counts, WooCommerce orders). No estimates.
import { areaOf } from "./categories";
import type { Severity } from "./rules";
import { aiOrdersLabel } from "./ai-orders";

export type StageStatus = "ok" | "problem" | "unknown";
export type Basis = "observed" | "heuristic" | "unavailable";
export type Reason = { finding_key: string; title: string; severity: Severity; basis: Basis; evidence: string; guidance: string };
export type Stage = { key: string; question: string; status: StageStatus; basis: Basis; value: string; detail: string; reasons: Reason[] };

export type FunnelFinding = Reason & { type: string };

export type FunnelInput = {
  scanned: boolean;
  findings: FunnelFinding[];
  visibility: { asked: number; mentioned: number } | null;
  plugin: { connected: boolean; botVisits: number; aiReferrals: number; days: number };
  orders:
    | { kind: "locked" }
    | { kind: "not_synced" }
    | { kind: "unavailable"; reason: string }
    | { kind: "ok"; scanned: number; aiOrders: number; revenue: { currency: string; total: number }[]; agentCheckouts: number; days: number };
};

const RANK: Record<Severity, number> = { high: 0, medium: 1, low: 2 };
const sortReasons = (r: Reason[]) => [...r].sort((a, b) => RANK[a.severity] - RANK[b.severity] || (a.basis === "observed" ? 0 : 1) - (b.basis === "observed" ? 0 : 1));
const strip = ({ type: _t, ...r }: FunnelFinding): Reason => r;
const blocking = (f: FunnelFinding) => f.basis !== "unavailable" && (f.severity === "high" || (f.severity === "medium" && f.basis === "observed"));

export function stageOfFinding(f: { type: string; finding_key: string }): "access" | "understand" | "buy" {
  if (f.type === "checkout_blocked_bots" || f.type === "checkout_rate_limited_bots" || f.type.startsWith("access_") || f.type.startsWith("robots_")) return "access";
  if (f.type.startsWith("checkout_")) return "buy";
  const area = areaOf(f);
  return area === "access" ? "access" : "understand";
}

const money = (r: { currency: string; total: number }[]) => r.map((x) => `${x.total.toFixed(2)} ${x.currency || ""}`.trim()).join(" + ");

export function buildFunnel(input: FunnelInput): Stage[] {
  const by = { access: [] as FunnelFinding[], understand: [] as FunnelFinding[], buy: [] as FunnelFinding[] };
  for (const f of input.findings) by[stageOfFinding(f)].push(f);

  const findingStage = (key: "access" | "understand", question: string, okText: string): Stage => {
    if (!input.scanned) return { key, question, status: "unknown", basis: "unavailable", value: "No scan yet", detail: "Run a scan to answer this.", reasons: [] };
    const block = by[key].filter(blocking);
    return {
      key,
      question,
      status: block.length ? "problem" : "ok",
      basis: "observed",
      value: block.length ? `${block.length} blocking issue${block.length === 1 ? "" : "s"}` : okText,
      detail: `${by[key].length} finding${by[key].length === 1 ? "" : "s"} in the last scan.`,
      reasons: sortReasons(block.map(strip)),
    };
  };

  const stages: Stage[] = [
    findingStage("access", "Can AI agents access the store?", "No blocking issue found"),
    findingStage("understand", "Can AI agents understand the products?", "No blocking issue found"),
  ];

  const v = input.visibility;
  stages.push(
    !v || v.asked === 0
      ? { key: "recommend", question: "Do AI assistants recommend the store?", status: "unknown", basis: "unavailable", value: "Not asked yet", detail: "Run the AI Visibility questions.", reasons: [] }
      : {
          key: "recommend",
          question: "Do AI assistants recommend the store?",
          status: v.mentioned === 0 ? "problem" : "ok",
          basis: "observed",
          value: `Mentioned in ${v.mentioned} of ${v.asked} answers`,
          detail: "Latest AI Visibility run (Gemini).",
          reasons: v.mentioned === 0 ? [{ finding_key: "visibility:not_mentioned", title: "Your store was not named in any AI answer", severity: "medium", basis: "observed", evidence: `0 of ${v.asked} answers named the store.`, guidance: "See Brand profile and Share of voice for the stores named instead, and fix the product data and access issues they reveal." }] : [],
        },
  );

  const p = input.plugin;
  stages.push(
    !p.connected
      ? { key: "visit", question: "Do AI agents visit?", status: "unknown", basis: "unavailable", value: "Plugin not connected", detail: "Install and connect the WordPress plugin to count AI bot visits.", reasons: [] }
      : {
          key: "visit",
          question: "Do AI agents visit?",
          status: p.botVisits === 0 ? "problem" : "ok",
          basis: "observed",
          value: `${p.botVisits} AI bot visits in ${p.days} days`,
          detail: "Self-declared AI user agents, unverified; checker tools and AgentScope's own checks are not counted.",
          reasons: [],
        },
  );

  const o = input.orders;
  const orderReferrals = o.kind === "ok" ? o.aiOrders : 0;
  stages.push(
    !p.connected && o.kind !== "ok"
      ? { key: "referral", question: "Do people come from AI?", status: "unknown", basis: "unavailable", value: "Not measured", detail: "Needs the plugin (AI referrals) or Order Attribution (Pro).", reasons: [] }
      : {
          key: "referral",
          question: "Do people come from AI?",
          status: p.aiReferrals + orderReferrals === 0 ? "problem" : "ok",
          basis: "observed",
          value: `${p.connected ? `${p.aiReferrals} visits from AI links in ${p.days} days` : "Plugin not connected"}${o.kind === "ok" ? ` · ${aiOrdersLabel(o.aiOrders)}` : ""}`,
          detail: "Visits whose referrer is an AI assistant (plugin), and orders whose Order Attribution source is one.",
          reasons: [],
        },
  );

  const checkoutReasons = sortReasons(by.buy.map(strip));
  if (o.kind === "locked") {
    stages.push({ key: "buy", question: "Do they buy?", status: "unknown", basis: "unavailable", value: "Available on Pro and Agency", detail: "AI-referred orders and revenue come from WooCommerce Order Attribution.", reasons: checkoutReasons });
  } else if (o.kind === "not_synced") {
    stages.push({ key: "buy", question: "Do they buy?", status: "unknown", basis: "unavailable", value: "Orders not read yet", detail: "Run a scan (or Refresh orders) to read the last 90 days of orders.", reasons: checkoutReasons });
  } else if (o.kind === "unavailable") {
    stages.push({ key: "buy", question: "Do they buy?", status: "unknown", basis: "unavailable", value: "Unavailable", detail: o.reason, reasons: checkoutReasons });
  } else {
    stages.push({
      key: "buy",
      question: "Do they buy?",
      status: o.aiOrders === 0 ? "problem" : "ok",
      basis: "observed",
      value: o.aiOrders === 0 ? "No AI-referred orders yet" : `${aiOrdersLabel(o.aiOrders)} · ${money(o.revenue)}`,
      detail: `Last ${o.days} days, ${o.scanned} order${o.scanned === 1 ? "" : "s"} read. Agent checkout: ${o.agentCheckouts ? `${o.agentCheckouts} order${o.agentCheckouts === 1 ? " shows" : "s show"} agent-checkout evidence` : "not measurable yet"}.`,
      reasons: checkoutReasons,
    });
  }
  return stages;
}

// The first stage with a problem, and its reasons (blocking issues first). Checkout reasons are added when the
// problem is late in the funnel, since they stop the people who do arrive.
export function diagnose(stages: Stage[]): { stage: Stage | null; reasons: Reason[] } {
  const first = stages.find((s) => s.status === "problem") ?? null;
  if (!first) return { stage: null, reasons: [] };
  const buy = stages.find((s) => s.key === "buy");
  const late = ["visit", "referral", "buy"].includes(first.key);
  const reasons = late && buy && first.key !== "buy" ? [...first.reasons, ...buy.reasons] : first.reasons;
  return { stage: first, reasons };
}
