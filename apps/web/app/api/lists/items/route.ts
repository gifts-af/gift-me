import { randomUUID } from "node:crypto";
import { appSettingInt } from "@/lib/app-settings";
import { allowedOrigin, bearer, json, preflight } from "@/lib/extension-http";
import { logEvent } from "@/lib/log";
import { createAdminClient } from "@/lib/supabase/admin";
import { createBearerClient } from "@/lib/supabase/bearer";
import { addFromExtension, extensionAddStoreFor, parseExtensionAddForm } from "@/modules/lists";

// "Add to my list" (ALL-78): the Chrome extension posts a product, and maybe a
// cropped photo, here from chrome-extension://{id} with the user's bearer
// token. Same pattern as POST /api/captures: the proxy lets this path through
// signed out, and the token is checked here. The request and response shapes
// are version 1 (E4): ExtensionAddResponse in modules/lists/lib/extension-add.ts.

export async function OPTIONS(request: Request) {
  return preflight(request);
}

export async function POST(request: Request) {
  const allowed = allowedOrigin();
  if (!allowed) return json(request, null, { error: "Adding isn't set up." }, 500);

  const token = bearer(request);
  if (!token) return json(request, allowed, { error: "Sign in again." }, 401);

  try {
    const user = await createBearerClient(token);
    if (!user) return json(request, allowed, { error: "Sign in again." }, 401);

    // setting_int is for signed-in users, so both are read as this one.
    const [enabled, photoMaxBytes] = await Promise.allSettled([
      appSettingInt("extension_add_enabled", user.db),
      appSettingInt("list_photo_max_bytes", user.db),
    ]);
    // The off switch (AC-20, E7). A switch that can't be read counts as off.
    if (enabled.status !== "fulfilled" || enabled.value !== 1) {
      return json(request, allowed, { error: "Adding from the extension is paused." }, 503);
    }
    if (photoMaxBytes.status !== "fulfilled") throw photoMaxBytes.reason;

    let form: FormData;
    try {
      form = await request.formData();
    } catch {
      // Not the multipart form version 1 sends, so not a current build (AC-21).
      return json(request, allowed, { error: "Update the GiftsAF extension." }, 400);
    }
    const parsed = parseExtensionAddForm(form);
    if (!parsed.ok) return json(request, allowed, { error: parsed.error }, parsed.status);

    const store = extensionAddStoreFor(user.db, user.userId, createAdminClient);
    // A fresh id every time: it names the photo's file, so it is never reused.
    const result = await addFromExtension(store, {
      ...parsed.input,
      itemId: randomUUID(),
      photoMaxBytes: photoMaxBytes.value,
    });
    return json(request, allowed, result.body, result.status);
  } catch (error) {
    // addFromExtension logs its own failures; this is checking the token or reading a setting.
    logEvent("list.extension_add", { outcome: "failed", error: error instanceof Error ? error.name : "unknown" });
    return json(request, allowed, { error: "Couldn't add that gift. Try again." }, 500);
  }
}
