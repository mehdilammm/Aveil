import type { EmailOtpType } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";
import { afterAuthPath } from "@/lib/check-handoff";
import { createClient } from "@/lib/supabase/server";

// Target of the confirmation email link.
export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;
  const supabase = await createClient();
  const code = searchParams.get("code");
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type") as EmailOtpType | null;

  const { error } = code
    ? await supabase.auth.exchangeCodeForSession(code)
    : tokenHash && type
      ? await supabase.auth.verifyOtp({ token_hash: tokenHash, type })
      : { error: new Error("Missing confirmation token") };

  if (error) return NextResponse.redirect(`${origin}/login?error=${encodeURIComponent("Email link is invalid or expired.")}`);
  return NextResponse.redirect(`${origin}${await afterAuthPath()}`);
}
