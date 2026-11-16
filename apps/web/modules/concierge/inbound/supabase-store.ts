import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@gifts-af/core";
import { hasPaidFeatures } from "../paid-features";
import type { InboundStore } from "./store";

/** Strips one pair of angle brackets: "<a@b>" and "a@b" name the same message. */
function bareMessageId(id: string): string {
  return id.trim().replace(/^<(.*)>$/, "$1");
}

function fail(what: string, error: { message: string }): never {
  throw new Error(`${what}: ${error.message}`);
}

/**
 * The inbound store on the service-role client (ALL-31). RLS doesn't apply, so every
 * query that touches a user's rows filters by that user itself. Tests pass a client for
 * the local database (E3).
 */
export function createSupabaseInboundStore(db: SupabaseClient<Database>): InboundStore {
  const concierge = () => db.schema("concierge");
  const setting = async (key: string): Promise<number> => {
    const { data, error } = await concierge().rpc("setting_int", { p_key: key });
    if (error) fail(`Reading setting ${key} failed`, error);
    // setting_int returns null for an unknown key: an error, not a default (T23).
    if (data === null || data === undefined) throw new Error(`setting ${key} missing`);
    return data;
  };

  return {
    async enabled() {
      return (await setting("inbound_email_enabled")) === 1;
    },

    async settings() {
      return {
        maxChoices: await setting("inbound_match_max_choices"),
        maxPerDay: await setting("inbound_max_per_user_per_day"),
        linkHours: await setting("inbound_link_hours"),
        threadLookupMax: await setting("inbound_thread_lookup_max"),
        threadLookupDays: await setting("inbound_thread_lookup_days"),
      };
    },

    async userByEmail(email) {
      // Account emails are stored lower-case (Supabase Auth lower-cases them), so an exact
      // match on the lower-cased sender is a case-insensitive match without LIKE patterns.
      const { data, error } = await db
        .from("profiles")
        .select("id")
        .eq("email", email.trim().toLowerCase())
        .limit(2);
      if (error) fail("Finding the account by email failed", error);
      // Two accounts on one address would be ambiguous: accept neither.
      return data.length === 1 ? data[0].id : null;
    },

    hasPaidFeatures(userId) {
      return hasPaidFeatures(db, userId);
    },

    async countToday(userId) {
      const { data, error } = await concierge().rpc("inbound_count_today", { p_user_id: userId });
      if (error) fail("Counting today's inbound events failed", error);
      return data ?? 0;
    },

    async recordEvent(userId) {
      const { error } = await concierge().from("inbound_events").insert({ user_id: userId });
      if (error) fail("Recording an inbound event failed", error);
    },

    async people(userId) {
      const { data, error } = await db
        .from("people")
        .select("id, name")
        .eq("user_id", userId)
        .is("deleted_at", null)
        .order("created_at");
      if (error) fail("Loading people failed", error);
      return data;
    },

    async personForMessageId(userId, messageId) {
      const bare = bareMessageId(messageId);
      if (bare === "") return null;
      const { data, error } = await concierge()
        .from("notifications")
        .select("person_id")
        .eq("user_id", userId)
        .in("message_id", [bare, `<${bare}>`])
        .not("person_id", "is", null)
        .limit(1);
      if (error) fail("Finding the notification by Message-ID failed", error);
      const personId = data[0]?.person_id;
      if (!personId) return null;
      const person = await db
        .from("people")
        .select("id")
        .eq("id", personId)
        .eq("user_id", userId)
        .is("deleted_at", null)
        .maybeSingle();
      if (person.error) fail("Checking the notification's person failed", person.error);
      return person.data ? personId : null;
    },

    async unthreadedNotifications(userId, since, limit) {
      const { data, error } = await concierge()
        .from("notifications")
        .select("id, provider_message_id")
        .eq("user_id", userId)
        .not("person_id", "is", null)
        .not("provider_message_id", "is", null)
        .is("message_id", null)
        .gte("created_at", since.toISOString())
        .order("created_at", { ascending: false })
        .limit(limit);
      if (error) fail("Loading unthreaded notifications failed", error);
      return data.map((r) => ({ id: r.id, providerMessageId: r.provider_message_id as string }));
    },

    async setMessageId(userId, notificationId, messageId) {
      const { error } = await concierge()
        .from("notifications")
        .update({ message_id: messageId })
        .eq("id", notificationId)
        .eq("user_id", userId)
        .is("message_id", null);
      if (error) fail("Saving the notification's Message-ID failed", error);
    },

    async saveAsking(row) {
      const { data, error } = await concierge()
        .from("inbound_messages")
        .insert({
          user_id: row.userId,
          status: "asking",
          subject: row.subject,
          body: row.body,
          image_path: row.imagePath,
          image_type: row.imageType,
        })
        .select("id")
        .single();
      if (error) fail("Saving the asking message failed", error);
      return data.id;
    },

    async uploadImage(path, bytes, type) {
      const { error } = await db.storage
        .from("captures")
        .upload(path, new Blob([bytes as BlobPart], { type }), { contentType: type, upsert: false });
      if (error) fail("Uploading the note's image failed", error);
    },

    async claimFlag(userId, flag) {
      const { data, error } = await concierge().rpc("claim_inbound_flag", { p_user_id: userId, p_flag: flag });
      if (error) fail("Claiming the one-time flag failed", error);
      return data === true;
    },
  };
}
