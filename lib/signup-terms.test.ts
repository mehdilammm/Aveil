import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const signUp = vi.fn();
vi.mock("next/headers", () => ({ headers: async () => new Headers({ origin: "https://app.test" }) }));
vi.mock("next/navigation", () => ({ redirect: () => { throw new Error("redirect"); } }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ auth: { signUp } }) }));

describe("sign up needs the Terms checkbox", () => {
  const form = (agree: boolean) => {
    const f = new FormData();
    f.set("email", "a@b.co");
    f.set("password", "long-enough-password");
    if (agree) f.set("agree", "yes");
    return f;
  };

  it("without the box: refused, nothing sent to Supabase", async () => {
    const { signUp: action } = await import("@/app/login/actions");
    expect((await action({}, form(false))).error).toContain("Terms");
    expect(signUp).not.toHaveBeenCalled();
  });

  it("with the box: account created", async () => {
    const { signUp: action } = await import("@/app/login/actions");
    signUp.mockResolvedValueOnce({ data: { session: null }, error: null });
    expect(await action({}, form(true))).toEqual({ notice: "Check your email to confirm your account, then log in." });
    expect(signUp).toHaveBeenCalledTimes(1);
  });
});
