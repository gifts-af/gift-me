// @vitest-environment node
// The "Who is this about?" buttons (ALL-31 Task 8, AC-4): file_note through the action-link
// flow, on the in-memory stores. The real file_inbound_message and the link columns are
// covered against the database in notify-store.test.ts.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Extract } from "@/lib/ai/extract";
import type { NoteDeps } from "../notify/actions";
import type { Channel } from "../notify/channels";
import { confirmActionLink, readActionLink, type LinkDeps } from "../notify/links";
import { hashActionToken } from "../notify/tokens";
import { FakeCaptureStore } from "./fake-capture-store";
import { FakeInboundStore } from "./fake-inbound-store";
import { FakeStore } from "./fake-store";

const USER = "user-1";
const DAD = "person-dad";
const BOB = "person-bob";
const MESSAGE = "msg-1";
const NOW = new Date("2026-11-16T12:00:00Z");
const LATER = new Date(NOW.getTime() + 72 * 60 * 60 * 1000);

let store: FakeStore;
let captures: FakeCaptureStore;
let inbound: FakeInboundStore;
let extract: ReturnType<typeof vi.fn<Extract>>;
let sent: { subject: string; to: string }[];
let logs: Record<string, unknown>[];
let deps: LinkDeps;

/** One file_note button per person, for the one asking message. */
async function buttons(note: string) {
  store.asking.set(MESSAGE, { userId: USER, text: note, filedTo: null });
  await store.insertLinks(
    [DAD, BOB].map((personId) => ({
      hash: hashActionToken(`tok-${personId}`),
      userId: USER,
      roundId: null,
      action: "file_note" as const,
      expiresAt: LATER,
      personId,
      inboundMessageId: MESSAGE,
    })),
  );
}

beforeEach(() => {
  store = new FakeStore();
  store.recipients.set(USER, { email: "me@example.com", timezone: null });
  store.people.set(DAD, { userId: USER, name: "Dad" });
  store.people.set(BOB, { userId: USER, name: "Bob" });
  captures = new FakeCaptureStore();
  // Filing hands the capture to the capture store, as the real one reads its own rows.
  store.onFiled = ({ captureId, personId, text }) => {
    captures.captures.set(captureId, {
      id: captureId,
      personId,
      status: "pending",
      relationship: "father",
      url: "",
      title: "",
      text,
      note: null,
      screenshotPath: null,
      screenshotType: "image/jpeg",
    });
  };
  extract = vi.fn<Extract>(async () => [{ category: "wants", value: "a new fly rod", confidence: 0.9 }]);
  sent = [];
  const channel: Channel = {
    name: "email",
    async send(msg) {
      sent.push({ subject: msg.subject, to: msg.to });
      return { ok: true, id: `p${sent.length}` };
    },
  };
  inbound = new FakeInboundStore();
  const notes: NoteDeps = {
    captureStore: () => captures,
    extract,
    inbound,
    notify: { store, channels: [channel], baseUrl: "https://giftsaf.test", now: NOW },
  };
  deps = { store, now: NOW, notes: () => notes };
  logs = [];
  vi.spyOn(console, "log").mockImplementation((line: string) => {
    logs.push(JSON.parse(line));
  });
});

afterEach(() => vi.restoreAllMocks());

