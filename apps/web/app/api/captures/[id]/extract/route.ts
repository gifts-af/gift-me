import { createExtractor } from "@/lib/ai/extract";
import { AI_MODELS } from "@/lib/ai/models";
import { CaptureNotFound, createSupabaseCaptureStore, processCapture } from "@/modules/concierge";
import { allowedOrigin, bearer, json, preflight } from "../../http";

// Try again from the extension popup (ALL-25): reads a pending or failed
// capture. Same bearer-token and CORS rules as POST /api/captures.

export const maxDuration = 60;

export async function OPTIONS(request: Request) {
  return preflight(request);
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const allowed = allowedOrigin();
  if (!allowed) return json(request, null, { error: "Captures aren't set up." }, 500);

  const token = bearer(request);
  if (!token) return json(request, allowed, { error: "Sign in again." }, 401);

  try {
    const store = await createSupabaseCaptureStore(token);
    if (!store) return json(request, allowed, { error: "Sign in again." }, 401);
    const { id } = await params;
    const extraction = await processCapture(store, createExtractor(AI_MODELS.extraction), id);
    return json(request, allowed, { extraction }, 200);
  } catch (error) {
    if (error instanceof CaptureNotFound) {
      return json(request, allowed, { error: "That capture wasn't found." }, 404);
    }
    console.error("capture retry failed", error);
    return json(request, allowed, { error: "Couldn't read the capture." }, 500);
  }
}
