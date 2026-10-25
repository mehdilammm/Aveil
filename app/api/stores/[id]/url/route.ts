import { promises as dns } from "node:dns";
import { NextResponse } from "next/server";
import { checkManual, MANUAL_METHODS, type ManualMethod } from "@/lib/ownership";
import { recordVerification } from "@/lib/ownership-store";
import { createAdminClient } from "@/lib/supabase/admin";
import { getUser } from "@/lib/supabase/server";
import { normalizeStoreUrl } from "@/lib/url";
import { urlChangeInstructions, urlChangeToken } from "@/lib/url-change";
import { fetchPublicPage } from "@/lib/woo";
import { storeAccess } from "@/lib/workspace";

export const runtime = "nodejs";
const CHECKER_UA = "AgentScope/0.3 (+ownership check)";

// Change the store address (workspace owner only). {url, action: "start"}: the token to place on the new address.
// {url, action: "confirm", method}: checks the new address with that method; only when it passes does the address
// change, every earlier ownership verification is removed, the new one is recorded, and auto-fix is turned off
// (its approval was for the old address). So no scan or write can run on the new address before it is verified.
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { supabase, user } = await getUser();
  if (!user) return NextResponse.json({ error: "Please log in." }, { status: 401 });
  const store = await storeAccess(supabase, user.id, id);
  if (!store) return NextResponse.json({ error: "Store not found." }, { status: 404 });
  if (store.role !== "owner") return NextResponse.json({ error: "Only the workspace owner can change the store address." }, { status: 403 });
  const body = (await request.json().catch(() => ({}))) as { url?: unknown; action?: unknown; method?: unknown };
  const parsed = normalizeStoreUrl(String(body.url ?? ""));
  if ("error" in parsed) return NextResponse.json({ error: parsed.error }, { status: 400 });
  if (parsed.url === store.url) return NextResponse.json({ error: "This is already the store address." }, { status: 400 });
  const token = urlChangeToken(store.id, parsed.url);

  if (body.action === "start") return NextResponse.json({ url: parsed.url, token, methods: urlChangeInstructions(parsed.url, token) });
  if (body.action !== "confirm") return NextResponse.json({ error: "Unknown action." }, { status: 400 });
  const method = String(body.method ?? "") as ManualMethod;
  if (!MANUAL_METHODS.includes(method)) return NextResponse.json({ error: "Choose DNS TXT, meta tag or file." }, { status: 400 });

  const result = await checkManual(parsed.url, method, token, {
    resolveTxt: (host) => dns.resolveTxt(host),
    fetchPage: async (url) => {
      const r = await fetchPublicPage(url, CHECKER_UA);
      return r.ok ? { ok: true, status: r.status, body: r.body, redirectedTo: r.redirectedTo } : { ok: false, error: r.error };
    },
  });
  if (!result.verified) return NextResponse.json({ verified: false, evidence: result.evidence }, { status: 422 });

  const admin = createAdminClient();
  const { error } = await admin.from("stores").update({ url: parsed.url, connection_status: "not-connected", connection_error: null, auto_fix_enabled: false }).eq("id", store.id);
  if (error) return NextResponse.json({ error: "Could not change the address." }, { status: 500 });
  await admin.from("store_verifications").delete().eq("store_id", store.id);
  await recordVerification(admin, store, method, result, token);
  return NextResponse.json({ verified: true, url: parsed.url, evidence: result.evidence });
}
