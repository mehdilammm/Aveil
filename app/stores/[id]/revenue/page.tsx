import Link from "next/link";
import { notFound } from "next/navigation";
import { BasisBadge, formatDate, SeverityBadge } from "@/components/badges";
import { aiOrdersLabel, ORDER_WINDOW_DAYS, revenueByCurrency } from "@/lib/ai-orders";
import { findingsForScan, getStore, listScans } from "@/lib/data";
import { buildFunnel, diagnose, type FunnelInput } from "@/lib/funnel";
import { PLANS, type PlanId } from "@/lib/plans";
import { createAdminClient } from "@/lib/supabase/admin";
import { getUser } from "@/lib/supabase/server";
import { CHECKER_CONFIDENCE } from "@/lib/traffic";
import { canEdit, storeAccess } from "@/lib/workspace";
import { RefreshOrders } from "./refresh-orders";

export const metadata = { title: "AI Revenue" };

const TRAFFIC_DAYS = 30;
const STATUS_LABEL = { ok: "OK", problem: "Problem", unknown: "Not measured" } as const;

export default async function AiRevenuePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { supabase, user } = await getUser();
  const store = await getStore(supabase, id);
  if (!store) notFound();
  const access = user ? await storeAccess(supabase, user.id, id) : null;

  const scans = await listScans(supabase, id, 10);
  const lastComplete = scans.find((s) => s.status === "complete");
  const findings = lastComplete ? await findingsForScan(supabase, lastComplete.id) : [];

  const { data: runs } = await supabase.from("visibility_runs").select("id").eq("store_id", id).eq("status", "complete").order("created_at", { ascending: false }).limit(1);
  const { data: answers } = runs?.[0]
    ? await supabase.from("visibility_results").select("mentioned").eq("run_id", runs[0].id).eq("engine", "gemini").not("answer", "is", null)
    : { data: [] };

  const since = new Date(Date.now() - (TRAFFIC_DAYS - 1) * 86_400_000).toISOString().slice(0, 10);
  const { data: traffic } = await supabase.from("traffic_daily").select("category, confidence, hits").eq("store_id", id).gte("day", since).limit(5000);
  const botVisits = (traffic ?? []).filter((r) => r.confidence === "unverified-user-agent").reduce((n, r) => n + r.hits, 0);
  const aiReferrals = (traffic ?? []).filter((r) => r.category === "human-ai-referral" && r.confidence !== CHECKER_CONFIDENCE).reduce((n, r) => n + r.hits, 0);

  const admin = createAdminClient();
  const [{ data: connector }, { data: ws }] = await Promise.all([
    admin.from("traffic_connectors").select("store_id").eq("store_id", id).maybeSingle(),
    admin.from("stores").select("workspaces(plan)").eq("id", id).maybeSingle(),
  ]);
  const wsRow = (ws as { workspaces?: { plan?: string } | { plan?: string }[] } | null)?.workspaces;
  const planId = ((Array.isArray(wsRow) ? wsRow[0]?.plan : wsRow?.plan) ?? "free") as PlanId;
  const plan = PLANS[planId] ?? PLANS.free;

  const [{ data: sync }, { data: orders }] = await Promise.all([
    supabase.from("order_syncs").select("synced_at, status, reason, orders_scanned, ai_orders, agent_checkouts").eq("store_id", id).maybeSingle(),
    supabase.from("ai_orders").select("order_id, ordered_at, total, refunded, currency, source, via, entry_path, agent_checkout").eq("store_id", id).order("ordered_at", { ascending: false }).limit(200),
  ]);
  const aiOrders = (orders ?? []).map((o) => ({ ...o, total: Number(o.total), refunded: Number(o.refunded) }));

  let ordersInput: FunnelInput["orders"];
  if (!plan.aiRevenue) ordersInput = { kind: "locked" };
  else if (!sync) ordersInput = { kind: "not_synced" };
  else if (sync.status !== "ok") ordersInput = { kind: "unavailable", reason: sync.reason ?? "Orders could not be read." };
  else ordersInput = { kind: "ok", scanned: sync.orders_scanned, aiOrders: aiOrders.length, revenue: revenueByCurrency(aiOrders), agentCheckouts: sync.agent_checkouts, days: ORDER_WINDOW_DAYS };

  const stages = buildFunnel({
    scanned: Boolean(lastComplete),
    findings: findings.map((f) => ({ finding_key: f.finding_key, type: f.type, title: f.title, severity: f.severity, basis: f.basis, evidence: f.evidence, guidance: f.guidance })),
    visibility: answers ? { asked: answers.length, mentioned: answers.filter((a) => a.mentioned).length } : null,
    plugin: { connected: Boolean(connector), botVisits, aiReferrals, days: TRAFFIC_DAYS },
    orders: ordersInput,
  });
  const diagnosis = diagnose(stages);
  const bySource = new Map<string, { orders: number; revenue: { currency: string; total: number }[] }>();
  for (const s of [...new Set(aiOrders.map((o) => o.source))]) {
    const of = aiOrders.filter((o) => o.source === s);
    bySource.set(s, { orders: of.length, revenue: revenueByCurrency(of) });
  }

  return (
    <>
      <div className="page-head">
        <h1>AI Revenue</h1>
        <p className="sub">Does AI bring this store sales? If not, where it stops and how to fix it.</p>
      </div>

      <div className="card">
        <p className="muted small">
          Every step uses data we observed: the last scan{lastComplete ? ` (${formatDate(lastComplete.finished_at)})` : ""}, AI answers, the plugin&apos;s counts and WooCommerce orders. No estimated revenue.
          &quot;AI-referred&quot; means a person came from a link in an AI assistant and bought; it does not mean an AI agent bought on its own.
        </p>
      </div>

      <h2>The funnel</h2>
      <ol className="funnel">
        {stages.map((s, i) => (
          <li key={s.key} className={`card funnel-step funnel-${s.status}`}>
            <div className="row" style={{ justifyContent: "space-between" }}>
              <strong>{i + 1}. {s.question}</strong>
              <span className={`badge ${s.status === "ok" ? "state-resolved" : s.status === "problem" ? "sev-high" : "basis-unavailable"}`}>{STATUS_LABEL[s.status]}</span>
            </div>
            <p className="funnel-value">{s.value} <BasisBadge basis={s.basis} /></p>
            <p className="muted small">{s.detail}</p>
          </li>
        ))}
      </ol>

      <h2>Why agents aren&apos;t buying</h2>
      {!diagnosis.stage ? (
        <div className="card"><p>No step shows a problem in the data we have. {stages.some((s) => s.status === "unknown") ? "Some steps are not measured yet (see above)." : ""}</p></div>
      ) : (
        <div className="card">
          <p>The funnel first breaks at <strong>{diagnosis.stage.question}</strong> ({diagnosis.stage.value}).</p>
          {diagnosis.reasons.length === 0 ? (
            <p className="muted small">No specific finding explains it yet. See the step&apos;s detail above.</p>
          ) : (
            <ol className="reasons">
              {diagnosis.reasons.slice(0, 10).map((r) => (
                <li key={r.finding_key}>
                  <SeverityBadge severity={r.severity} /> <BasisBadge basis={r.basis} /> <strong>{r.title}</strong>
                  <p className="small">{r.evidence}</p>
                  <p className="muted small">Fix: {r.guidance}</p>
                </li>
              ))}
            </ol>
          )}
          <p className="small"><Link href={`/stores/${id}/fix`}>Open Fix Center</Link> · This does not guarantee sales: it removes what we saw stopping them.</p>
        </div>
      )}

      <h2>AI-referred orders</h2>
      <div className="card">
        {!plan.aiRevenue ? (
          <p>AI-referred orders and revenue are available on <Link href="/pricing">Pro and Agency</Link>. The funnel above works on every plan.</p>
        ) : !sync ? (
          <p className="muted">Orders have not been read yet. They are read with each scan, or now:</p>
        ) : sync.status !== "ok" ? (
          <p><BasisBadge basis="unavailable" /> {sync.reason}</p>
        ) : aiOrders.length === 0 ? (
          <p><BasisBadge basis="observed" /> No AI-referred orders yet in the last {ORDER_WINDOW_DAYS} days ({sync.orders_scanned} {sync.orders_scanned === 1 ? "order" : "orders"} read). This is a result, not an error.</p>
        ) : (
          <>
            <p><BasisBadge basis="observed" /> {aiOrdersLabel(aiOrders.length)} in the last {ORDER_WINDOW_DAYS} days ({sync.orders_scanned} {sync.orders_scanned === 1 ? "order" : "orders"} read).</p>
            <div className="table-wrap">
              <table>
                <thead><tr><th>Source</th><th className="num">Orders</th><th className="num">Net revenue</th></tr></thead>
                <tbody>
                  {[...bySource.entries()].map(([s, v]) => (
                    <tr key={s}><td>{s}</td><td className="num">{v.orders}</td><td className="num">{v.revenue.map((r) => `${r.total.toFixed(2)} ${r.currency}`).join(" + ")}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
            <details>
              <summary className="muted small">Orders (no personal data is stored)</summary>
              <div className="table-wrap">
                <table>
                  <thead><tr><th>Order</th><th>Date</th><th>Source</th><th>Matched by</th><th>Entry page</th><th className="num">Total</th><th className="num">Refunded</th></tr></thead>
                  <tbody>
                    {aiOrders.map((o) => (
                      <tr key={o.order_id}><td>#{o.order_id}</td><td>{o.ordered_at.slice(0, 10)}</td><td>{o.source}{o.agent_checkout ? " (agent checkout)" : ""}</td><td>{o.via}</td><td>{o.entry_path ?? "—"}</td><td className="num">{o.total.toFixed(2)} {o.currency}</td><td className="num">{o.refunded > 0 ? `${o.refunded.toFixed(2)} ${o.currency}` : "—"}</td></tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>
          </>
        )}
        {plan.aiRevenue && (
          <>
            <p className="muted small">Agent checkout (an AI agent buying on its own): {sync?.status === "ok" && sync.agent_checkouts > 0 ? `${sync.agent_checkouts} order${sync.agent_checkouts === 1 ? " shows" : "s show"} evidence of it.` : "not measurable yet. WooCommerce does not mark such orders today; we will count them when there is evidence on the order."}</p>
            {sync && <p className="muted small">Last read: {formatDate(sync.synced_at)}.</p>}
            {access && canEdit(access.role) && <RefreshOrders storeId={id} />}
          </>
        )}
      </div>
    </>
  );
}
