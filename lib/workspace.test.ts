import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

describe("workspace invites and roles", () => {
  it("only owner and admin can edit", async () => {
    const { canEdit } = await import("./workspace");
    expect([canEdit("owner"), canEdit("admin"), canEdit("viewer"), canEdit(null)]).toEqual([true, true, false, false]);
  });

  it("tokens are random and only their hash is stored", async () => {
    const { newInviteToken, hashInviteToken } = await import("./workspace");
    const a = newInviteToken();
    const b = newInviteToken();
    expect(a.token).toMatch(/^agsi_[A-Za-z0-9_-]{32}$/);
    expect(a.token).not.toBe(b.token);
    expect(a.hash).toBe(hashInviteToken(a.token));
    expect(a.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(a.hash).not.toContain(a.token);
  });

  it("an invite is refused when unknown, cancelled, used, expired or for another email", async () => {
    const { inviteProblem } = await import("./workspace");
    const now = new Date("2026-10-22T12:00:00Z");
    const ok = { workspace_id: "w", role: "viewer" as const, email: null, expires_at: "2026-10-29T12:00:00Z", accepted_at: null, revoked_at: null };
    expect(inviteProblem(ok, "a@b.co", now)).toBeNull();
    expect(inviteProblem(null, "a@b.co", now)).toContain("not valid");
    expect(inviteProblem({ ...ok, revoked_at: "x" }, "a@b.co", now)).toContain("cancelled");
    expect(inviteProblem({ ...ok, accepted_at: "x" }, "a@b.co", now)).toContain("already used");
    expect(inviteProblem({ ...ok, expires_at: "2026-10-22T11:59:59Z" }, "a@b.co", now)).toContain("expired");
    expect(inviteProblem({ ...ok, email: "Team@Shop.ma" }, "team@shop.ma", now)).toBeNull();
    expect(inviteProblem({ ...ok, email: "team@shop.ma" }, "other@shop.ma", now)).toContain("team@shop.ma");
  });
});
