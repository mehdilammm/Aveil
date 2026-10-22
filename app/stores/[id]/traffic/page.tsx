import Link from "next/link";
import { notFound } from "next/navigation";
import { getStore } from "@/lib/data";
import { createAdminClient } from "@/lib/supabase/admin";
import { getUser } from "@/lib/supabase/server";
import { splitCheckerRows } from "@/lib/traffic";

const DAYS = 30;

type Row = { day: string; source: string; category: string; confidence: string; route: string; http_status: number; hits: number };

function sumBy(rows: Row[], key: (r: Row) => string) {
  const m = new Map<string, number>();
  for (const r of rows) m.set(key(r), (m.get(key(r)) ?? 0) + r.hits);
  return [...m.entries()].sort((a, b) => b[1] - a[1]);
}

export default async function AiTrafficPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { supabase } = await getUser();
  const store = await getStore(supabase, id);
  if (!store) notFound();

  let connector: { last_ingest_at: string | null } | null = null;
  try {
    const { data } = await createAdminClient().from("traffic_connectors").select("last_ingest_at").eq("store_id", store.id).maybeSingle();
    connector = data;
  } catch {
    connector = null;
  }

  const since = new Date(Date.now() - (DAYS - 1) * 86_400_000).toISOString().slice(0, 10);
  const all: Row[] = [];
  for (let from = 0; ; from += 1000) {
    const { data } = await supabase
      .from("traffic_daily")
      .select("day, source, category, confidence, route, http_status, hits")
      .eq("store_id", store.id)
      .gte("day", since)
      .range(from, from + 999);
    all.push(...((data ?? []) as Row[]));
    if (!data || data.length < 1000) break;
  }

  const head = (
    <div className="page-head">
      <h1>AI Traffic</h1>
      <p className="sub">Visits from AI assistants and shopping agents, last {DAYS} days.</p>
    </div>
  );

  // Bursts the plugin marked as likely checker tools are shown apart, never in the main numbers.
  const { main: rows, checker } = splitCheckerRows(all.filter((r) => r.hits > 0));
  const checkerTotal = checker.reduce((n, r) => n + r.hits, 0);

  if (!connector && all.length === 0) {
    return (
      <>
        {head}
        <div className="card empty">
          <strong>Not connected yet</strong>
          <p>Connect the agentscope-core plugin in <Link href="/settings">Settings</Link> to receive daily totals. No numbers are estimated.</p>
        </div>
      </>
    );
  }

  const total = rows.reduce((n, r) => n + r.hits, 0);
  const bySource = sumBy(rows, (r) => `${r.source}|${r.category}|${r.confidence}`);
  const byRoute = sumBy(rows, (r) => `${r.route}|${r.http_status}`).slice(0, 15);
  const byDay = sumBy(rows, (r) => r.day).sort((a, b) => b[0].localeCompare(a[0]));

  return (
    <>
      {head}
      <div className="card">
        <span className="badge basis-observed">Observed</span> <span className="muted">unverified user agent</span>
        <p className="muted">
          Counted by the plugin on WordPress: only requests handled by PHP, while capture is on. User agents and referrers can be faked, and pages served
          from a host or CDN cache are not counted. This is not proof of AI recommendations, real customers or sales.
        </p>
        <p className="muted">Last data received: {connector?.last_ingest_at ? new Date(connector.last_ingest_at).toUTCString() : "none yet"}</p>
      </div>

      {checkerTotal > 0 && (
        <>
          <h2>Probably checker tools</h2>
          <div className="card">
            <p><span className="badge basis-heuristic">Heuristic</span> <strong>{checkerTotal}</strong> requests: probably an SEO/GEO checker tool, not real AI traffic. Not in the numbers below.</p>
            <p className="muted small">
              Rule (plugin 1.2.0+): 3 or more different AI sources, or 5 or more AI bot requests with 3 or more different bot names, within 60 seconds.
              Real AI crawlers rarely arrive together, but this is a guess from timing only, not proof either way.
            </p>
            <table>
              <thead><tr><th>Source</th><th>Category</th><th className="num">Requests</th></tr></thead>
              <tbody>
                {sumBy(checker, (r) => `${r.source}|${r.category}`).map(([k, hits]) => {
                  const [source, category] = k.split("|");
                  return <tr key={k}><td>{source}</td><td>{category}</td><td className="num">{hits}</td></tr>;
                })}
              </tbody>
            </table>
          </div>
        </>
      )}

      {rows.length === 0 ? (
        <div className="card empty">
          <strong>Connected, waiting for data</strong>
          <p>The plugin sends totals once a day. Check that traffic capture is turned on in the plugin.</p>
        </div>
      ) : (
        <>
          <div className="grid">
            <div className="stat"><div className="label">Requests ({DAYS} days)</div><div className="value">{total}</div></div>
            <div className="stat"><div className="label">Sources</div><div className="value">{new Set(rows.map((r) => r.source)).size}</div></div>
          </div>

          <h2>By source</h2>
          <div className="card table-wrap">
            <table>
              <thead><tr><th>Source</th><th>Category</th><th>Confidence</th><th className="num">Requests</th></tr></thead>
              <tbody>
                {bySource.map(([k, hits]) => {
                  const [source, category, confidence] = k.split("|");
                  return <tr key={k}><td>{source}</td><td>{category}</td><td>{confidence}</td><td className="num">{hits}</td></tr>;
                })}
              </tbody>
            </table>
          </div>

          <h2>By page type</h2>
          <div className="card table-wrap">
            <table>
              <thead><tr><th>Page type</th><th>HTTP status</th><th className="num">Requests</th></tr></thead>
              <tbody>
                {byRoute.map(([k, hits]) => {
                  const [route, status] = k.split("|");
                  return <tr key={k}><td>{route}</td><td className={Number(status) >= 400 ? "error" : undefined}>{status === "0" ? "—" : status}</td><td className="num">{hits}</td></tr>;
                })}
              </tbody>
            </table>
          </div>

          <h2>By day</h2>
          <div className="card table-wrap">
            <table>
              <thead><tr><th>Day (UTC)</th><th className="num">Requests</th></tr></thead>
              <tbody>{byDay.map(([day, hits]) => <tr key={day}><td>{day}</td><td className="num">{hits}</td></tr>)}</tbody>
            </table>
          </div>
        </>
      )}
    </>
  );
}
