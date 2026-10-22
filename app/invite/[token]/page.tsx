import Link from "next/link";
import { createAdminClient } from "@/lib/supabase/admin";
import { getUser } from "@/lib/supabase/server";
import { hashInviteToken, inviteProblem, type InviteRow } from "@/lib/workspace";
import { AcceptInvite } from "./accept";

export const metadata = { title: "Workspace invite", robots: { index: false } };

export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const { user } = await getUser();
  const admin = createAdminClient();
  const { data: invite } = await admin.from("workspace_invites").select("workspace_id, role, email, expires_at, accepted_at, revoked_at, workspaces(name)").eq("token_hash", hashInviteToken(token)).maybeSingle();
  const ws = invite ? ((Array.isArray(invite.workspaces) ? invite.workspaces[0] : invite.workspaces) as { name: string } | null) : null;
  const problem = inviteProblem(invite as InviteRow | null, user ? user.email : invite?.email ?? null);
  return (
    <main className="auth">
      <p className="brand">AgentScope</p>
      <h1>Join a workspace</h1>
      {problem ? (
        <p className="error">{problem}</p>
      ) : !user ? (
        <p>You are invited to <strong>{ws?.name}</strong> as {invite!.role}. <Link href="/login">Log in or sign up</Link>, then open this link again.</p>
      ) : (
        <>
          <p>You are invited to <strong>{ws?.name}</strong> as <strong>{invite!.role}</strong> ({invite!.role === "viewer" ? "read only" : "can change stores and run checks"}).</p>
          <AcceptInvite token={token} />
        </>
      )}
    </main>
  );
}
