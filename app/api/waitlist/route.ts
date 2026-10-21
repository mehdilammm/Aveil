import { NextResponse } from "next/server";
import { clientIp, hashIp, withinRateLimit } from "@/lib/public-scan";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

// Shopify waitlist from a public report. Email optional; nothing is sent to it.
export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as { reportId?: unknown; email?: unknown } | null;
  const reportId = typeof body?.reportId === "string" ? body.reportId : "";
  const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
  if (!UUID_RE.test(reportId)) return NextResponse.json({ error: "Invalid report." }, { status: 400 });
  if (email && (email.length > 254 || !EMAIL_RE.test(email))) return NextResponse.json({ error: "Please enter a valid email, or leave it empty." }, { status: 400 });

  const admin = createAdminClient();
  const { data: count } = await admin.rpc("public_scan_hit", {
    p_ip_hash: hashIp(`waitlist:${clientIp(request.headers)}`, process.env.SUPABASE_SERVICE_ROLE_KEY ?? "", new Date()),
    p_window_seconds: 3600,
  });
  if (!withinRateLimit(Number(count))) return NextResponse.json({ error: "Too many requests. Please try again later." }, { status: 429 });

  const { data: report } = await admin.from("public_reports").select("id, host").eq("id", reportId).maybeSingle();
  if (!report) return NextResponse.json({ error: "Report not found." }, { status: 404 });

  const { error } = await admin.from("shopify_waitlist").insert({ host: report.host, email: email || null, report_id: report.id });
  if (error && error.code !== "23505") return NextResponse.json({ error: "Could not save. Please try again." }, { status: 500 });
  return NextResponse.json({ ok: true });
}
