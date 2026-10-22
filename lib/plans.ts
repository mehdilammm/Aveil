// Plans and their limits, in one place, for the pricing page now and for enforcement later.
export type PlanId = "free" | "pro" | "agency";

export type Plan = {
  id: PlanId;
  name: string;
  priceUsdPerMonth: number;
  stores: number;
  scanEvery: "month" | "week";
  visibilityQuestions: number;
  visibilityPer: "month" | "week";
  // Smart sampling: product pages checked one by one (structured data, schema source), best sellers first.
  sampleProducts: number;
  workspaceMembers: boolean;
  // AI-referred orders and revenue on the AI Revenue page (the funnel itself is in every plan).
  aiRevenue: boolean;
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
    visibilityQuestions: 5,
    visibilityPer: "month",
    sampleProducts: 5,
    workspaceMembers: false,
    aiRevenue: false,
    features: ["Public check of any store", "1 store", "Full scan once a month", "AI visibility: 5 questions a month", "Product page checks on the top 5 products", "AI Revenue funnel and \"why agents aren't buying\" (without orders)"],
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
    features: ["3 stores", "Weekly scans", "AI visibility: 25 questions a week", "Product page checks on the top 50 products", "AI-referred orders and revenue", "Fix Center", "CSV exports", "AI traffic plugin"],
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
    features: ["10 stores", "Workspaces and team members", "Client reports", "AI-referred orders and revenue", "Everything in Pro"],
    cta: "waitlist",
  },
};

export const PLAN_ORDER: PlanId[] = ["free", "pro", "agency"];
export const isPaidPlan = (id: string): id is "pro" | "agency" => id === "pro" || id === "agency";
