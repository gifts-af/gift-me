import { describe, expect, it, vi } from "vitest";
import type { Channel } from "../notify/channels";
import { notify, sendTestNotification, type NotifyInput } from "../notify/notify";
import { SAMPLE_DATA, type NotificationKind } from "../notify/templates";
import { hashActionToken } from "../notify/tokens";
import { FakeStore } from "./fake-store";

const USER = "user-1";
const NOW = new Date("2026-11-01T12:00:00Z");
const BASE = "https://giftsaf.test";
const HOUR = 60 * 60 * 1000;

type Sent = Parameters<Channel["send"]>[0];

function fakeChannel(name: string, result: Awaited<ReturnType<Channel["send"]>>) {
  const sent: Sent[] = [];
  const channel: Channel = {
    name,
    send: vi.fn(async (email: Sent) => {
      sent.push(email);
      return result;
    }),
  };
  return { channel, sent };
}

function storeWithUser(email: string | null = "mom@example.com") {
  const store = new FakeStore();
  store.recipients.set(USER, { email, timezone: "America/New_York" });
  store.settings.set("test_action_link_hours", 24);
  return store;
}

function sendTest(store: FakeStore, channels: Channel[]) {
  return notify(
    {
      userId: USER,
      kind: "test",
      data: {},
      links: { tryIt: { action: "test", expiresAt: new Date(NOW.getTime() + HOUR) } },
    },
    { store, channels, baseUrl: BASE, now: NOW },
  );
}

const tokenIn = (html: string) => html.match(/\/a\/([A-Za-z0-9_-]{43})(?![A-Za-z0-9_-])/)?.[1];

describe("notify", () => {
  it("emails the recipient a one-time link and stores only its hash", async () => {
    const store = storeWithUser();
    const { channel, sent } = fakeChannel("email", { ok: true, id: "msg-1" });

    expect(await sendTest(store, [channel])).toEqual({ ok: true });

    expect(sent).toHaveLength(1);
    expect(sent[0].to).toBe("mom@example.com");
    const token = tokenIn(sent[0].html);
    expect(token).toBeDefined();
    expect(sent[0].html).toContain(`${BASE}/a/${token}`);

    expect(store.links).toHaveLength(1);
    const link = store.links[0];
    expect(link.hash).toBe(hashActionToken(token!));
    expect(JSON.stringify(store.links)).not.toContain(token!);
    expect(link).toMatchObject({ userId: USER, roundId: null, action: "test", usedAt: null });
    expect(link.notificationId).toBe(store.notifications[0].id);
  });

  it("finishes the notification row with sentAt and the provider id", async () => {
    const store = storeWithUser();
    const { channel } = fakeChannel("email", { ok: true, id: "msg-1" });
    await sendTest(store, [channel]);

    expect(store.notifications).toEqual([
      expect.objectContaining({
        userId: USER,
        roundId: null,
        kind: "test",
        channel: "email",
        sentAt: NOW,
        providerMessageId: "msg-1",
        error: null,
      }),
    ]);
  });

  it("records a failing channel's error and returns ok: false without throwing", async () => {
    const store = storeWithUser();
    const { channel } = fakeChannel("email", { ok: false, error: "Resend responded 500" });

    expect(await sendTest(store, [channel])).toEqual({ ok: false, error: "Resend responded 500" });
    expect(store.notifications).toHaveLength(1);
    expect(store.notifications[0]).toMatchObject({ error: "Resend responded 500", sentAt: null });
  });

  it("sends through every channel and writes a row for each (AC-13)", async () => {
    const store = storeWithUser();
    const a = fakeChannel("email", { ok: true, id: "msg-1" });
    const b = fakeChannel("sms", { ok: false, error: "no phone" });

    expect(await sendTest(store, [a.channel, b.channel])).toEqual({ ok: true });
    expect(a.channel.send).toHaveBeenCalledTimes(1);
    expect(b.channel.send).toHaveBeenCalledTimes(1);
    expect(store.notifications.map((n) => n.channel)).toEqual(["email", "sms"]);
    expect(store.links[0].notificationId).toBe(store.notifications[0].id);
  });

  it("sends nothing and writes no rows when the recipient has no email", async () => {
    const store = storeWithUser(null);
    const { channel } = fakeChannel("email", { ok: true, id: "msg-1" });

    const result = await sendTest(store, [channel]);
    expect(result.ok).toBe(false);
    expect(channel.send).not.toHaveBeenCalled();
    expect(store.notifications).toHaveLength(0);
    expect(store.links).toHaveLength(0);
  });
});

