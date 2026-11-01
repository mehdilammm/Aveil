import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { contentSecurityPolicy, cspHeaderName, SESSION_COOKIE, sessionCookie } from "./lib/security-headers";

const PUBLIC_PATHS = ["/login", "/auth", "/check", "/bot", "/invite", "/r", "/downloads", "/pricing", "/terms", "/privacy", "/robots.txt", "/sitemap.xml", "/opengraph-image"];

// Refreshes the Supabase session cookie, sends signed-out users to /login, and sets the Content-Security-Policy with
// a fresh nonce (on the request too, so Next.js puts it on its scripts).
export async function proxy(request: NextRequest) {
  const nonce = Buffer.from(crypto.getRandomValues(new Uint8Array(16))).toString("base64");
  const csp = contentSecurityPolicy(nonce);
  request.headers.set("x-nonce", nonce);
  request.headers.set(cspHeaderName(), csp);
  const withCsp = <T extends NextResponse>(r: T) => {
    r.headers.set(cspHeaderName(), csp);
    return r;
  };
  let response = NextResponse.next({ request });

  const supabase = createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!, {
    cookieOptions: SESSION_COOKIE,
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet, headers) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, sessionCookie(options)));
        Object.entries(headers).forEach(([key, value]) => response.headers.set(key, value));
      },
    },
  });

  const { data } = await supabase.auth.getUser();
  const path = request.nextUrl.pathname;
  // "/" is the landing page for visitors (signed-in users are sent on to their stores).
  const isPublic = path === "/" || PUBLIC_PATHS.some((p) => path === p || path.startsWith(`${p}/`));

  if (!data.user && !isPublic && !path.startsWith("/api/")) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.search = "";
    return withCsp(NextResponse.redirect(url));
  }
  return withCsp(response);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
