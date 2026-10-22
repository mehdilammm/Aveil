import { beforeEach, describe, expect, it, vi } from "vitest";
import { isPaidPlan, PLAN_ORDER, PLANS } from "./plans";

vi.mock("server-only", () => ({}));
const insert = vi.fn();
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ from: () => ({ insert }) }) }));

describe("plans", () => {
  it("prices and limits come from one config", () => {
    expect(PLAN_ORDER.map((id) => [id, PLANS[id].priceUsdPerMonth, PLANS[id].stores])).toEqual([["free", 0, 1], ["pro", 29, 3], ["agency", 49, 10]]);
    expect(PLANS.free).toMatchObject({ scanEvery: "month", visibilityQuestions: 5, visibilityPer: "month", cta: "signup" });
    expect(PLANS.pro).toMatchObject({ scanEvery: "week", visibilityQuestions: 15, visibilityPer: "week", cta: "waitlist" });
    expect(PLANS.agency).toMatchObject({ workspaceMembers: true, cta: "waitlist" });
    expect([isPaidPlan("pro"), isPaidPlan("agency"), isPaidPlan("free")]).toEqual([true, true, false]);
  });
});

describe("waitlist", () => {
  beforeEach(() => insert.mockReset());
  const form = (fields: Record<string, string>) => {
    const f = new FormData();
    for (const [k, v] of Object.entries(fields)) f.set(k, v);
    return f;
  };

  it("saves a paid plan with a lowercased email; a duplicate is fine", async () => {
    const { joinWaitlist } = await import("@/app/pricing/actions");
    insert.mockResolvedValueOnce({ error: null });
    expect(await joinWaitlist({}, form({ plan: "pro", email: " Owner@Shop.MA " }))).toEqual({ done: true });
    expect(insert).toHaveBeenCalledWith({ plan: "pro", email: "owner@shop.ma" });
    insert.mockResolvedValueOnce({ error: { code: "23505" } });
    expect(await joinWaitlist({}, form({ plan: "agency", email: "a@b.co" }))).toEqual({ done: true });
  });

  it("refuses unknown plans and bad emails; the honeypot saves nothing", async () => {
    const { joinWaitlist } = await import("@/app/pricing/actions");
    expect((await joinWaitlist({}, form({ plan: "free", email: "a@b.co" }))).error).toBeTruthy();
    expect((await joinWaitlist({}, form({ plan: "pro", email: "nope" }))).error).toBeTruthy();
    expect(await joinWaitlist({}, form({ plan: "pro", email: "a@b.co", website: "spam" }))).toEqual({ done: true });
    expect(insert).not.toHaveBeenCalled();
  });
});
