import type { NotificationKind } from "../notify/templates";
import type { LinkRow, NewLink, NotifyStore } from "../notify/store";

export type FakeNotification = {
  id: string;
  userId: string;
  roundId: string | null;
  personId: string | null;
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

  /** Live people by id (ALL-31 file_note); a deleted person is simply absent. */
  people = new Map<string, { userId: string; name: string }>();
  /** Asking notes by id: subject and body until filed. */
  asking = new Map<string, { userId: string; text: string; filedTo: string | null }>();
  /** Captures created by fileInboundMessage, as "capture:person". */
  filed: string[] = [];
  /** Hands each filed note to the capture store, so the action can read it. */
  onFiled?: (note: { captureId: string; personId: string; text: string }) => void;

  async personName(userId: string, personId: string) {
    const p = this.people.get(personId);
    return p && p.userId === userId ? p.name : null;
  }

  // Like file_inbound_message: re-checked after the await and set with none in between, so only the first wins.
  async fileInboundMessage(userId: string, messageId: string, personId: string) {
    const m = this.asking.get(messageId);
    if (!m || m.userId !== userId || m.filedTo !== null) return null;
    if ((await this.personName(userId, personId)) === null) return null;
    if (m.filedTo !== null) return null;
    m.filedTo = personId;
    const captureId = `cap-${this.filed.length + 1}`;
    this.filed.push(`${captureId}:${personId}`);
    this.onFiled?.({ captureId, personId, text: m.text });
    return captureId;
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
      this.links.push({
        ...r,
        personId: r.personId ?? null,
        inboundMessageId: r.inboundMessageId ?? null,
        usedAt: null,
        notificationId: null,
      });
    }
  }

  async insertNotification(row: {
    userId: string;
    roundId: string | null;
    personId: string | null;
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
    personId: l.personId,
    inboundMessageId: l.inboundMessageId,
  };
}
