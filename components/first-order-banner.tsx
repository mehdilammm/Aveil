import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { formatDate } from "@/components/badges";
import { getUser } from "@/lib/supabase/server";

// The store's first AI-referred order, on the Overview and AI Revenue pages, while that order still counts
// (processing, completed or on-hold; a cancelled one leaves the AI orders and the alert is closed).
export async function FirstOrderBanner({ storeId }: { storeId: string }) {
  const { supabase } = await getUser();
  const { data: alert } = await supabase.from("store_alerts").select("detail").eq("store_id", storeId).eq("kind", "first_ai_order").eq("status", "open").limit(1).maybeSingle();
  const d = alert?.detail as { order_id?: number; ordered_at?: string; total?: number; currency?: string; source?: string } | undefined;
  if (!d?.order_id) return null;
  const { count } = await supabase.from("ai_orders").select("order_id", { count: "exact", head: true }).eq("store_id", storeId).eq("order_id", d.order_id);
  if (!count) return null;
  const t = await getTranslations("alerts");
  return (
    <p className="alert-line">
      <strong>{t("firstOrder", { order: d.order_id, total: Number(d.total ?? 0).toFixed(2), currency: d.currency ?? "", source: d.source ?? "", date: formatDate(d.ordered_at ?? "") })}</strong>
      <Link href={`/stores/${storeId}/revenue`}>{t("firstOrderSee")}</Link>
    </p>
  );
}
