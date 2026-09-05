import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

// Renamed from middleware.ts to proxy.ts for Next.js 16 (middleware is
// deprecated). Behavior is identical — Supabase cookie refresh, redirect
// authenticated users away from /login + /signup, gate the dashboard
// subtree. Default runtime is Node in proxy.ts, which is fine here:
// we read cookies and call @supabase/ssr, both Node-compatible.
export async function proxy(request: NextRequest) {
  // Supabase env vars are required — skip auth checks if absent (e.g. during E2E stub boot)
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
    return NextResponse.next({ request });
  }

  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          );
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  const {
    data: { user },
  } = await supabase.auth.getUser().catch(() => ({ data: { user: null } }));

  const { pathname } = request.nextUrl;

  // Redirect authenticated users away from auth pages
  if (user && (pathname === "/login" || pathname === "/signup")) {
    return NextResponse.redirect(new URL("/dashboard", request.url));
  }

  // Redirect unauthenticated users away from protected routes
  const isProtected =
    pathname.startsWith("/dashboard") ||
    pathname.startsWith("/contacts") ||
    pathname.startsWith("/import") ||
    pathname.startsWith("/credits");

  if (!user && isProtected) {
    const redirectUrl = new URL("/login", request.url);
    redirectUrl.searchParams.set("next", pathname);
    return NextResponse.redirect(redirectUrl);
  }

  return response;
}

export const config = {
  matcher: [
    /*
     * Match all paths except:
     * - _next/static, _next/image (Next.js internals)
     * - favicon.ico, public assets
     * - api routes
     */
    "/((?!_next/static|_next/image|favicon.ico|images/|api/).*)",
  ],
};
