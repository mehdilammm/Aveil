import { NextResponse, type NextRequest } from "next/server";
import { addStorePath, HANDOFF_COOKIE, HANDOFF_MAX_AGE, isReportId } from "@/lib/check-handoff";
import { getUser } from "@/lib/supabase/server";

// "Run the full scan" on a /check report: remember the report, then go to the add-store form (signing up first
// when needed).
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const origin = request.nextUrl.origin;
  if (!isReportId(id)) return NextResponse.redirect(`${origin}/check`);
  const { user } = await getUser();
  const res = NextResponse.redirect(user ? `${origin}${addStorePath(id)}` : `${origin}/login?mode=signup`);
  res.cookies.set(HANDOFF_COOKIE, id, { httpOnly: true, secure: true, sameSite: "lax", maxAge: HANDOFF_MAX_AGE, path: "/" });
  return res;
}
