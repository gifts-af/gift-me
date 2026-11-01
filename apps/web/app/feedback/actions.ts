"use server";

import { sendFeedback, type FeedbackResult } from "@/lib/feedback";

// The feedback box's server action (ALL-53). The Resend key is per
// environment (README > Environments); without it the visitor sees a
// friendly error.
export async function submitFeedback(_previous: FeedbackResult | null, data: FormData): Promise<FeedbackResult> {
  return sendFeedback(data, { apiKey: process.env.RESEND_API_KEY, fetch });
}
