import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database, FactCategory } from "@gifts-af/core";
import { supabaseKey, supabaseUrl } from "@/lib/supabase/env";
import { createClient as createCookieClient } from "@/lib/supabase/server";
import { factKey } from "./extract";
import type { CaptureStatus, CaptureStore } from "./store";

/**
 * Capture persistence as the signed-in user: the bearer token rides on every
 * request, so Row Level Security applies. Null when the token isn't valid.
 */
export async function createSupabaseCaptureStore(accessToken: string): Promise<CaptureStore | null> {
  const supabase = createClient<Database>(supabaseUrl!, supabaseKey!, {
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await supabase.auth.getUser(accessToken);
  if (error || !data.user) return null;
  return captureStoreFor(supabase, data.user.id);
}

/** The same store for server actions, as the user signed in by cookie. Null when signed out. */
export async function createCookieCaptureStore(): Promise<CaptureStore | null> {
  const supabase = await createCookieClient();
  const userId = (await supabase.auth.getClaims()).data?.claims?.sub;
  if (!userId) return null;
  return captureStoreFor(supabase as unknown as SupabaseClient<Database>, userId);
}

// Postgres "invalid input syntax" (a malformed uuid): treated as not found.
const INVALID_TEXT = "22P02";

export function captureStoreFor(supabase: SupabaseClient<Database>, userId: string): CaptureStore {
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
      const { data: row, error: err } = await supabase.from("people").select("id").eq("id", personId).maybeSingle();
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
          user_id: userId,
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
      const { error: err } = await concierge().from("captures").update({ screenshot_path: path }).eq("id", id);
      if (err) throw err;
    },
    async deleteCapture(id) {
      const { error: err } = await concierge().from("captures").delete().eq("id", id);
      if (err) throw err;
    },

    async extractionSettings() {
      return {
        enabled: (await setting("capture_extraction_enabled")) === 1,
        minConfidencePct: await setting("capture_fact_min_confidence_pct"),
        timeoutMs: await setting("capture_extract_timeout_ms"),
      };
    },
    async loadCapture(id) {
      const { data: c, error: err } = await concierge()
        .from("captures")
        .select("id, person_id, status, source_url, page_title, text_excerpt, note, screenshot_path")
        .eq("id", id)
        .maybeSingle();
      if (err?.code === INVALID_TEXT) return null;
      if (err) throw err;
      if (!c) return null;
      // A separate query: PostgREST doesn't embed across schemas.
      const { data: person, error: personErr } = await supabase
        .from("people")
        .select("relationship")
        .eq("id", c.person_id)
        .maybeSingle();
      if (personErr) throw personErr;
      if (!person) return null;
      return {
        id: c.id,
        personId: c.person_id,
        status: c.status as CaptureStatus,
        relationship: person.relationship,
        url: c.source_url ?? "",
        title: c.page_title ?? "",
        text: c.text_excerpt ?? "",
        note: c.note,
        screenshotPath: c.screenshot_path,
      };
    },
    async downloadScreenshot(path) {
      const { data: blob, error: err } = await supabase.storage.from("captures").download(path);
      if (err) throw err;
      return new Uint8Array(await blob.arrayBuffer());
    },
    async factKeys(personId) {
      const { data: rows, error: err } = await concierge()
        .from("profile_facts")
        .select("category, value")
        .eq("person_id", personId);
      if (err) throw err;
      return new Set(rows.map((r) => factKey(r.category, r.value)));
    },
    async capturedFacts(captureId) {
      const { data: rows, error: err } = await concierge()
        .from("profile_facts")
        .select("id, category, value")
        .eq("source", "capture")
        .eq("source_id", captureId)
        .eq("active", true)
        .order("created_at");
      if (err) throw err;
      return rows.map((r) => ({ id: r.id, category: r.category as FactCategory, value: r.value }));
    },
    async insertFacts(personId, captureId, facts) {
      const { data: rows, error: err } = await concierge()
        .from("profile_facts")
        // A fact the person already has is skipped, not an error: two reads of one
        // capture can overlap (unique index profile_facts_person_fact_key).
        .upsert(
          facts.map((f) => ({
            user_id: userId,
            person_id: personId,
            category: f.category,
            value: f.value,
            source: "capture",
            source_id: captureId,
            confirmed: false,
          })),
          { onConflict: "person_id,category,value_key", ignoreDuplicates: true },
        )
        .select("id, category, value");
      if (err) throw err;
      return rows.map((r) => ({ id: r.id, category: r.category as FactCategory, value: r.value }));
    },
    async setCaptureStatus(id, status) {
      const { error: err } = await concierge().from("captures").update({ status }).eq("id", id);
      if (err) throw err;
    },
  };
}
