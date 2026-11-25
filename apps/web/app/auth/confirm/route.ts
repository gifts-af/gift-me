import { createClient } from "@/lib/supabase/server";
import { safeNext, withNext } from "@/lib/safe-next";
import { type EmailOtpType } from "@supabase/supabase-js";
import { redirect } from "next/navigation";
import { type NextRequest } from "next/server";
import { errorFields, logEvent } from "@/lib/log";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const token_hash = searchParams.get("token_hash");
  const type = searchParams.get("type") as EmailOtpType | null;
  const next = safeNext(searchParams.get("next"), new URL(request.url).origin);

  // After a failed reset link, signing in shouldn't lead to choosing a new password.
  const retryNext = type === "recovery" ? "/" : next;

  if (token_hash && type) {
    const supabase = await createClient();

    const { error } = await supabase.auth.verifyOtp({
      type,
      token_hash,
    });
    if (!error) {
      // redirect user to specified redirect URL or root of app
      redirect(next);
    } else {
      logEvent("auth.email_link_failed", errorFields(error));
      redirect(withNext("/auth/error?error=failed", retryNext));
    }
  }

  redirect(withNext("/auth/error?error=incomplete", retryNext));
}
