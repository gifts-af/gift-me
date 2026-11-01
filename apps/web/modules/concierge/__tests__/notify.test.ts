import { describe, expect, it, vi } from "vitest";
import type { Channel } from "../notify/channels";
import { notify, sendTestNotification } from "../notify/notify";
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
