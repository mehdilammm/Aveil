// AI-referred orders: WooCommerce Order Attribution (meta _wc_order_attribution_*) says where the buyer's session came
// from. An order is "AI-referred" when that source is an AI assistant (a person clicked a link in an AI answer and
// bought). That is not "an agent bought": agent checkout is only reported with evidence on the order itself.
// Only derived, non-personal fields are kept: order id, date, total, currency, AI source, how it was matched, entry path.

export const ORDER_WINDOW_DAYS = 90;
export const MAX_ORDERS = 1000;
export const ATTRIBUTION_PREFIX = "_wc_order_attribution_";
// The attribution keys read from each order (the request asks for these only; never names, emails or addresses).
// The plugin's fallback (agentscope-core 1.4+, opt-in): AI source noted in the WooCommerce session, saved on the order.
export const PLUGIN_KEYS = { source: "_agsc_ai_referral_source", via: "_agsc_ai_referral_via", entry: "_agsc_ai_referral_entry" } as const;
export const ATTRIBUTION_KEYS = [...["source_type", "utm_source", "utm_medium", "referrer", "session_entry"].map((k) => `${ATTRIBUTION_PREFIX}${k}`), ...Object.values(PLUGIN_KEYS)];

// AI assistants, by referrer domain and utm_source value. Extend here.
export const AI_REFERRAL_SOURCES: { source: string; domains: string[]; utm: string[] }[] = [
  { source: "ChatGPT", domains: ["chatgpt.com", "chat.openai.com"], utm: ["chatgpt.com", "chatgpt", "openai"] },
  { source: "Perplexity", domains: ["perplexity.ai"], utm: ["perplexity", "perplexity.ai"] },
  { source: "Gemini", domains: ["gemini.google.com", "bard.google.com"], utm: ["gemini", "gemini.google.com", "bard"] },
  { source: "Copilot", domains: ["copilot.microsoft.com"], utm: ["copilot", "copilot.microsoft.com"] },
  { source: "Claude", domains: ["claude.ai"], utm: ["claude", "claude.ai"] },
  { source: "DeepSeek", domains: ["chat.deepseek.com"], utm: ["deepseek", "chat.deepseek.com"] },
  { source: "Meta AI", domains: ["meta.ai"], utm: ["meta.ai"] },
  { source: "Grok", domains: ["grok.com"], utm: ["grok", "grok.com"] },
  { source: "Mistral Le Chat", domains: ["chat.mistral.ai"], utm: ["chat.mistral.ai", "lechat"] },
];

// Evidence that an AI agent placed the order itself (no WooCommerce core marker exists today; the Agentic Checkout
// API was removed from core in WooCommerce 11.2). Matched against the order's created_via.
export const AGENT_CHECKOUT_CREATED_VIA = /agentic|(^|[^a-z])acp([^a-z]|$)|instant[-_ ]?checkout|chatgpt|openai/i;

export type WooOrder = { id: number; date_created_gmt?: string; total?: string; currency?: string; status?: string; created_via?: string; meta_data?: { key: string; value: unknown }[] };
export type AiMatch = { source: string; via: "utm_source" | "referrer" | "session_entry" | "plugin" };
export type AiOrder = { order_id: number; ordered_at: string; total: number; currency: string; source: string; via: AiMatch["via"]; entry_path: string | null; agent_checkout: boolean };

function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return null;
  }
}

const byDomain = (host: string | null) =>
  host ? AI_REFERRAL_SOURCES.find((s) => s.domains.some((d) => host === d || host.endsWith(`.${d}`))) : undefined;
const byUtm = (value: string | null | undefined) => {
  const v = (value ?? "").trim().toLowerCase();
  return v ? AI_REFERRAL_SOURCES.find((s) => s.utm.includes(v)) : undefined;
};

function metaValue(order: WooOrder, key: string): string | undefined {
  const m = (order.meta_data ?? []).find((x) => x?.key === key);
  return m && (typeof m.value === "string" || typeof m.value === "number") ? String(m.value) : undefined;
}

// The plugin's note, when WooCommerce attribution did not match: source must be one of the configured sources.
export function pluginMatch(order: WooOrder): (AiMatch & { entry: string | null }) | null {
  const source = metaValue(order, PLUGIN_KEYS.source);
  if (!source || !AI_REFERRAL_SOURCES.some((s) => s.source === source)) return null;
  const entry = metaValue(order, PLUGIN_KEYS.entry);
  return { source, via: "plugin", entry: entry && entry.startsWith("/") ? entry.slice(0, 200) : null };
}

