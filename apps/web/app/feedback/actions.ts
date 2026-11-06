"use server";

import { sendFeedback, type FeedbackResult } from "@/lib/feedback";
import { verifyTurnstile } from "@/lib/turnstile";

// The feedback box's server action (ALL-53). The Resend key is per
// environment (design/operations.md > Environments); without it the visitor sees a
// friendly error.
export async function submitFeedback(_previous: FeedbackResult | null, data: FormData): Promise<FeedbackResult> {
  return sendFeedback(data, {
    apiKey: process.env.RESEND_API_KEY,
    fetch,
    isHuman: (token) => verifyTurnstile(token, { secret: process.env.TURNSTILE_SECRET_KEY, fetch }),
  });
}
