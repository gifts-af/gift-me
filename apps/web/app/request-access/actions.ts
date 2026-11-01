"use server";

import { requestAccess, type RequestAccessResult } from "@/lib/access-request";

// The form's server action (ALL-47). The Resend key is per environment
// (README > Environments); without it the visitor sees a friendly error.
export async function submitAccessRequest(
  _previous: RequestAccessResult | null,
  data: FormData,
): Promise<RequestAccessResult> {
  return requestAccess(data, { apiKey: process.env.RESEND_API_KEY, fetch });
}
