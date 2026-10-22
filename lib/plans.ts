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
  workspaceMembers: boolean;
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
    workspaceMembers: false,
    features: ["Public check of any store", "1 store", "Full scan once a month", "AI visibility: 5 questions a month"],
    cta: "signup",
  },
  pro: {
    id: "pro",
    name: "Pro",
    priceUsdPerMonth: 29,
    stores: 3,
    scanEvery: "week",
    visibilityQuestions: 15,
    visibilityPer: "week",
    workspaceMembers: false,
    features: ["3 stores", "Weekly scans", "AI visibility: 15 questions a week", "Fix Center", "CSV exports", "AI traffic plugin"],
    cta: "waitlist",
  },
  agency: {
    id: "agency",
    name: "Agency",
    priceUsdPerMonth: 49,
    stores: 10,
    scanEvery: "week",
    visibilityQuestions: 15,
    visibilityPer: "week",
    workspaceMembers: true,
    features: ["10 stores", "Workspaces and team members", "Client reports", "Everything in Pro"],
    cta: "waitlist",
  },
};

export const PLAN_ORDER: PlanId[] = ["free", "pro", "agency"];
export const isPaidPlan = (id: string): id is "pro" | "agency" => id === "pro" || id === "agency";
