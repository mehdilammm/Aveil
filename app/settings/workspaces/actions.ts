"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import { getUser } from "@/lib/supabase/server";
import { hashInviteToken, INVITE_DAYS, inviteProblem, newInviteToken, type InviteRow } from "@/lib/workspace";

export type WsState = { error?: string; link?: string; done?: string };

async function signedIn() {
  const { supabase, user } = await getUser();
  if (!user) redirect("/login");
  return { supabase, user };
}

// Only the owner manages members and invites. Checked as the user (RLS), then written with the service role.
async function ownerOf(workspaceId: string) {
  const { supabase, user } = await signedIn();
  const { data: m } = await supabase.from("workspace_members").select("role").eq("workspace_id", workspaceId).eq("user_id", user.id).maybeSingle();
  return { user, isOwner: m?.role === "owner" };
}

export async function createWorkspace(_: WsState, form: FormData): Promise<WsState> {
  const { user } = await signedIn();
  const name = String(form.get("name") ?? "").replace(/\s+/g, " ").trim();
  if (name.length < 1 || name.length > 80) return { error: "Enter a name (up to 80 characters)." };
  const admin = createAdminClient();
  const { data: ws, error } = await admin.from("workspaces").insert({ name, personal: false, created_by: user.id }).select("id").single();
  if (error || !ws) return { error: "Could not create the workspace." };
  const { error: mErr } = await admin.from("workspace_members").insert({ workspace_id: ws.id, user_id: user.id, role: "owner" });
  if (mErr) {
    await admin.from("workspaces").delete().eq("id", ws.id);
    return { error: "Could not create the workspace." };
  }
  revalidatePath("/settings/workspaces");
  return { done: `Workspace "${name}" created.` };
}

// An invite link (valid INVITE_DAYS days, single use). Only its hash is stored; the link is shown once.
export async function createInvite(_: WsState, form: FormData): Promise<WsState> {
  const workspaceId = String(form.get("workspace_id") ?? "");
  const role = String(form.get("role") ?? "viewer");
  const email = String(form.get("email") ?? "").trim().toLowerCase() || null;
  if (role !== "admin" && role !== "viewer") return { error: "Pick Admin or Viewer." };
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { error: "That email does not look valid." };
  const { user, isOwner } = await ownerOf(workspaceId);
  if (!isOwner) return { error: "Only the workspace owner can invite members." };
  const { token, hash } = newInviteToken();
  const { error } = await createAdminClient().from("workspace_invites").insert({
    workspace_id: workspaceId, role, email, token_hash: hash, created_by: user.id, expires_at: new Date(Date.now() + INVITE_DAYS * 86_400_000).toISOString(),
  });
  if (error) return { error: "Could not create the invite." };
  const base = process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/+$/, "") ?? "";
  revalidatePath("/settings/workspaces");
  return { link: `${base}/invite/${token}` };
}

export async function revokeInvite(form: FormData): Promise<void> {
  const workspaceId = String(form.get("workspace_id") ?? "");
  const { isOwner } = await ownerOf(workspaceId);
  if (!isOwner) return;
  await createAdminClient().from("workspace_invites").update({ revoked_at: new Date().toISOString() }).eq("id", String(form.get("invite_id") ?? "")).eq("workspace_id", workspaceId).is("accepted_at", null);
  revalidatePath("/settings/workspaces");
}

export async function removeMember(form: FormData): Promise<void> {
  const workspaceId = String(form.get("workspace_id") ?? "");
  const userId = String(form.get("user_id") ?? "");
  const { user, isOwner } = await ownerOf(workspaceId);
  if (!isOwner || userId === user.id) return; // the owner stays
  await createAdminClient().from("workspace_members").delete().eq("workspace_id", workspaceId).eq("user_id", userId).neq("role", "owner");
  revalidatePath("/settings/workspaces");
}

export async function acceptInvite(_: WsState, form: FormData): Promise<WsState> {
  const { user } = await signedIn();
  const token = String(form.get("token") ?? "");
  const admin = createAdminClient();
  const { data: invite } = await admin.from("workspace_invites").select("id, workspace_id, role, email, expires_at, accepted_at, revoked_at").eq("token_hash", hashInviteToken(token)).maybeSingle();
  const problem = inviteProblem(invite as InviteRow | null, user.email);
  if (problem) return { error: problem };
  const { data: existing } = await admin.from("workspace_members").select("role").eq("workspace_id", invite!.workspace_id).eq("user_id", user.id).maybeSingle();
  // Mark used first (only if still unused), so one link adds one member.
  const { data: claimed } = await admin.from("workspace_invites").update({ accepted_by: user.id, accepted_at: new Date().toISOString() }).eq("id", invite!.id).is("accepted_at", null).is("revoked_at", null).select("id");
  if (!claimed?.length) return { error: "This invite was already used." };
  if (!existing) {
    const { error } = await admin.from("workspace_members").insert({ workspace_id: invite!.workspace_id, user_id: user.id, role: invite!.role });
    if (error) return { error: "Could not join the workspace." };
  }
  redirect("/stores");
}