// ALL-31: emailed notes.
describe("notify for the notes emails (ALL-31)", () => {
  const deps = (store: FakeStore, channels: Channel[]) => ({ store, channels, baseUrl: BASE, now: NOW });
  const expiresAt = new Date(NOW.getTime() + HOUR);
  const NOTES = "notes@in.example.test";

  it("saves personId on the notification row", async () => {
    const store = storeWithUser();
    const { channel } = fakeChannel("email", { ok: true, id: "msg-1" });
    await notify({ userId: USER, personId: "p-1", kind: "notes_tip", data: { personName: "Dad" }, links: {} }, deps(store, [channel]));
    expect(store.notifications[0]).toMatchObject({ kind: "notes_tip", personId: "p-1" });
  });

  it("leaves personId null when not given", async () => {
    const store = storeWithUser();
    const { channel } = fakeChannel("email", { ok: true, id: "msg-1" });
    await sendTest(store, [channel]);
    expect(store.notifications[0].personId).toBeNull();
  });

  it("passes Reply-To for notes_tip (AC-15)", async () => {
    const store = storeWithUser();
    const { channel, sent } = fakeChannel("email", { ok: true, id: "msg-1" });
    await notify({ userId: USER, kind: "notes_tip", data: { personName: "Dad" }, links: {}, replyTo: NOTES }, deps(store, [channel]));
    expect(sent[0].replyTo).toBe(NOTES);
  });

  it("only lets a caller pass Reply-To for notes_tip (checked by pnpm typecheck)", () => {
    const ok: NotifyInput<"notes_tip">["replyTo"] = NOTES;
    // @ts-expect-error a buying email can't take a Reply-To (AC-13)
    const heads: NotifyInput<"heads_up">["replyTo"] = NOTES;
    // @ts-expect-error nor the question, whose replies would loop
    const who: NotifyInput<"who_is_this">["replyTo"] = NOTES;
    expect([ok, heads, who]).toHaveLength(3);
  });

  // AC-13: a reply to a buying email must never become a note (T18), whatever a caller passes.
  const purchaseKinds: NotificationKind[] = [
    "heads_up", "hold_funds", "hold_setup", "hold_address", "hold_trouble", "hold_unconfirmed",
    "ordered", "failed_late", "failed_several", "price_up", "out_of_stock", "too_late", "missed_on_us",
  ];
  it.each([...purchaseKinds, "who_is_this", "notes_not_read", "notes_cant_cancel"] as NotificationKind[])(
    "never sends Reply-To for %s, even when a caller passes one (AC-13)",
    async (kind) => {
      const store = storeWithUser();
      const { channel, sent } = fakeChannel("email", { ok: true, id: "msg-1" });
      const links = Object.fromEntries(Object.keys(SAMPLE_DATA[kind].links).map((k) => [k, { action: "open_person", expiresAt }]));
      const input = { userId: USER, kind, data: SAMPLE_DATA[kind].data, links, replyTo: NOTES } as unknown as NotifyInput<"test">;
      expect(await notify(input, deps(store, [channel]))).toEqual({ ok: true });
      expect(sent).toHaveLength(1);
      expect(sent[0].replyTo).toBeUndefined();
    },
  );

  it("turns a path link into a plain URL with no one-time token (who_is_this's Someone else)", async () => {
    const store = storeWithUser();
    const { channel, sent } = fakeChannel("email", { ok: true, id: "msg-1" });
    await notify(
      {
        userId: USER,
        kind: "who_is_this",
        data: { subject: "Fly rod", choices: [{ name: "Dad" }, { name: "Mom" }] },
        links: {
          choice0: { action: "file_note", expiresAt },
          choice1: { action: "file_note", expiresAt },
          someoneElse: { path: "/people" },
        },
      },
      deps(store, [channel]),
    );
    expect(sent[0].text).toContain(`Someone else: ${BASE}/people`);
    expect(sent[0].text).toMatch(new RegExp(`Dad: ${BASE}/a/[A-Za-z0-9_-]{43}`));
    expect(store.links.map((l) => l.action)).toEqual(["file_note", "file_note"]);
  });

  describe("threadable", () => {
    const tip = (store: FakeStore, channels: Channel[], threadable?: true) =>
      notify({ userId: USER, kind: "notes_tip", data: { personName: "Dad" }, links: {}, threadable }, deps(store, channels));

    it("saves the Message-ID the email went out with, as the channel reports it", async () => {
      const store = storeWithUser();
      const { channel } = fakeChannel("email", { ok: true, id: "msg-1" });
      channel.messageId = vi.fn(async (id: string) => `<${id}@email.example.test>`);
      await tip(store, [channel], true);
      expect(channel.messageId).toHaveBeenCalledWith("msg-1");
      expect(store.notifications[0]).toMatchObject({ providerMessageId: "msg-1", messageId: "<msg-1@email.example.test>" });
    });

    it("doesn't look the Message-ID up when not threadable", async () => {
      const store = storeWithUser();
      const { channel } = fakeChannel("email", { ok: true, id: "msg-1" });
      channel.messageId = vi.fn(async () => "<x@y>");
      await tip(store, [channel]);
      expect(channel.messageId).not.toHaveBeenCalled();
      expect(store.notifications[0].messageId).toBeNull();
    });

    it("still counts as sent when the Message-ID isn't known yet, and logs it by id", async () => {
      const log = vi.spyOn(console, "log").mockImplementation(() => {});
      try {
        const store = storeWithUser();
        const { channel } = fakeChannel("email", { ok: true, id: "msg-1" });
        channel.messageId = vi.fn(async () => null);
        expect(await tip(store, [channel], true)).toEqual({ ok: true });
        expect(store.notifications[0]).toMatchObject({ sentAt: NOW, messageId: null });
        const events = log.mock.calls.map((c) => JSON.parse(String(c[0])));
        expect(events).toContainEqual(
          expect.objectContaining({ event: "notify.message_id_missing", notification_id: store.notifications[0].id }),
        );
      } finally {
        log.mockRestore();
      }
    });
  });
});

describe("sendTestNotification", () => {
  it("sends the test email with a link that expires after test_action_link_hours", async () => {
    const store = storeWithUser();
    const { channel, sent } = fakeChannel("email", { ok: true, id: "msg-1" });

    const result = await sendTestNotification(USER, {
      store,
      channels: [channel],
      baseUrl: BASE,
      now: NOW,
    });

    expect(result).toEqual({ ok: true });
    expect(sent).toHaveLength(1);
    expect(store.notifications[0].kind).toBe("test");
    expect(store.links[0].action).toBe("test");
    expect(store.links[0].expiresAt).toEqual(new Date(NOW.getTime() + 24 * HOUR));
  });
});

describe("FakeStore.claimLink", () => {
  it("lets only one of two concurrent claims win", async () => {
    const store = storeWithUser();
    await store.insertLinks([
      {
        hash: "h",
        userId: USER,
        roundId: null,
        action: "test",
        expiresAt: new Date(NOW.getTime() + HOUR),
      },
    ]);
    const results = await Promise.all([
      store.claimLink("h", USER, NOW),
      store.claimLink("h", USER, NOW),
    ]);
    expect(results.filter(Boolean)).toHaveLength(1);
  });
});
