import { createClient } from "@/lib/supabase/server";
import type { AuthErrorCode } from "@/lib/auth-errors";
import { safeNext } from "@/lib/safe-next";
import { NextResponse, type NextRequest } from "next/server";

// Google sends the user back here (through Supabase) with a one-time code,
// which becomes the session cookie. PKCE: the verifier was stored in a cookie
// when GoogleButton started the sign-in.
export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const fail = (reason: AuthErrorCode) => NextResponse.redirect(`${origin}/auth/error?error=${reason}`);

  // Google's own refusal, e.g. the user pressed Cancel.
  const providerError = searchParams.get("error_description") ?? searchParams.get("error");
  if (providerError) {
    console.error("Google sign-in refused:", providerError);
    return fail("cancelled");
  }

  const code = searchParams.get("code");
  if (!code) return fail("incomplete");

  const supabase = await createClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) {
    console.error("sign-in code exchange failed:", error.message);
    return fail("failed");
  }

  return NextResponse.redirect(`${origin}${safeNext(searchParams.get("next"))}`);
}
