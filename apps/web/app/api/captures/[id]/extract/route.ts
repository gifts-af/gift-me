import { createExtractor } from "@/lib/ai/extract";
import { z } from "zod";
import { AI_MODELS } from "@/lib/ai/models";
import { logEvent } from "@/lib/log";
import { CaptureNotFound, createSupabaseCaptureStore, processCapture } from "@/modules/concierge";
import { allowedOrigin, bearer, json, preflight } from "../../http";

// Try again from the extension popup (ALL-25): reads a pending or failed
// capture. Same bearer-token and CORS rules as POST /api/captures.

export const maxDuration = 60;

const captureId = z.uuid();

export async function OPTIONS(request: Request) {
  return preflight(request);
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const allowed = allowedOrigin();
  if (!allowed) return json(request, null, { error: "Captures aren't set up." }, 500);

  const token = bearer(request);
  if (!token) return json(request, allowed, { error: "Sign in again." }, 401);

  // E4: the id is checked here, at the boundary, before any reading.
  const parsed = captureId.safeParse((await params).id);
  if (!parsed.success) return json(request, allowed, { error: "That capture wasn't found." }, 404);
  const id = parsed.data;

  try {
    const store = await createSupabaseCaptureStore(token);
    if (!store) return json(request, allowed, { error: "Sign in again." }, 401);
    const extraction = await processCapture(store, createExtractor(AI_MODELS.extraction), id);
    return json(request, allowed, { extraction }, 200);
  } catch (error) {
    if (error instanceof CaptureNotFound) {
      return json(request, allowed, { error: "That capture wasn't found." }, 404);
    }
    // E6: the error's text may quote the page, so only its type is logged.
    logEvent("capture.retry_failed", { capture_id: id, error: error instanceof Error ? error.name : "unknown" });
    return json(request, allowed, { error: "Couldn't read the capture." }, 500);
  }
}
