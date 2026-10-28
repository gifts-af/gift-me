import { createClient } from "@/lib/supabase/server";
import { safeNext } from "@/lib/safe-next";
import { NextResponse, type NextRequest } from "next/server";

// Google sends the user back here (through Supabase) with a one-time code,
// which becomes the session cookie. PKCE: the verifier was stored in a cookie
// when GoogleButton started the sign-in.
export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const fail = (message: string) =>
    NextResponse.redirect(`${origin}/auth/error?error=${encodeURIComponent(message)}`);

  // Google's own refusal, e.g. the user pressed Cancel.
  const providerError = searchParams.get("error_description") ?? searchParams.get("error");
  if (providerError) return fail(providerError);

  const code = searchParams.get("code");
  if (!code) return fail("Sign-in didn't finish. Please try again.");

  const supabase = await createClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) return fail(error.message);

  return NextResponse.redirect(`${origin}${safeNext(searchParams.get("next"))}`);
}
