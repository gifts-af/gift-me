// What the sign-in, sign-up and password forms say when Supabase refuses, by its error
// code (auth-js's ErrorCode). Supabase's own text never reaches the page.
const MESSAGES: Record<string, string> = {
  // Both the project's hourly limit and the short wait between two emails to one address.
  over_email_send_rate_limit: "We can't send another email right now. Try again a bit later, or sign in with Google.",
  over_request_rate_limit: "Too many tries. Wait a few minutes, then try again.",
  email_not_confirmed: "Confirm your email first: open the link we sent you.",
  invalid_credentials:
    "That email and password don't match. Try again, reset your password below, or use Continue with Google.",
  weak_password: "That password is too easy to guess. Try a longer one, with letters, numbers and symbols.",
  same_password: "That's your current password. Choose a different one.",
  user_already_exists: "You already have an account with this email. Sign in instead.",
  email_exists: "You already have an account with this email. Sign in instead.",
};

export function authFormError({ code }: { code?: string }): string {
  return (code && Object.hasOwn(MESSAGES, code) && MESSAGES[code]) || "Something went wrong. Please try again in a minute.";
}
