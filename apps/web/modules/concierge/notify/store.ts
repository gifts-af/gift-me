import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import type { ActionName } from "./actions";
import type { NotificationKind } from "./templates";

// Everything notify() and the action links need from the database (ALL-23).
// The interface keeps the logic testable with an in-memory store; the Supabase
// version below is thin glue on the server-only admin client (T26: the server
// writes notifications and action_links, users can't).

export type LinkRow = {
  userId: string;
  roundId: string | null;
  action: ActionName;
  expiresAt: Date;
  usedAt: Date | null;
};

/** A new action link. Only the token's hash is ever stored (AC-14). */
export type NewLink = {
  hash: string;
  userId: string;
  roundId: string | null;
  action: ActionName;
  expiresAt: Date;
};

export interface NotifyStore {
  recipient(userId: string): Promise<{ email: string | null; timezone: string | null }>;
  setting(key: string): Promise<number>;
  insertLinks(rows: NewLink[]): Promise<void>;
  insertNotification(row: {
    userId: string;
    roundId: string | null;
    kind: NotificationKind;
    channel: string;
  }): Promise<string>;
  finishNotification(
    id: string,
    result: { sentAt: Date; providerMessageId: string } | { error: string },
  ): Promise<void>;
  attachLinks(hashes: string[], notificationId: string): Promise<void>;
  findLink(hash: string): Promise<LinkRow | null>;
  /** Marks the link used if it is this user's, unused and unexpired; null otherwise. */
  claimLink(hash: string, userId: string, now: Date): Promise<LinkRow | null>;
}

const LINK_COLUMNS = "user_id, round_id, action, expires_at, used_at";

type LinkDbRow = {
  user_id: string;
  round_id: string | null;
  action: string;
  expires_at: string;
  used_at: string | null;
};

function toLinkRow(r: LinkDbRow): LinkRow {
  return {
    userId: r.user_id,
    roundId: r.round_id,
    action: r.action as ActionName,
    expiresAt: new Date(r.expires_at),
    usedAt: r.used_at ? new Date(r.used_at) : null,
  };
}

function fail(what: string, error: { message: string }): never {
  throw new Error(`${what}: ${error.message}`);
}

export function createSupabaseNotifyStore(): NotifyStore {
  const db = createAdminClient();
  const concierge = db.schema("concierge");

  return {
    async recipient(userId) {
      const { data, error } = await db
        .from("profiles")
        .select("email, timezone")
        .eq("id", userId)
        .maybeSingle();
      if (error) fail("Loading the recipient failed", error);
      return { email: data?.email ?? null, timezone: data?.timezone ?? null };
    },

    async setting(key) {
      const { data, error } = await concierge.rpc("setting_int", { p_key: key });
      if (error) fail(`Reading setting ${key} failed`, error);
      return data;
    },

    async insertLinks(rows) {
      if (rows.length === 0) return;
      const { error } = await concierge.from("action_links").insert(
        rows.map((r) => ({
          token_hash: r.hash,
          user_id: r.userId,
          round_id: r.roundId,
          action: r.action,
          expires_at: r.expiresAt.toISOString(),
        })),
      );
      if (error) fail("Saving action links failed", error);
    },

    async insertNotification(row) {
      const { data, error } = await concierge
        .from("notifications")
        .insert({
          user_id: row.userId,
          round_id: row.roundId,
          kind: row.kind,
          channel: row.channel,
        })
        .select("id")
        .single();
      if (error) fail("Saving the notification failed", error);
      return data.id;
    },

    async finishNotification(id, result) {
      const update =
        "error" in result
          ? { error: result.error }
          : {
              sent_at: result.sentAt.toISOString(),
              provider_message_id: result.providerMessageId,
            };
      const { error } = await concierge.from("notifications").update(update).eq("id", id);
      if (error) fail("Updating the notification failed", error);
    },

    async attachLinks(hashes, notificationId) {
      if (hashes.length === 0) return;
      const { error } = await concierge
        .from("action_links")
        .update({ notification_id: notificationId })
        .in("token_hash", hashes);
      if (error) fail("Linking action links to the notification failed", error);
    },

    async findLink(hash) {
      const { data, error } = await concierge
        .from("action_links")
        .select(LINK_COLUMNS)
        .eq("token_hash", hash)
        .maybeSingle();
      if (error) fail("Loading the action link failed", error);
      return data ? toLinkRow(data) : null;
    },

    // One conditional UPDATE … RETURNING, so two clicks can't both claim the link.
    async claimLink(hash, userId, now) {
      const { data, error } = await concierge
        .from("action_links")
        .update({ used_at: now.toISOString() })
        .eq("token_hash", hash)
        .eq("user_id", userId)
        .is("used_at", null)
        .gt("expires_at", now.toISOString())
        .select(LINK_COLUMNS)
        .maybeSingle();
      if (error) fail("Claiming the action link failed", error);
      return data ? toLinkRow(data) : null;
    },
  };
}
