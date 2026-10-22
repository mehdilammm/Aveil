// Daily AI usage per workspace: every AI request AgentScope makes for a workspace is recorded in usage_events, and
// each plan has a daily request cap per provider, so one workspace cannot use up the shared free quotas.
// Costs are in micro-dollars from AI_PRICES_USD_PER_1M_TOKENS: 0 while every provider runs on its free tier.
import type { PlanId } from "./plans";

export type Provider = "gemini" | "mistral" | "groq" | "nvidia";
export const PROVIDERS: Provider[] = ["gemini", "groq", "nvidia", "mistral"];

// Requests per workspace per UTC day.
export const DAILY_REQUEST_LIMITS: Record<PlanId, Record<Provider, number>> = {
  free: { gemini: 40, groq: 200, nvidia: 100, mistral: 0 },
  pro: { gemini: 200, groq: 1000, nvidia: 300, mistral: 0 },
  agency: { gemini: 400, groq: 2000, nvidia: 600, mistral: 0 },
};

// Free tiers: no charge. Set real prices here before enabling a paid tier.
export const AI_PRICES_USD_PER_1M_TOKENS: Record<Provider, { input: number; output: number }> = {
  gemini: { input: 0, output: 0 },
  groq: { input: 0, output: 0 },
  nvidia: { input: 0, output: 0 },
  mistral: { input: 0, output: 0 },
};

export const WARN_AT = 0.8;

export type ProviderUsage = { requests: number; input: number; output: number };

export function costMicros(provider: Provider, u: ProviderUsage): number {
  const p = AI_PRICES_USD_PER_1M_TOKENS[provider];
  return Math.round(u.input * p.input + u.output * p.output); // per 1M tokens → micro-dollars per token
}

export type CapLevel = "ok" | "warn" | "reached";
export type CapStatus = { provider: Provider; used: number; limit: number; level: CapLevel };

export function capStatus(plan: PlanId, used: Partial<Record<Provider, number>>): CapStatus[] {
  return PROVIDERS.filter((p) => DAILY_REQUEST_LIMITS[plan][p] > 0).map((provider) => {
    const limit = DAILY_REQUEST_LIMITS[plan][provider];
    const n = used[provider] ?? 0;
    return { provider, used: n, limit, level: n >= limit ? "reached" : n >= limit * WARN_AT ? "warn" : "ok" };
  });
}

// Whether `extra` more requests fit today's cap.
export function fitsCap(plan: PlanId, provider: Provider, usedToday: number, extra = 1): boolean {
  return usedToday + extra <= DAILY_REQUEST_LIMITS[plan][provider];
}

export const utcDay = (d = new Date()) => d.toISOString().slice(0, 10);
