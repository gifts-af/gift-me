"use server";

import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export type ExtensionTokenResult = { tokenHash: string } | { error: string };

// Hands a one-time sign-in token to the Chrome extension. generateLink sends
// no email; we return only the hashed token, which the extension swaps for a
// session with verifyOtp. This is the only place the admin key is used for
// the extension. Never return or log action_link, email_otp, or the token.
export async function createExtensionToken(): Promise<ExtensionTokenResult> {
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  const user = data?.user;
  if (!user) return { error: "Your session ended. Sign in again." };
  if (!user.email) return { error: "Your account has no email address, so the extension can't sign in." };

  const failure = { error: "Couldn't create a sign-in for the extension. Try again." };
  try {
    const { data: link, error } = await createAdminClient().auth.admin.generateLink({
      type: "magiclink",
      email: user.email,
    });
    const tokenHash = link?.properties?.hashed_token;
    if (error || !tokenHash) return failure;
    return { tokenHash };
  } catch {
    return failure; // never leak provider text
  }
}
