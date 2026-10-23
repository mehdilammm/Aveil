import { NextResponse } from "next/server";
import { fixAccess } from "@/lib/fix-access";
import { fetchSetting, wooWrite, WooError } from "@/lib/woo";

export const runtime = "nodejs";

const KEY_RE = /^ck_[A-Za-z0-9]{20,64}$/;
const SECRET_RE = /^cs_[A-Za-z0-9]{20,64}$/;

// Saves the separate write key after proving it can write: the store address setting is written back with its
// current value (no change). Kept in Vault apart from the read key.
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const a = await fixAccess((await params).id);
  if (!a.ok) return NextResponse.json({ error: a.error }, { status: a.status });
  const body = (await request.json().catch(() => ({}))) as { consumer_key?: unknown; consumer_secret?: unknown };
  const key = String(body.consumer_key ?? "").trim();
  const secret = String(body.consumer_secret ?? "").trim();
  if (!KEY_RE.test(key) || !SECRET_RE.test(secret)) return NextResponse.json({ error: "The key starts with ck_ and the secret with cs_." }, { status: 400 });
  const creds = { consumerKey: key, consumerSecret: secret };
  try {
    const current = await fetchSetting(a.store.url, "general", "woocommerce_store_address", creds);
    await wooWrite(a.store.url, "PUT", "/settings/general/woocommerce_store_address", { value: current ?? "" }, creds);
  } catch (err) {
    return NextResponse.json({ error: err instanceof WooError ? err.message : "The key could not be checked." }, { status: 422 });
  }
  const { error } = await a.admin.rpc("save_store_write_credentials", { p_store_id: a.store.id, p_owner_id: a.store.owner_id, p_consumer_key: key, p_consumer_secret: secret, p_key_hint: `ck_…${key.slice(-4)}` });
  if (error) return NextResponse.json({ error: "Could not save the key securely." }, { status: 500 });
  return NextResponse.json({ saved: true, hint: `ck_…${key.slice(-4)}` });
}
