import "server-only";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@gifts-af/core";
import { supabaseKey, supabaseUrl } from "@/lib/supabase/env";
import type { CaptureStore } from "./store";

/**
 * Capture persistence as the signed-in user: the bearer token rides on every
 * request, so Row Level Security applies. Null when the token isn't valid.
 */
export async function createSupabaseCaptureStore(
  accessToken: string,
): Promise<CaptureStore | null> {
  const supabase = createClient<Database>(supabaseUrl!, supabaseKey!, {
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data, error } = await supabase.auth.getUser(accessToken);
  if (error || !data.user) return null;

  const concierge = () => supabase.schema("concierge");
  const setting = async (key: string) => {
    const { data: value, error: err } = await concierge().rpc("setting_int", { p_key: key });
    if (err) throw err;
    // setting_int returns null for an unknown key; that is an error, not a default (T23).
    if (value === null || value === undefined) throw new Error(`setting ${key} missing`);
    return value;
  };

  return {
    async limits() {
      return {
        textMaxChars: await setting("capture_text_max_chars"),
        screenshotMaxBytes: await setting("capture_screenshot_max_bytes"),
      };
    },
    async personExists(personId) {
      const { data: row, error: err } = await supabase
        .from("people")
        .select("id")
        .eq("id", personId)
        .maybeSingle();
      if (err) throw err;
      return row !== null;
    },
    async insertCapture(row) {
      const { data: created, error: err } = await concierge()
        .from("captures")
        .insert({
          person_id: row.personId,
          source_url: row.url,
          page_title: row.title,
          text_excerpt: row.text,
          note: row.note,
          user_id: data.user.id,
        })
        .select("id, user_id")
        .single();
      if (err) throw err;
      return { id: created.id, userId: created.user_id };
    },
    async uploadScreenshot(path, jpeg) {
      const { error: err } = await supabase.storage
        .from("captures")
        .upload(path, jpeg, { contentType: "image/jpeg", upsert: false });
      if (err) throw err;
    },
    async setScreenshotPath(id, path) {
      const { error: err } = await concierge()
        .from("captures")
        .update({ screenshot_path: path })
        .eq("id", id);
      if (err) throw err;
    },
    async deleteCapture(id) {
      const { error: err } = await concierge().from("captures").delete().eq("id", id);
      if (err) throw err;
    },
  };
}
