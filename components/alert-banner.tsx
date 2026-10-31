import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { getUser } from "@/lib/supabase/server";

// F2: open breakage alerts, on top of the store overview (RLS: members of the store's workspace).
export async function AlertBanner({ storeId }: { storeId: string }) {
  const { supabase } = await getUser();
  const { count } = await supabase.from("store_alerts").select("id", { count: "exact", head: true }).eq("store_id", storeId).eq("kind", "breakage").eq("status", "open");
  if (!count) return null;
  const t = await getTranslations("alerts");
  return (
    <p className="alert-line bad">
      <strong>{t("banner", { n: count })}</strong>
      <Link href={`/stores/${storeId}/alerts`}>{t("see")}</Link>
    </p>
  );
}
