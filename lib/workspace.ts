import "server-only";
import { createHash, randomBytes } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { getUser } from "./supabase/server";

type Client = Awaited<ReturnType<typeof getUser>>["supabase"];

export type Role = "owner" | "admin" | "viewer";
export type Workspace = { id: string; name: string; personal: boolean; role: Role };

export const INVITE_DAYS = 7;

export const canEdit = (role: Role | null | undefined) => role === "owner" || role === "admin";

// The workspaces of the signed-in user, with their role (RLS returns only their own memberships' workspaces).
export async function listWorkspaces(supabase: Client, userId: string): Promise<Workspace[]> {
  const { data } = await supabase.from("workspace_members").select("role, workspaces(id, name, personal)").eq("user_id", userId);
  return (data ?? [])
    .map((m) => {
      const w = (Array.isArray(m.workspaces) ? m.workspaces[0] : m.workspaces) as { id: string; name: string; personal: boolean } | null;
      return w ? { id: w.id, name: w.name, personal: w.personal, role: m.role as Role } : null;
    })
    .filter((w): w is Workspace => !!w)
    .sort((a, b) => Number(b.personal) - Number(a.personal) || a.name.localeCompare(b.name));
}

// Every user gets a personal workspace (created by the server on first use).
export async function ensurePersonalWorkspace(admin: SupabaseClient, userId: string): Promise<string> {
  const { data: existing } = await admin.from("workspaces").select("id").eq("created_by", userId).eq("personal", true).maybeSingle();
  if (existing) return existing.id;
  const { data: created, error } = await admin.from("workspaces").insert({ name: "Personal", personal: true, created_by: userId }).select("id").single();
  if (error || !created) {
    // A parallel request may have created it.
    const { data: again } = await admin.from("workspaces").select("id").eq("created_by", userId).eq("personal", true).maybeSingle();
    if (again) return again.id;
    throw new Error("could not create the personal workspace");
  }
  await admin.from("workspace_members").insert({ workspace_id: created.id, user_id: userId, role: "owner" });
  return created.id;
}

// The store as the signed-in user sees it (RLS) and their role in its workspace.
export type StoreAccess = { id: string; name: string; url: string; owner_id: string; workspace_id: string; role: Role };
export async function storeAccess(supabase: Client, userId: string, storeId: string): Promise<StoreAccess | null> {
  const { data: store } = await supabase.from("stores").select("id, name, url, owner_id, workspace_id").eq("id", storeId).maybeSingle();
  if (!store) return null;
  const { data: m } = await supabase.from("workspace_members").select("role").eq("workspace_id", store.workspace_id).eq("user_id", userId).maybeSingle();
  return m ? { ...store, role: m.role as Role } : null;
}

export function newInviteToken(): { token: string; hash: string } {
  const token = `agsi_${randomBytes(24).toString("base64url")}`;
  return { token, hash: hashInviteToken(token) };
}

export function hashInviteToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export type InviteRow = { workspace_id: string; role: "admin" | "viewer"; email: string | null; expires_at: string; accepted_at: string | null; revoked_at: string | null };

// Why an invite cannot be accepted by this user, or null when it can.
export function inviteProblem(invite: InviteRow | null, userEmail: string | null | undefined, now = new Date()): string | null {
  if (!invite) return "This invite link is not valid.";
  if (invite.revoked_at) return "This invite was cancelled.";
  if (invite.accepted_at) return "This invite was already used.";
  if (Date.parse(invite.expires_at) <= now.getTime()) return "This invite has expired. Ask for a new link.";
  if (invite.email && invite.email.toLowerCase() !== (userEmail ?? "").toLowerCase()) return `This invite is for ${invite.email}. Sign in with that email.`;
  return null;
}
