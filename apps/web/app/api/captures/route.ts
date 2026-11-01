import {
  createSupabaseCaptureStore,
  parseCaptureForm,
  saveCapture,
} from "@/modules/concierge";

// The Chrome extension (ALL-22) posts captures here from chrome-extension://{id}
// with the user's bearer token. The proxy lets this path through signed out;
// the token is checked by the store.

/** Read at request time so a missing value fails the request, not the build. */
function allowedOrigin(): string | null {
  const id = process.env.NEXT_PUBLIC_EXTENSION_ID;
  if (!id) {
    console.error("NEXT_PUBLIC_EXTENSION_ID is not set; /api/captures is disabled.");
    return null;
  }
  return `chrome-extension://${id}`;
}

function respond(request: Request, allowed: string | null, body: BodyInit | null, init: ResponseInit) {
  const headers = new Headers(init.headers);
  headers.set("Vary", "Origin");
  if (allowed && request.headers.get("origin") === allowed) {
    headers.set("Access-Control-Allow-Origin", allowed);
  }
  return new Response(body, { ...init, headers });
}

function json(request: Request, allowed: string | null, data: unknown, status: number) {
  return respond(request, allowed, JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export async function OPTIONS(request: Request) {
  const allowed = process.env.NEXT_PUBLIC_EXTENSION_ID ? allowedOrigin() : null;
  return respond(request, allowed, null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "authorization, content-type",
      "Access-Control-Max-Age": "86400",
    },
  });
}

export async function POST(request: Request) {
  const allowed = allowedOrigin();
  if (!allowed) return json(request, null, { error: "Captures aren't set up." }, 500);

  const match = /^Bearer\s+(.+)$/i.exec(request.headers.get("authorization") ?? "");
  if (!match) return json(request, allowed, { error: "Sign in again." }, 401);

  try {
    const store = await createSupabaseCaptureStore(match[1]);
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
    return json(request, allowed, { id: result.id }, 201);
  } catch (error) {
    console.error("capture failed", error);
    return json(request, allowed, { error: "Couldn't save the capture." }, 500);
  }
}
