import { getTranslations } from "next-intl/server";
import { PLANS, type PlanId } from "@/lib/plans";
import { capStatus, PROVIDERS, utcDay, type Provider } from "@/lib/usage";
import type { getUser } from "@/lib/supabase/server";

type Client = Awaited<ReturnType<typeof getUser>>["supabase"];

const NAME: Record<Provider, string> = { gemini: "Gemini", groq: "Groq", nvidia: "NVIDIA", mistral: "Mistral" };
export const isAdminEmail = (email: string | null | undefined) =>
  Boolean(email) && (process.env.ADMIN_EMAILS ?? "").split(",").map((e) => e.trim().toLowerCase()).filter(Boolean).includes(email!.toLowerCase());

// Today's AI requests of the workspace against its plan's daily caps. Customers only see a short notice when a cap
// is near or reached; the per-provider counts (internal helper models included) are for ADMIN_EMAILS only.
export async function UsageAlert({ supabase, workspaceId, plan, admin = false }: { supabase: Client; workspaceId: string; plan: PlanId; admin?: boolean }) {
  const t = await getTranslations("usage");
  const { data } = await supabase.from("usage_events").select("provider, requests").eq("workspace_id", workspaceId).gte("created_at", `${utcDay()}T00:00:00Z`);
  const used: Partial<Record<Provider, number>> = {};
  for (const r of data ?? []) if ((PROVIDERS as string[]).includes(r.provider)) used[r.provider as Provider] = (used[r.provider as Provider] ?? 0) + r.requests;
  const caps = capStatus(plan, used);
  const hot = caps.filter((c) => c.level !== "ok");
  if (!hot.length && !admin) return null;
  const reached = hot.some((c) => c.level === "reached");
  return (
    <div className={`card usage-alert${reached ? " usage-reached" : hot.length ? " usage-warn" : ""}`} role={hot.length ? "status" : undefined}>
      <p className="small">
        <strong>{reached ? t("reached") : hot.length ? t("almost") : t("today")}</strong>{" "}
        {admin && <span className="muted">({t("adminOnly", { plan: PLANS[plan].name })}) {caps.map((c) => `${NAME[c.provider]} ${c.used}/${c.limit}`).join(" · ")}</span>}
      </p>
      {reached && <p className="muted small">{t("wait")}</p>}
    </div>
  );
}
