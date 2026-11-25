import { createClient } from "@/lib/supabase/server";
import type { AuthErrorCode } from "@/lib/auth-errors";
import { safeNext, withNext } from "@/lib/safe-next";
import { NextResponse, type NextRequest } from "next/server";
import { errorFields, logEvent } from "@/lib/log";

// Google sends the user back here (through Supabase) with a one-time code,
// which becomes the session cookie. PKCE: the verifier was stored in a cookie
// when GoogleButton started the sign-in.
export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const fail = (reason: AuthErrorCode) =>
    NextResponse.redirect(`${origin}${withNext(`/auth/error?error=${reason}`, searchParams.get("next"))}`);

  // Google's own refusal, e.g. the user pressed Cancel.
  const providerError = searchParams.get("error_description") ?? searchParams.get("error");
  if (providerError) {
    // OAuth's `error` is a fixed code (access_denied, server_error); the description is
    // free text, so only the code is logged.
    const code = searchParams.get("error");
    logEvent("auth.google_refused", { code: code && /^[a-z_]{1,64}$/.test(code) ? code : null });
    return fail("cancelled");
  }

  const code = searchParams.get("code");
  if (!code) return fail("incomplete");

  const supabase = await createClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) {
    logEvent("auth.code_exchange_failed", errorFields(error));
    return fail("failed");
  }

  return NextResponse.redirect(`${origin}${safeNext(searchParams.get("next"))}`);
}
