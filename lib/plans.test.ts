import { beforeEach, describe, expect, it, vi } from "vitest";
import { createTranslator } from "next-intl";
import ar from "../messages/ar.json";
import en from "../messages/en.json";
import { isPaidPlan, planFor, PLAN_ORDER, PLANS } from "./plans";

vi.mock("server-only", () => ({}));
const insert = vi.fn();
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ from: () => ({ insert }) }) }));

describe("plans", () => {
  it("prices and limits come from one config", () => {
    expect(PLAN_ORDER.map((id) => [id, PLANS[id].priceUsdPerMonth, PLANS[id].stores])).toEqual([["free", 0, 1], ["pro", 29, 3], ["agency", 49, 10]]);
    expect(PLANS.free).toMatchObject({ scanEvery: "month", visibilityQuestions: 3, visibilityPer: "month", sampleProducts: 5, cta: "signup", autoFix: false, botTraffic: false, shareReports: false, aiRevenue: false, workspaceMembers: false });
    expect(PLANS.pro).toMatchObject({ scanEvery: "week", visibilityQuestions: 25, visibilityPer: "week", sampleProducts: 50, cta: "waitlist", autoFix: true, botTraffic: true, shareReports: true, aiRevenue: true, workspaceMembers: false, clientReports: false });
    expect(PLANS.agency).toMatchObject({ workspaceMembers: true, clientReports: true, autoFix: true, botTraffic: true, cta: "waitlist" });
    expect([planFor("autoFix"), planFor("botTraffic"), planFor("shareReports"), planFor("workspaceMembers"), planFor("clientReports")]).toEqual(["pro", "pro", "pro", "agency", "agency"]);
    expect([isPaidPlan("pro"), isPaidPlan("agency"), isPaidPlan("free")]).toEqual([true, true, false]);
  });
});

describe("pricing features", () => {
  it("every plan feature has text in both languages, filled from the limits", () => {
    for (const [locale, messages] of [["en", en], ["ar", ar]] as const) {
      const t = createTranslator({ locale, messages, namespace: "pricingPage" });
      for (const id of PLAN_ORDER) for (const f of PLANS[id].features) expect(t(`f.${f}` as "f.stores", { stores: PLANS[id].stores, questions: PLANS[id].visibilityQuestions, per: PLANS[id].visibilityPer, sample: 5 })).not.toMatch(/[{}]|pricingPage/);
    }
    const t = createTranslator({ locale: "en", messages: en, namespace: "pricingPage" });
    expect(t("f.visibility", { questions: 3, per: "month" })).toBe("AI visibility: 3 questions a month");
    expect(t("f.visibility", { questions: 25, per: "week" })).toBe("AI visibility: 25 questions a week");
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
