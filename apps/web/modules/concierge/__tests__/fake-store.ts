import type { NotificationKind } from "../notify/templates";
import type { LinkRow, NewLink, NotifyStore } from "../notify/store";

export type FakeNotification = {
  id: string;
  userId: string;
  roundId: string | null;
  kind: NotificationKind;
  channel: string;
  sentAt: Date | null;
  providerMessageId: string | null;
  error: string | null;
};

export type FakeLink = LinkRow & { hash: string; notificationId: string | null };

/** In-memory NotifyStore for unit tests. */
export class FakeStore implements NotifyStore {
  recipients = new Map<string, { email: string | null; timezone: string | null }>();
  settings = new Map<string, number>();
  links: FakeLink[] = [];
  notifications: FakeNotification[] = [];

  roundPeople = new Map<string, string>();

  async roundPersonId(roundId: string) {
    return this.roundPeople.get(roundId) ?? null;
  }

  /** Rounds cancelled through cancel_held_gift, as "round:user". The real one is tested against the database. */
  cancelled: string[] = [];

  async cancelHeldGift(roundId: string, userId: string) {
    this.cancelled.push(`${roundId}:${userId}`);
    return { cancelled: 1, ordering: 0, onItsWay: 0 };
  }

  async recipient(userId: string) {
    return this.recipients.get(userId) ?? { email: null, timezone: null };
  }

  async setting(key: string) {
    const v = this.settings.get(key);
    if (v === undefined) throw new Error(`No setting ${key}`);
    return v;
  }

  async insertLinks(rows: NewLink[]) {
    for (const r of rows) {
      if (this.links.some((l) => l.hash === r.hash)) throw new Error("duplicate token_hash");
      this.links.push({ ...r, usedAt: null, notificationId: null });
    }
  }

  async insertNotification(row: {
    userId: string;
    roundId: string | null;
    kind: NotificationKind;
    channel: string;
  }) {
    const id = `n${this.notifications.length + 1}`;
    this.notifications.push({ id, ...row, sentAt: null, providerMessageId: null, error: null });
    return id;
  }

  async finishNotification(
    id: string,
    result: { sentAt: Date; providerMessageId: string } | { error: string },
  ) {
    const n = this.notifications.find((x) => x.id === id);
    if (!n) throw new Error(`No notification ${id}`);
    if ("error" in result) n.error = result.error;
    else {
      n.sentAt = result.sentAt;
      n.providerMessageId = result.providerMessageId;
    }
  }

  async attachLinks(hashes: string[], notificationId: string) {
    for (const l of this.links) if (hashes.includes(l.hash)) l.notificationId = notificationId;
  }

  async findLink(hash: string) {
    const l = this.links.find((x) => x.hash === hash);
    return l ? toRow(l) : null;
  }

  // Check and set with no await in between, like the single conditional UPDATE in SQL,
  // so concurrent claims of one link can't both win.
  async claimLink(hash: string, userId: string, now: Date) {
    const l = this.links.find(
      (x) =>
        x.hash === hash &&
        x.userId === userId &&
        x.usedAt === null &&
        x.expiresAt.getTime() > now.getTime(),
    );
    if (!l) return null;
    l.usedAt = now;
    return toRow(l);
  }
}

function toRow(l: FakeLink): LinkRow {
  return {
    userId: l.userId,
    roundId: l.roundId,
    action: l.action,
    expiresAt: l.expiresAt,
    usedAt: l.usedAt,
  };
}
