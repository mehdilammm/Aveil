import "server-only";
import { isOwnershipVerified } from "./ownership-store";
import { createAdminClient } from "./supabase/admin";
import { getUser } from "./supabase/server";
import { canEdit, storeAccess, type StoreAccess } from "./workspace";

// Every write action: a signed-in owner or admin of the store's workspace, on an ownership-verified store.
export async function fixAccess(storeId: string): Promise<{ ok: true; store: StoreAccess; userId: string; admin: ReturnType<typeof createAdminClient> } | { ok: false; status: number; error: string }> {
  const { supabase, user } = await getUser();
  if (!user) return { ok: false, status: 401, error: "Please log in." };
  const store = await storeAccess(supabase, user.id, storeId);
  if (!store) return { ok: false, status: 404, error: "Store not found." };
  if (!canEdit(store.role)) return { ok: false, status: 403, error: "Only owners and admins can change the store." };
  const admin = createAdminClient();
  if (!(await isOwnershipVerified(admin, store.id))) return { ok: false, status: 403, error: "Verify that you own this store first (run a scan, or use DNS / meta tag / file on the store page)." };
  return { ok: true, store, userId: user.id, admin };
}