export function attributionOf(order: WooOrder): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of order.meta_data ?? []) {
    if (typeof m?.key === "string" && m.key.startsWith(ATTRIBUTION_PREFIX) && (typeof m.value === "string" || typeof m.value === "number")) {
      out[m.key.slice(ATTRIBUTION_PREFIX.length)] = String(m.value);
    }
  }
  return out;
}

// utm_source first (set by the AI link), then the referrer, then utm_source in the entry URL.
export function classifyAttribution(a: Record<string, string>): AiMatch | null {
  const utm = byUtm(a.utm_source);
  if (utm) return { source: utm.source, via: "utm_source" };
  const ref = byDomain(a.referrer ? hostOf(a.referrer) : null);
  if (ref) return { source: ref.source, via: "referrer" };
  if (a.session_entry) {
    try {
      const entry = byUtm(new URL(a.session_entry).searchParams.get("utm_source"));
      if (entry) return { source: entry.source, via: "session_entry" };
    } catch {
      // not a URL
    }
  }
  return null;
}

// Path only: the query string can carry personal data (emails, tokens).
export function entryPath(sessionEntry: string | undefined): string | null {
  if (!sessionEntry) return null;
  try {
    return new URL(sessionEntry).pathname.slice(0, 200) || "/";
  } catch {
    return null;
  }
}

export type OrdersSummary = {
  scanned: number;
  withAttribution: number;
  aiOrders: AiOrder[];
  agentCheckouts: number;
};

export function summarizeOrders(orders: WooOrder[]): OrdersSummary {
  let withAttribution = 0;
  let agentCheckouts = 0;
  const aiOrders: AiOrder[] = [];
  for (const o of orders) {
    const a = attributionOf(o);
    if (a.source_type || metaValue(o, PLUGIN_KEYS.source)) withAttribution++;
    const agent = AGENT_CHECKOUT_CREATED_VIA.test(o.created_via ?? "");
    if (agent) agentCheckouts++;
    const plugin = pluginMatch(o);
    const match = classifyAttribution(a) ?? plugin;
    if (!match) continue;
    const total = Number(o.total);
    aiOrders.push({
      order_id: o.id,
      ordered_at: o.date_created_gmt ? new Date(`${o.date_created_gmt.replace(/Z$/, "")}Z`).toISOString() : new Date(0).toISOString(),
      total: Number.isFinite(total) ? Math.round(total * 100) / 100 : 0,
      currency: /^[A-Z]{3}$/.test(o.currency ?? "") ? o.currency! : "",
      source: match.source,
      via: match.via,
      entry_path: match.via === "plugin" ? plugin?.entry ?? null : entryPath(a.session_entry),
      agent_checkout: agent,
    });
  }
  return { scanned: orders.length, withAttribution, aiOrders, agentCheckouts };
}

export type SyncStatus = { status: "ok" | "unavailable"; reason: string | null };

// Order Attribution off, or the data not reachable: say so instead of reporting 0 AI orders.
export function attributionStatus(s: OrdersSummary): SyncStatus {
  if (s.scanned > 0 && s.withAttribution === 0) {
    return {
      status: "unavailable",
      reason: `None of the ${s.scanned} orders of the last ${ORDER_WINDOW_DAYS} days has Order Attribution data, so AI-referred orders cannot be counted. Turn it on in WooCommerce → Settings → Advanced → Features → Order attribution (WooCommerce 8.5 or later); only orders placed after that are attributed.`,
    };
  }
  return { status: "ok", reason: null };
}

export function revenueByCurrency(orders: Pick<AiOrder, "total" | "currency">[]): { currency: string; total: number; orders: number }[] {
  const m = new Map<string, { total: number; orders: number }>();
  for (const o of orders) {
    const e = m.get(o.currency) ?? { total: 0, orders: 0 };
    e.total = Math.round((e.total + o.total) * 100) / 100;
    e.orders++;
    m.set(o.currency, e);
  }
  return [...m.entries()].map(([currency, v]) => ({ currency, ...v })).sort((a, b) => b.total - a.total);
}