describe("file_note (ALL-31 AC-4)", () => {
  it("names the person on the confirm page", async () => {
    await buttons("wants a new fly rod");
    expect(await readActionLink("tok-person-dad", USER, deps)).toEqual({
      state: "confirm",
      confirm: {
        title: "File this note to Dad?",
        body: "We'll add it to Dad's page and read it for gift ideas.",
        button: "File it",
      },
    });
  });

  it("files the note to the tapped person and reads it, then opens their page", async () => {
    await buttons("wants a new fly rod");
    const result = await confirmActionLink("tok-person-dad", USER, deps);
    expect(result).toEqual({ state: "done", done: { title: "Filed", body: "Your note is on their page." }, next: `/people/${DAD}` });
    expect(store.filed).toEqual([`cap-1:${DAD}`]);
    expect(extract).toHaveBeenCalledTimes(1);
    expect(captures.captures.get("cap-1")?.status).toBe("extracted");
    expect(captures.facts.map((f) => f.value)).toEqual(["a new fly rod"]);
    expect(logs).toContainEqual(expect.objectContaining({ event: "inbound.filed", capture_id: "cap-1", person_id: DAD }));
    // Not a cancel-looking note: nothing emailed back.
    expect(sent).toEqual([]);
  });

  it("a phone or address in the asked-about note never reaches the AI (T42, ALL-134)", async () => {
    await buttons("wants a fly rod, ship to 12 Elm St, call (555) 123-4567");
    await confirmActionLink("tok-person-dad", USER, deps);
    expect(extract).toHaveBeenCalledTimes(1);
    expect(extract.mock.calls[0][0].text).toBe("wants a fly rod, ship to [contact removed], call [contact removed]");
  });

  it("another button afterwards says it's already filed and creates nothing", async () => {
    await buttons("wants a new fly rod");
    await confirmActionLink("tok-person-dad", USER, deps);
    extract.mockClear();
    const result = await confirmActionLink("tok-person-bob", USER, deps);
    expect(result).toMatchObject({
      state: "done",
      done: { title: "Already filed", body: "This note was already added to someone's page, so nothing changed." },
    });
    // The note went to Dad, so the button doesn't open Bob's page.
    expect(result).not.toHaveProperty("next");
    expect(store.filed).toEqual([`cap-1:${DAD}`]);
    expect(extract).not.toHaveBeenCalled();
  });

  it("the same button again says used and runs nothing", async () => {
    await buttons("wants a new fly rod");
    await confirmActionLink("tok-person-dad", USER, deps);
    expect(await confirmActionLink("tok-person-dad", USER, deps)).toEqual({ state: "used" });
    expect(store.filed).toHaveLength(1);
  });

  it("can't pick a person deleted after the email", async () => {
    await buttons("wants a new fly rod");
    store.people.delete(DAD);
    const view = await readActionLink("tok-person-dad", USER, deps);
    expect(view).toEqual({
      state: "confirm",
      confirm: { title: "File this note?", body: "Confirm to add your note to this person's page.", button: "File it" },
    });
    const result = await confirmActionLink("tok-person-dad", USER, deps);
    // Done page with no link to the removed person's page.
    expect(result).toEqual({
      state: "done",
      done: {
        title: "They were removed",
        body: "That person was removed, so the note wasn't filed. Use another button in the email, or add them again first.",
      },
    });
    expect(store.filed).toEqual([]);
    // The note is still waiting: another button files it.
    expect(await confirmActionLink("tok-person-bob", USER, deps)).toMatchObject({ done: { title: "Filed" } });
    expect(store.filed).toEqual([`cap-1:${BOB}`]);
  });

  it("a failed read still leaves the note filed", async () => {
    await buttons("wants a new fly rod");
    extract.mockRejectedValue(new Error("gateway down"));
    const result = await confirmActionLink("tok-person-dad", USER, deps);
    expect(result).toMatchObject({ state: "done", done: { title: "Filed" }, next: `/people/${DAD}` });
    expect(store.filed).toEqual([`cap-1:${DAD}`]);
    expect(captures.captures.get("cap-1")?.status).toBe("failed");
  });

  it("a read that throws outright is logged with ids only and the note stays filed", async () => {
    await buttons("wants a new fly rod");
    captures.extractionSettings = async () => {
      throw new Error("db down");
    };
    const result = await confirmActionLink("tok-person-dad", USER, deps);
    expect(result).toMatchObject({ state: "done", done: { title: "Filed" } });
    expect(store.filed).toHaveLength(1);
    const failed = logs.find((l) => l.event === "inbound.read_failed");
    expect(failed).toMatchObject({ capture_id: "cap-1", person_id: DAD, user_id: USER });
    expect(JSON.stringify(failed)).not.toContain("fly rod");
  });

  it("emails once that replies can't cancel a gift when the note sounds like stopping one, counted toward the cap (AC-14, AC-11)", async () => {
    await buttons("Don't buy him socks anymore");
    inbound.events = Array(19).fill(USER);
    expect(await confirmActionLink("tok-person-dad", USER, deps)).toMatchObject({ done: { title: "Filed" } });
    expect(sent).toEqual([{ subject: "Replies can't cancel a gift", to: "me@example.com" }]);
    expect(inbound.events).toHaveLength(20);
  });

  it("sends no can't-cancel email at the daily cap, and still files (AC-11)", async () => {
    await buttons("Don't buy him socks anymore");
    inbound.events = Array(20).fill(USER);
    expect(await confirmActionLink("tok-person-dad", USER, deps)).toMatchObject({ done: { title: "Filed" } });
    expect(store.filed).toEqual([`cap-1:${DAD}`]);
    expect(sent).toEqual([]);
    expect(inbound.events).toHaveLength(20);
    expect(logs).toContainEqual(
      expect.objectContaining({ event: "inbound.reply_capped", user_id: USER, kind: "notes_cant_cancel", capture_id: "cap-1" }),
    );
  });

  it("says they were removed when the person is deleted between the check and filing", async () => {
    await buttons("wants a new fly rod");
    const file = store.fileInboundMessage.bind(store);
    store.fileInboundMessage = async (userId, messageId, personId) => {
      store.people.delete(DAD);
      return file(userId, messageId, personId);
    };
    const result = await confirmActionLink("tok-person-dad", USER, deps);
    expect(result).toEqual({ state: "done", done: expect.objectContaining({ title: "They were removed" }) });
    expect(store.filed).toEqual([]);
  });

  it("when the filed note can't be read back: logged with ids only, done, and left pending for Try again", async () => {
    await buttons("wants a new fly rod");
    captures.loadCapture = async () => {
      throw new Error("db down");
    };
    const result = await confirmActionLink("tok-person-dad", USER, deps);
    expect(result).toMatchObject({ state: "done", done: { title: "Filed" }, next: `/people/${DAD}` });
    expect(store.filed).toEqual([`cap-1:${DAD}`]);
    expect(extract).not.toHaveBeenCalled();
    expect(captures.captures.get("cap-1")?.status).toBe("pending");
    const failed = logs.find((l) => l.event === "inbound.failed");
    expect(failed).toMatchObject({ capture_id: "cap-1", person_id: DAD, user_id: USER, name: "Error" });
    expect(JSON.stringify(failed)).not.toContain("fly rod");
  });

  it("refuses without the note deps rather than filing unread", async () => {
    await buttons("wants a new fly rod");
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    expect(await confirmActionLink("tok-person-dad", USER, { store, now: NOW })).toEqual({ state: "invalid" });
    expect(store.filed).toEqual([]);
    expect(JSON.parse(String(log.mock.calls.at(-1)?.[0]))).toMatchObject({ event: "action_link.failed", user_id: USER });
  });
});
