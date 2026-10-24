// Product name, domain and contact in one place: the final name and domain are not decided yet.
export const SITE = {
  name: "AgentScope",
  // Placeholder until the final domain is chosen.
  url: process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/+$/, "") || "https://agentscope-peach.vercel.app",
  // Placeholder contact address, shown in Terms and Privacy.
  contactEmail: "contact@example.com",
  legalLastUpdated: "2026-10-22",
  tagline: "See why AI shopping agents skip your WooCommerce products. Fix without breaking the store. Prove it with real AI-referred orders.",
} as const;
