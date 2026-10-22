import { PLANS, type PlanId } from "@/lib/plans";
import { capStatus, PROVIDERS, utcDay, type Provider } from "@/lib/usage";
import type { getUser } from "@/lib/supabase/server";

type Client = Awaited<ReturnType<typeof getUser>>["supabase"];

const NAME: Record<Provider, string> = { gemini: "Gemini", groq: "Groq (helper)", nvidia: "NVIDIA (helper)", mistral: "Mistral" };

// Today's AI requests of the workspace against its plan's daily caps; shown when a cap is near or reached.
export async function UsageAlert({ supabase, workspaceId, plan, always = false }: { supabase: Client; workspaceId: string; plan: PlanId; always?: boolean }) {
  const { data } = await supabase.from("usage_events").select("provider, requests").eq("workspace_id", workspaceId).gte("created_at", `${utcDay()}T00:00:00Z`);
  const used: Partial<Record<Provider, number>> = {};
  for (const r of data ?? []) if ((PROVIDERS as string[]).includes(r.provider)) used[r.provider as Provider] = (used[r.provider as Provider] ?? 0) + r.requests;
  const caps = capStatus(plan, used);
  const hot = caps.filter((c) => c.level !== "ok");
  if (!hot.length && !always) return null;
  const reached = hot.some((c) => c.level === "reached");
  return (
    <div className={`card usage-alert${reached ? " usage-reached" : hot.length ? " usage-warn" : ""}`} role={hot.length ? "status" : undefined}>
      <p className="small">
        <strong>{reached ? "Daily AI limit reached" : hot.length ? "Daily AI limit almost reached" : "AI usage today"}</strong> ({PLANS[plan].name} plan, resets at 00:00 UTC):{" "}
        {caps.map((c) => `${NAME[c.provider]} ${c.used}/${c.limit}`).join(" · ")}
      </p>
      {reached && <p className="muted small">New AI questions wait until tomorrow. Nothing already saved is affected.</p>}
    </div>
  );
}
