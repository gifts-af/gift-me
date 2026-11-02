import "server-only";
import type { FactCategory } from "@gifts-af/core";
import type { Extract } from "@/lib/ai/extract";
import { createClient } from "@/lib/supabase/server";
import type { SaveResult } from "../settings";
import { processCapture, type SavedFact } from "./extract";
import { createCookieCaptureStore } from "./supabase-store";

// "What we know" on a person's page (ALL-25, D47), as the signed-in user (RLS).

export type AiFact = SavedFact & { sourceTitle: string | null; sourceUrl: string | null };
export type WhatWeKnow = { told: SavedFact[]; ai: AiFact[]; unread: number };

/** Active facts split into the buyer's own and the AI's (from captures), plus captures not read yet. */
export async function getWhatWeKnow(personId: string): Promise<WhatWeKnow> {
  const concierge = (await createClient()).schema("concierge");
  const [facts, captures] = await Promise.all([
    concierge
      .from("profile_facts")
      .select("id, category, value, source, source_id")
      .eq("person_id", personId)
      .eq("active", true)
      .order("created_at"),
    concierge.from("captures").select("id, status, page_title, source_url").eq("person_id", personId),
  ]);
  if (facts.error) throw new Error(`Couldn't load facts: ${facts.error.message}`);
  if (captures.error) throw new Error(`Couldn't load captures: ${captures.error.message}`);

  const byId = new Map(captures.data.map((c) => [c.id, c]));
  const fact = (f: { id: string; category: string; value: string }): SavedFact => ({
    id: f.id,
    category: f.category as FactCategory,
    value: f.value,
  });
  return {
    told: facts.data.filter((f) => f.source !== "capture").map(fact),
    ai: facts.data
      .filter((f) => f.source === "capture")
      .map((f) => {
        const c = f.source_id ? byId.get(f.source_id) : undefined;
        return { ...fact(f), sourceTitle: c?.page_title ?? null, sourceUrl: c?.source_url ?? null };
      }),
    unread: captures.data.filter((c) => c.status === "pending" || c.status === "failed").length,
  };
}

/** Removes a fact for good: inactive, so a later capture can't bring it back. */
export async function removeFact(factId: string): Promise<SaveResult> {
  const { data, error } = await (await createClient())
    .schema("concierge")
    .from("profile_facts")
    .update({ active: false })
    .eq("id", factId)
    .select("id");
  if (error || data.length === 0) {
    if (error) console.error("removing a fact failed", error);
    return { ok: false, error: "That didn't remove. Try again." };
  }
  return { ok: true };
}

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
