// The auth error page shows only these words, keyed by a short code, so a
// crafted link can't put its own text on a GiftMe page. The raw reason is
// logged where it happens.
const MESSAGES: Record<string, string> = {
  cancelled: "Google sign-in was cancelled. You can try again, or use your email.",
  incomplete: "Sign-in didn't finish. Please try again.",
  failed: "That sign-in link has expired or was already used. Please try again.",
};

export type AuthErrorCode = "cancelled" | "incomplete" | "failed";

export function authErrorMessage(code: string | undefined): string {
  return (code && Object.hasOwn(MESSAGES, code) && MESSAGES[code]) || "Something went wrong while signing you in.";
}
