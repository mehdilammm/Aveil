// Product name, domain and contact in one place: the final name and domain are not decided yet.
export const SITE = {
  name: "AgentScope",
  // Placeholder until the final domain is chosen.
  url: process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/+$/, "") || "https://agentscope-peach.vercel.app",
  // Placeholders until the domain and the company details are decided: shown as is on About, Contact, Security,
  // Refunds, Terms, Privacy and in the footer of every page.
  contactEmail: "contact@[domain]",
  companyName: "[Company name]",
  companyCity: "[City]",
  legalLastUpdated: "2026-10-22",
  tagline: "See why AI shopping agents skip your WooCommerce products. Fix without breaking the store. Prove it with real AI-referred orders.",
} as const;
