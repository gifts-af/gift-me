import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sendNotesTipOnce, type TipDeps } from "../inbound/tip";
import type { Channel } from "../notify/channels";
import { FakeInboundStore } from "./fake-inbound-store";
import { FakeStore } from "./fake-store";

const USER = "user-1";
const NOTES = "notes@in.giftsaf.test";
const NOW = new Date("2026-11-16T12:00:00Z");

let inbound: FakeInboundStore;
let notifyStore: FakeStore;
let sent: { to: string; subject: string; replyTo?: string }[];
let sendResult: { ok: true; id: string } | { ok: false; error: string };
let logs: string[];

function deps(): TipDeps {
  const channel: Channel = {
    name: "email",
    async send(e) {
      sent.push(e as never);
      return sendResult;
    },
  };
  return {
    store: inbound,
    notify: { store: notifyStore, channels: [channel], baseUrl: "https://giftsaf.test", now: NOW },
    notesAddress: NOTES,
  };
}

beforeEach(() => {
  inbound = new FakeInboundStore();
  inbound.paid.add(USER);
  notifyStore = new FakeStore();
  notifyStore.recipients.set(USER, { email: "me@example.com", timezone: "America/New_York" });
  sent = [];
  sendResult = { ok: true, id: "resend-1" };
  logs = [];
  vi.spyOn(console, "log").mockImplementation((line: unknown) => void logs.push(String(line)));
});
afterEach(() => vi.restoreAllMocks());

describe("sendNotesTipOnce (AC-15)", () => {
  it("sends one tip naming the first person, with Reply-To and the person saved", async () => {
    await sendNotesTipOnce(USER, { id: "p1", name: "Dad" }, deps());
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ to: "me@example.com", replyTo: NOTES });
    expect(JSON.stringify(sent[0])).toContain("Dad");
    expect(notifyStore.notifications[0]).toMatchObject({ kind: "notes_tip", personId: "p1", userId: USER });
  });

  it("sends nothing for the second person", async () => {
    await sendNotesTipOnce(USER, { id: "p1", name: "Dad" }, deps());
    await sendNotesTipOnce(USER, { id: "p2", name: "Mom" }, deps());
    expect(sent).toHaveLength(1);
  });

  it("sends nothing to an unpaid account and leaves the flag unclaimed", async () => {
    inbound.paid.delete(USER);
    await sendNotesTipOnce(USER, { id: "p1", name: "Dad" }, deps());
    expect(sent).toHaveLength(0);
    expect(inbound.flags.size).toBe(0);
  });

  it("sends nothing while inbound email is off and leaves the flag unclaimed", async () => {
    inbound.isEnabled = false;
    await sendNotesTipOnce(USER, { id: "p1", name: "Dad" }, deps());
    expect(sent).toHaveLength(0);
    expect(inbound.flags.size).toBe(0);
  });

  it("logs a failed send and does not throw", async () => {
    sendResult = { ok: false, error: "resend down" };
    await expect(sendNotesTipOnce(USER, { id: "p1", name: "Dad" }, deps())).resolves.toBeUndefined();
    expect(logs.join("\n")).toContain("inbound.tip_failed");
  });

  it("logs when the claim itself throws, and does not throw", async () => {
    inbound.claimFlag = async () => {
      throw new Error("db down");
    };
    await expect(sendNotesTipOnce(USER, { id: "p1", name: "Dad" }, deps())).resolves.toBeUndefined();
    expect(logs.join("\n")).toContain("inbound.tip_failed");
    expect(sent).toHaveLength(0);
  });
});
