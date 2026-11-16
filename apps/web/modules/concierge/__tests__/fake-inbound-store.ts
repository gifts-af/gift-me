import type { AskingRow, InboundFlag, InboundSettings, InboundStore, UnthreadedNotification } from "../inbound/store";

type FakeNotification = { id: string; userId: string; personId: string | null; providerMessageId: string | null; messageId: string | null };

/** In-memory InboundStore for unit tests. The Supabase one is tested against the local database. */
export class FakeInboundStore implements InboundStore {
  isEnabled = true;
  config: InboundSettings = { maxChoices: 5, maxPerDay: 20, linkHours: 72, threadLookupMax: 10, threadLookupDays: 60 };
  /** Lower-case email -> user id. */
  accounts = new Map<string, string>();
  paid = new Set<string>();
  events: string[] = [];
  peopleOf = new Map<string, { id: string; name: string }[]>();
  notifications: FakeNotification[] = [];
  asking: (AskingRow & { id: string })[] = [];
  uploads = new Map<string, { bytes: Uint8Array; type: string }>();
  flags = new Set<string>();
  calls: string[] = [];

  async enabled() {
    return this.isEnabled;
  }
  async settings() {
    return this.config;
  }
  async userByEmail(email: string) {
    this.calls.push("userByEmail");
    return this.accounts.get(email.toLowerCase()) ?? null;
  }
  async hasPaidFeatures(userId: string) {
    return this.paid.has(userId);
  }
  async countToday(userId: string) {
    return this.events.filter((u) => u === userId).length;
  }
  async recordEvent(userId: string) {
    this.events.push(userId);
  }
  async people(userId: string) {
    this.calls.push("people");
    return this.peopleOf.get(userId) ?? [];
  }
  async personForMessageId(userId: string, messageId: string) {
    const bare = messageId.trim().replace(/^<(.*)>$/, "$1");
    const n = this.notifications.find(
      (x) => x.userId === userId && x.messageId !== null && x.messageId.replace(/^<(.*)>$/, "$1") === bare,
    );
    return n?.personId ?? null;
  }
  async unthreadedNotifications(userId: string, _since: Date, limit: number): Promise<UnthreadedNotification[]> {
    return this.notifications
      .filter((n) => n.userId === userId && n.personId && n.providerMessageId && n.messageId === null)
      .slice(0, limit)
      .map((n) => ({ id: n.id, providerMessageId: n.providerMessageId! }));
  }
  async setMessageId(userId: string, notificationId: string, messageId: string) {
    const n = this.notifications.find((x) => x.id === notificationId && x.userId === userId);
    if (n && n.messageId === null) n.messageId = messageId;
  }
  async saveAsking(row: AskingRow) {
    const id = `msg-${this.asking.length + 1}`;
    this.asking.push({ ...row, id });
    return id;
  }
  async uploadImage(path: string, bytes: Uint8Array, type: string) {
    this.uploads.set(path, { bytes, type });
  }
  async claimFlag(userId: string, flag: InboundFlag) {
    const key = `${userId}:${flag}`;
    if (this.flags.has(key)) return false;
    this.flags.add(key);
    return true;
  }
}
