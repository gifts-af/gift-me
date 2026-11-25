// What the sign-in and sign-up forms say when Supabase refuses, by its error
// code (auth-js's ErrorCode). Supabase's own text never reaches the page.
const MESSAGES: Record<string, string> = {
  over_email_send_rate_limit:
    "We can't send more sign-up emails right now. Use Continue with Google above, or try again in an hour.",
  over_request_rate_limit: "Too many tries. Wait a few minutes, then try again.",
  email_not_confirmed: "Confirm your email first: open the link we sent you.",
  invalid_credentials:
    "That email and password don't match. Try again, reset your password below, or use Continue with Google.",
  weak_password: "That password is too easy to guess. Try a longer one, with letters, numbers and symbols.",
  user_already_exists: "You already have an account with this email. Sign in instead.",
  email_exists: "You already have an account with this email. Sign in instead.",
};

export function authFormError({ code }: { code?: string }): string {
  return (code && Object.hasOwn(MESSAGES, code) && MESSAGES[code]) || "Something went wrong. Please try again in a minute.";
}
