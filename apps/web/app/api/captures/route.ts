import { createExtractor } from "@/lib/ai/extract";
import { AI_MODELS } from "@/lib/ai/models";
import { logEvent } from "@/lib/log";
import {
  createSupabaseCaptureStore,
  parseCaptureForm,
  processCapture,
  saveCapture,
  type Extraction,
} from "@/modules/concierge";
import { allowedOrigin, bearer, json, preflight } from "./http";

// The Chrome extension (ALL-22) posts captures here from chrome-extension://{id}
// with the user's bearer token. The proxy lets this path through signed out;
// the token is checked by the store. The capture is then read by the AI model
// in the same request (ALL-25, T48), so the popup can show what was learned.

// Reading a capture takes 3–7 s; this leaves room for a slow model call.
export const maxDuration = 60;

export async function OPTIONS(request: Request) {
  return preflight(request);
}

export async function POST(request: Request) {
  const allowed = allowedOrigin();
  if (!allowed) return json(request, null, { error: "Captures aren't set up." }, 500);

  const token = bearer(request);
  if (!token) return json(request, allowed, { error: "Sign in again." }, 401);

  try {
    const store = await createSupabaseCaptureStore(token);
    if (!store) return json(request, allowed, { error: "Sign in again." }, 401);

    let form: FormData;
    try {
      form = await request.formData();
    } catch {
      return json(request, allowed, { error: "That capture wasn't readable." }, 400);
    }
    const input = parseCaptureForm(form);
    if (!input) return json(request, allowed, { error: "That capture wasn't readable." }, 400);

    const result = await saveCapture(store, input);
    if (!result.ok) return json(request, allowed, { error: result.error }, result.status);

    // The capture is saved either way; a failed read can be retried.
    let extraction: Extraction;
    try {
      extraction = await processCapture(store, createExtractor(AI_MODELS.extraction), result.id);
    } catch (error) {
      // E6: ids and the error type only; the text may quote the page.
      logEvent("capture.extract_error", { capture_id: result.id, error: error instanceof Error ? error.name : "unknown" });
      extraction = { status: "failed", facts: [] };
    }
    return json(request, allowed, { id: result.id, extraction }, 201);
  } catch (error) {
    logEvent("capture.save_failed", { error: error instanceof Error ? error.name : "unknown" });
    return json(request, allowed, { error: "Couldn't save the capture." }, 500);
  }
}
