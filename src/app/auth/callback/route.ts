import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

// Code-exchange callback for Supabase Auth. Handles two arrival paths:
//   1. Email signup confirmation   — Supabase appends ?code=... to this URL
//      after the user clicks the "Confirm email address" link.
//   2. Google OAuth sign-in        — Supabase appends ?code=... after the
//      user consents on Google's side.
// Without exchangeCodeForSession() here, the PKCE code param would just be
// dropped at /dashboard (the old redirect target) and the user would land
// unauthenticated.
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = searchParams.get("next") ?? "/dashboard";

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      return NextResponse.redirect(`${origin}${next}`);
    }
  }

  return NextResponse.redirect(`${origin}/login?error=auth_callback_failed`);
}