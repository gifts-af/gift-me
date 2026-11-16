// Everything handleInbound needs from the database (ALL-31). The interface keeps the
// handler testable with an in-memory store; supabase-store.ts is the real one, on the
// service-role client, and keeps every query to the one user it is given.

export type InboundSettings = {
  /** inbound_match_max_choices: most people offered in "Who is this about?". */
  maxChoices: number;
  /** inbound_max_per_user_per_day: messages accepted plus emails sent back. */
  maxPerDay: number;
  /** inbound_link_hours: how long the "Who is this about?" buttons work. */
  linkHours: number;
  /** inbound_thread_lookup_max: most sent emails read back from Resend to match a reply. */
  threadLookupMax: number;
  /** inbound_thread_lookup_days: how far back those sent emails go. */
  threadLookupDays: number;
};

/** A note waiting on "Who is this about?". `body` is already cut to the capture text limit. */
export type AskingRow = {
  userId: string;
  subject: string;
  body: string;
  imagePath: string | null;
  imageType: string | null;
};

/** One of our sent notifications whose Message-ID we haven't read back from the provider yet. */
export type UnthreadedNotification = { id: string; providerMessageId: string };

export type InboundFlag = "notes_unpaid_reply_sent_at" | "notes_tip_sent_at";

export interface InboundStore {
  /** inbound_email_enabled is 1 (the off switch, E7). */
  enabled(): Promise<boolean>;
  settings(): Promise<InboundSettings>;
  /** The account whose email is this address, ignoring case; null for none. */
  userByEmail(email: string): Promise<string | null>;
  hasPaidFeatures(userId: string): Promise<boolean>;
  /** Messages accepted plus emails sent back today. */
  countToday(userId: string): Promise<number>;
  /** Counts one accepted message or one email sent back toward the daily cap. */
  recordEvent(userId: string): Promise<void>;
  /** The user's live people. */
  people(userId: string): Promise<{ id: string; name: string }[]>;
  /**
   * The live person on this user's notification whose Message-ID is `messageId` (with or
   * without angle brackets); null when none.
   */
  personForMessageId(userId: string, messageId: string): Promise<string | null>;
  /**
   * This user's notifications about a person, sent since `since`, whose Message-ID was never
   * read back (Resend sets it a moment after sending), most recent first.
   */
  unthreadedNotifications(userId: string, since: Date, limit: number): Promise<UnthreadedNotification[]>;
  setMessageId(userId: string, notificationId: string, messageId: string): Promise<void>;
  /** Saves an asking message; returns its id. */
  saveAsking(row: AskingRow): Promise<string>;
  /** Into the private captures bucket. Throws on failure. */
  uploadImage(path: string, bytes: Uint8Array, type: string): Promise<void>;
  /** Sets a one-time flag; true only for the call that set it. */
  claimFlag(userId: string, flag: InboundFlag): Promise<boolean>;
}
