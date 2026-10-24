// Plans and their limits, in one place, for the pricing page now and for enforcement later.
export type PlanId = "free" | "pro" | "agency";

export type Plan = {
  id: PlanId;
  name: string;
  priceUsdPerMonth: number;
  stores: number;
  // Scheduled full scans (manual scans are open on every plan, to check fixes).
  scanEvery: "month" | "week";
  visibilityQuestions: number;
  visibilityPer: "month" | "week";
  // Smart sampling: product pages checked one by one (structured data, schema source), best sellers first.
  sampleProducts: number;
  // Workspaces other than the personal one, team members and invites.
  workspaceMembers: boolean;
  // AI-referred orders and revenue on the AI Revenue page (the funnel itself is in every plan).
  aiRevenue: boolean;
  autoFix: boolean;
  // The Traffic page: verified AI bot visits per bot and page (the plugin's counts still feed the free funnel).
  botTraffic: boolean;
  // Read-only share links and the weekly report.
  shareReports: boolean;
  // Share links carry "Prepared by <workspace>" for client reporting.
  clientReports: boolean;
  // Catalog keys under pricing.f (values filled from the limits above).
  features: string[];
  // Until payments exist, paid plans only collect waitlist sign-ups.
  cta: "signup" | "waitlist";
};

export const PLANS: Record<PlanId, Plan> = {
  free: {
    id: "free",
    name: "Free",
    priceUsdPerMonth: 0,
    stores: 1,
    scanEvery: "month",
    visibilityQuestions: 3,
    visibilityPer: "month",
    sampleProducts: 5,
    workspaceMembers: false,
    aiRevenue: false,
    autoFix: false,
    botTraffic: false,
    shareReports: false,
    clientReports: false,
    features: ["publicCheck", "stores", "monthlyScan", "fixCenter", "visibility", "funnelNoOrders", "csv"],
    cta: "signup",
  },
  pro: {
    id: "pro",
    name: "Pro",
    priceUsdPerMonth: 29,
    stores: 3,
    scanEvery: "week",
    visibilityQuestions: 25,
    visibilityPer: "week",
    sampleProducts: 50,
    workspaceMembers: false,
    aiRevenue: true,
    autoFix: true,
    botTraffic: true,
    shareReports: true,
    clientReports: false,
    features: ["stores", "weeklyScan", "fixCenter", "autoFix", "visibility", "botTraffic", "aiOrders", "shareReports"],
    cta: "waitlist",
  },
  agency: {
    id: "agency",
    name: "Agency",
    priceUsdPerMonth: 49,
    stores: 10,
    scanEvery: "week",
    visibilityQuestions: 25,
    visibilityPer: "week",
    sampleProducts: 50,
    workspaceMembers: true,
    aiRevenue: true,
    autoFix: true,
    botTraffic: true,
    shareReports: true,
    clientReports: true,
    features: ["stores", "everythingPro", "workspaces", "clientReports"],
    cta: "waitlist",
  },
};

export type PlanFeature = "autoFix" | "botTraffic" | "shareReports" | "aiRevenue" | "workspaceMembers" | "clientReports";
// The cheapest plan that has a feature, for "needs Pro plan" messages.
export const planFor = (f: PlanFeature): PlanId => (PLANS.pro[f] ? "pro" : "agency");
export const RUN_DAYS: Record<Plan["visibilityPer"], number> = { week: 7, month: 30 };

export const PLAN_ORDER: PlanId[] = ["free", "pro", "agency"];
export const isPaidPlan = (id: string): id is "pro" | "agency" => id === "pro" || id === "agency";
