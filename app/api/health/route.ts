import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getUser } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

type Check = { ok: boolean; detail: string };

function envCheck(name: string, valid?: (v: string) => boolean): Check {
  const value = process.env[name]?.trim();
  if (!value) return { ok: false, detail: "missing" };
  if (valid && !valid(value)) return { ok: false, detail: "set, but not in the expected format" };
  return { ok: true, detail: "set" };
}

function isHttpsUrl(v: string) {
  try {
    return new URL(v).protocol === "https:";
  } catch {
    return false;
  }
}

const looksLikeKey = (v: string) => /^sb_(publishable|secret)_/.test(v) || v.split(".").length === 3;

// Shows whether configuration is present and working. Never returns values.
// Signed-in users only; if ADMIN_EMAILS (comma separated) is set, only those users.
export async function GET() {
  const { user } = await getUser().catch(() => ({ user: null }));
  if (!user) return NextResponse.json({ error: "Log in first." }, { status: 401 });
  const admins = (process.env.ADMIN_EMAILS ?? "").split(",").map((e) => e.trim().toLowerCase()).filter(Boolean);
  if (admins.length && !admins.includes((user.email ?? "").toLowerCase())) {
    return NextResponse.json({ error: "Not allowed." }, { status: 403 });
  }

  const env = {
    NEXT_PUBLIC_SUPABASE_URL: envCheck("NEXT_PUBLIC_SUPABASE_URL", isHttpsUrl),
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: envCheck("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", looksLikeKey),
    SUPABASE_SERVICE_ROLE_KEY: envCheck("SUPABASE_SERVICE_ROLE_KEY", (v) => v.startsWith("sb_secret_") || v.split(".").length === 3),
  };

  let serviceRole: Check;
  if (!env.SUPABASE_SERVICE_ROLE_KEY.ok || !env.NEXT_PUBLIC_SUPABASE_URL.ok) {
    serviceRole = { ok: false, detail: "not tested: required variables are missing or invalid" };
  } else {
    try {
      const { data, error } = await createAdminClient().rpc("agentscope_health");
      if (error) {
        const denied = error.code === "42501" || /permission denied/i.test(error.message);
        serviceRole = {
          ok: false,
          detail: denied
            ? "key was accepted but is not the service role key (permission denied)"
            : /invalid api key|jwt|unauthorized/i.test(error.message)
              ? "Supabase rejected the key (invalid key or wrong project)"
              : `Supabase error ${error.code ?? ""}`.trim(),
        };
      } else {
        const vault = (data as { vault?: boolean } | null)?.vault === true;
        serviceRole = vault ? { ok: true, detail: "works; Vault available" } : { ok: false, detail: "works, but Vault is not available" };
      }
    } catch {
      serviceRole = { ok: false, detail: "could not reach Supabase" };
    }
  }

  const ok = Object.values(env).every((c) => c.ok) && serviceRole.ok;
  return NextResponse.json({ ok, env, serviceRole }, { status: ok ? 200 : 503, headers: { "Cache-Control": "no-store" } });
}
