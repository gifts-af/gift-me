import "server-only";
import type { Extract } from "@/lib/ai/extract";
import { createClient } from "@/lib/supabase/server";
import type { SaveResult } from "../settings";
import { processCapture } from "./extract";
import { createCookieCaptureStore } from "./supabase-store";

/** Reads the person's pending and failed captures, one at a time. */
export async function readUnreadCaptures(extract: Extract, personId: string): Promise<SaveResult> {
  const store = await createCookieCaptureStore();
  if (!store) return { ok: false, error: "Your session ended. Sign in again." };
  const { data, error } = await (await createClient())
    .schema("concierge")
    .from("captures")
    .select("id")
    .eq("person_id", personId)
    .in("status", ["pending", "failed"])
    .order("created_at");
  if (error) {
    console.error("listing unread captures failed", error);
    return { ok: false, error: "Couldn't read them. Try again." };
  }
  let failed = 0;
  for (const { id } of data) {
    const result = await processCapture(store, extract, id);
    if (result.status !== "extracted") failed++;
  }
  return failed === 0 ? { ok: true } : { ok: false, error: "Couldn't read them. Try again." };
}
