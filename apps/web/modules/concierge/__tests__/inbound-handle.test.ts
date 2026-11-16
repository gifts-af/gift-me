// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Extract } from "@/lib/ai/extract";
import type { NewCaptureRow } from "../capture/store";
import { handleInbound, type InboundDeps } from "../inbound/handle";
import type { Channel } from "../notify/channels";
import { FakeCaptureStore } from "./fake-capture-store";
import { FakeInboundStore } from "./fake-inbound-store";
import { FakeStore } from "./fake-store";

const USER = "user-1";
const DAD = "person-dad";
const BOB = "person-bob";
const NOW = new Date("2026-11-16T12:00:00Z");
const PNG = new Uint8Array([137, 80, 78, 71]);

type ApiEmail = {
  from: string;
  subject: string;
  text: string;
  headers: Record<string, string>;
  authentication: { spf: string; dkim: string; dmarc: string };
  attachments: { id: string; content_type: string; size: number }[];
};

const email = (over: Partial<ApiEmail> = {}): ApiEmail => ({
  from: "Aaron <Me@Example.com>",
  subject: "",
  text: "Dad wants a new fly rod",
  headers: {},
  authentication: { spf: "pass", dkim: "pass", dmarc: "pass" },
  attachments: [],
  ...over,
});

/** A capture store whose saved captures can be read back (the real one reads its own rows). */
class ReadableCaptureStore extends FakeCaptureStore {
  async insertCapture(row: NewCaptureRow) {
    const created = await super.insertCapture(row);
    this.captures.set(created.id, {
      id: created.id,
      personId: row.personId,
      status: "pending",
      relationship: "father",
      url: row.url ?? "",
      title: row.title,
      text: row.text,
      note: row.note,
      screenshotPath: null,
      screenshotType: "image/jpeg",
    });
    return created;
  }
}

let store: FakeInboundStore;
let captures: ReadableCaptureStore;
let notifyStore: FakeStore;
let sent: { subject: string; text: string; to: string; replyTo?: string }[];
let emails: Map<string, ApiEmail>;
let messageIds: Map<string, string>;
let fetched: string[];
let extract: ReturnType<typeof vi.fn<Extract>>;
let logs: Record<string, unknown>[];

function fakeFetch(url: string | URL | Request): Promise<Response> {
  const u = String(url);
  fetched.push(u);
  const json = (body: unknown) => new Response(JSON.stringify(body), { headers: { "content-type": "application/json" } });
  const attachments = u.match(/receiving\/([^/]+)\/attachments$/);
  if (attachments) {
    const e = emails.get(decodeURIComponent(attachments[1]));
    return Promise.resolve(
      json({ data: (e?.attachments ?? []).map((a) => ({ ...a, download_url: `https://cdn.example/${a.id}` })) }),
    );
  }
  const received = u.match(/receiving\/([^/]+)$/);
  if (received) {
    const e = emails.get(decodeURIComponent(received[1]));
    return Promise.resolve(e ? json(e) : new Response("{}", { status: 404 }));
  }
  if (u.startsWith("https://cdn.example/")) return Promise.resolve(new Response(PNG, { headers: { "content-type": "image/png" } }));
  const sentEmail = u.match(/api\.resend\.com\/emails\/([^/]+)$/);
  if (sentEmail) {
    const id = messageIds.get(decodeURIComponent(sentEmail[1]));
    return Promise.resolve(json(id ? { message_id: id } : {}));
  }
  return Promise.resolve(new Response("not found", { status: 404 }));
}

function deps(): InboundDeps {
  const channel: Channel = {
    name: "email",
    async send(e) {
      sent.push(e);
      return { ok: true, id: `resend-${sent.length}` };
    },
  };
  return {
    store,
    captureStore: () => captures,
    extract,
    resend: { apiKey: "re_test", fetch: fakeFetch as typeof fetch },
    notify: { store: notifyStore, channels: [channel], baseUrl: "https://giftsaf.test", now: NOW },
  };
}

function receive(id: string, e: ApiEmail) {
  emails.set(id, e);
  return handleInbound(id, deps());
}

const events = (name: string) => logs.filter((l) => l.event === name);

beforeEach(() => {
  store = new FakeInboundStore();
  store.accounts.set("me@example.com", USER);
  store.paid.add(USER);
  store.peopleOf.set(USER, [
    { id: DAD, name: "Dad" },
    { id: BOB, name: "Uncle Bob" },
  ]);
  captures = new ReadableCaptureStore();
  captures.userId = USER;
  captures.people.add(DAD).add(BOB);
  notifyStore = new FakeStore();
  notifyStore.recipients.set(USER, { email: "me@example.com", timezone: null });
  sent = [];
  emails = new Map();
  messageIds = new Map();
  fetched = [];
  extract = vi.fn<Extract>(async () => []);
  logs = [];
  vi.spyOn(console, "log").mockImplementation((line: string) => {
    logs.push(JSON.parse(line));
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("handleInbound: what it drops", () => {
  it("only logs when switched off, without fetching the email (AC-12)", async () => {
    store.isEnabled = false;
    expect(await receive("e1", email())).toBe("disabled");
    expect(fetched).toEqual([]);
    expect(events("inbound.ignored")).toMatchObject([{ email_id: "e1", reason: "disabled" }]);
  });

  it("drops an auto-reply and sends nothing (AC-11)", async () => {
    expect(await receive("e1", email({ headers: { "Auto-Submitted": "auto-replied" } }))).toBe("ignored");
    expect(events("inbound.ignored")).toMatchObject([{ reason: "auto_reply" }]);
    expect(sent).toEqual([]);
    expect(captures.rows).toEqual([]);
  });

  it("drops mail from an address that isn't an account, logging no address (AC-6)", async () => {
    expect(await receive("e1", email({ from: "stranger@example.com" }))).toBe("ignored");
    expect(events("inbound.ignored")).toEqual([
      expect.objectContaining({ email_id: "e1", reason: "unknown_sender" }),
    ]);
    expect(JSON.stringify(logs)).not.toContain("example.com");
    expect(sent).toEqual([]);
    expect(store.events).toEqual([]);
  });

  it("drops mail whose DMARC isn't pass even with DKIM and SPF passing, before looking up the account (AC-7)", async () => {
    const out = await receive("e1", email({ authentication: { spf: "pass", dkim: "pass", dmarc: "fail" } }));
    expect(out).toBe("ignored");
    expect(events("inbound.ignored")).toMatchObject([{ reason: "unverified" }]);
    expect(store.calls).not.toContain("userByEmail");
    expect(sent).toEqual([]);
  });

  it("drops the next message once the daily cap is reached (AC-11)", async () => {
    for (let i = 0; i < 20; i++) await store.recordEvent(USER);
    expect(await receive("e1", email())).toBe("capped");
    expect(events("inbound.ignored")).toMatchObject([{ reason: "capped", user_id: USER }]);
    expect(captures.rows).toEqual([]);
    expect(sent).toEqual([]);
  });

  it("keeps nothing for an unpaid user and replies once across two notes (AC-10)", async () => {
    store.paid.clear();
    expect(await receive("e1", email())).toBe("unpaid");
    expect(await receive("e2", email({ text: "Uncle Bob likes jazz" }))).toBe("unpaid");
    expect(sent.map((s) => s.subject)).toEqual(["We didn't read your note"]);
    expect(notifyStore.notifications.map((n) => n.kind)).toEqual(["notes_not_read"]);
    expect(captures.rows).toEqual([]);
    expect(store.asking).toEqual([]);
    expect(extract).not.toHaveBeenCalled();
    // Only the reply counts toward the cap.
    expect(store.events).toEqual([USER]);
  });
});

describe("handleInbound: filing", () => {
  it("files a note naming one person and reads it (AC-1)", async () => {
    expect(await receive("e1", email({ subject: "Idea", text: "Dad wants a new fly rod" }))).toBe("filed");
    expect(captures.rows).toMatchObject([{ personId: DAD, url: null, title: "Idea", text: "Dad wants a new fly rod" }]);
    expect(extract).toHaveBeenCalledOnce();
    expect(events("inbound.filed")).toMatchObject([{ person_id: DAD, matched_by: "name" }]);
    expect(store.events).toEqual([USER]);
    expect(sent).toEqual([]);
  });

  it("files a forwarded product email with its photo as the screenshot (AC-2)", async () => {
    const out = await receive(
      "e1",
      email({
        subject: "Fwd: Your fly rod is back in stock",
        text: "For Dad\n\n---------- Forwarded message ----------\nFrom: shop@example.com\nThe rod is back.",
        attachments: [
          { id: "att-pdf", content_type: "application/pdf", size: 100 },
          { id: "att-png", content_type: "image/png", size: PNG.length },
        ],
      }),
    );
    expect(out).toBe("filed");
    const [row] = captures.rows;
    expect(row).toMatchObject({ personId: DAD, screenshotType: "image/png" });
    expect(row.screenshotPath).toMatch(/\.png$/);
    expect(row.text).toContain("The rod is back.");
    expect(row.text).not.toContain("shop@example.com");
    expect(row.text).not.toMatch(/^From:/m);
  });

  it("cuts the text to the capture limit", async () => {
    captures.limitValues = { ...captures.limitValues, textMaxChars: 10 };
    await receive("e1", email({ text: "Dad wants a new fly rod" }));
    expect(captures.rows[0].text).toBe("Dad wants ");
  });

  it("files a reply by its In-Reply-To with no name search, without the quoted text (AC-5)", async () => {
    store.notifications.push({ id: "n1", userId: USER, personId: DAD, providerMessageId: "r1", messageId: "abc@ses.example" });
    const out = await receive(
      "e1",
      email({
        subject: "Re: Did you know?",
        // Names Uncle Bob, but the reply is to Dad's email.
        text: "He'd love a fly rod, Uncle Bob says so\n\nOn Mon, Nov 16, 2026 GiftsAF wrote:\n> Reply to this with anything you learn about Dad",
        headers: { "In-Reply-To": "<abc@ses.example>" },
      }),
    );
    expect(out).toBe("filed");
    expect(captures.rows).toMatchObject([{ personId: DAD, text: "He'd love a fly rod, Uncle Bob says so" }]);
    expect(captures.rows[0].text).not.toContain("Reply to this");
    expect(store.calls).not.toContain("people");
    expect(events("inbound.filed")).toMatchObject([{ matched_by: "reply" }]);
  });

  it("reads Message-IDs back from Resend when none matches yet, and saves them", async () => {
    store.notifications.push(
      { id: "n1", userId: USER, personId: BOB, providerMessageId: "r1", messageId: null },
      { id: "n2", userId: USER, personId: DAD, providerMessageId: "r2", messageId: null },
    );
    messageIds.set("r1", "<bob@ses.example>");
    messageIds.set("r2", "<dad@ses.example>");
    const out = await receive("e1", email({ text: "socks please", headers: { "In-Reply-To": "<dad@ses.example>" } }));
    expect(out).toBe("filed");
    expect(captures.rows).toMatchObject([{ personId: DAD }]);
    expect(store.notifications.map((n) => n.messageId)).toEqual(["<bob@ses.example>", "<dad@ses.example>"]);
    expect(fetched).toContain("https://api.resend.com/emails/r2");
    expect(store.calls).not.toContain("people");
  });

  it("falls back to names when the In-Reply-To matches nothing", async () => {
    const out = await receive("e1", email({ text: "Dad likes tea", headers: { "In-Reply-To": "<other@x>" } }));
    expect(out).toBe("filed");
    expect(store.calls).toContain("people");
  });

  it("files a 'don't buy' note and says replies can't cancel (AC-14)", async () => {
    expect(await receive("e1", email({ text: "Don't buy Dad socks anymore" }))).toBe("cancel_reply");
    expect(captures.rows).toHaveLength(1);
    expect(sent.map((s) => s.subject)).toEqual(["Replies can't cancel a gift"]);
    expect(store.events).toEqual([USER, USER]);
  });

  it("reads back only as many sent emails as inbound_thread_lookup_max allows", async () => {
    store.config = { ...store.config, threadLookupMax: 1 };
    store.notifications.push(
      { id: "n1", userId: USER, personId: BOB, providerMessageId: "r1", messageId: null },
      { id: "n2", userId: USER, personId: DAD, providerMessageId: "r2", messageId: null },
    );
    messageIds.set("r1", "<bob@ses.example>");
    messageIds.set("r2", "<dad@ses.example>");
    await receive("e1", email({ text: "socks please", headers: { "In-Reply-To": "<dad@ses.example>" } }));
    expect(fetched).not.toContain("https://api.resend.com/emails/r2");
    expect(store.calls).toContain("people");
  });

  it("fails, not ignores, when saving the capture fails", async () => {
    captures.failInsert = true;
    expect(await receive("e1", email())).toBe("failed");
    expect(events("inbound.failed")).toMatchObject([{ email_id: "e1", user_id: USER, status: 500 }]);
    expect(events("inbound.ignored")).toEqual([]);
  });

  it("fails when a store call throws after accepting", async () => {
    store.people = async () => {
      throw new Error("db down");
    };
    expect(await receive("e1", email({ text: "a fly rod" }))).toBe("failed");
    expect(events("inbound.failed")).toMatchObject([{ email_id: "e1", user_id: USER, name: "Error" }]);
  });

  it("keeps a filed note when reading it fails", async () => {
    extract.mockRejectedValue(new Error("model down"));
    expect(await receive("e1", email())).toBe("filed");
    expect(captures.rows).toHaveLength(1);
  });
});

describe("handleInbound: asking", () => {
  it("asks about a note naming two people, with a one-time button for each (AC-3)", async () => {
    const out = await receive(
      "e1",
      email({
        subject: "Ideas",
        text: "Dad and Uncle Bob both fish",
        attachments: [{ id: "att-png", content_type: "image/png", size: PNG.length }],
      }),
    );
    expect(out).toBe("asking");
    expect(captures.rows).toEqual([]);
    expect(store.asking).toMatchObject([{ userId: USER, subject: "Ideas", body: "Dad and Uncle Bob both fish", imageType: "image/png" }]);
    const [msg] = store.asking;
    expect(msg.imagePath).toMatch(new RegExp(`^${USER}/.+\\.png$`));
    expect(store.uploads.get(msg.imagePath!)).toEqual({ bytes: PNG, type: "image/png" });

    expect(sent.map((s) => s.subject)).toEqual(["Who is your note about?"]);
    expect(sent[0].replyTo).toBeUndefined();
    const expiry = new Date(NOW.getTime() + 72 * 3600 * 1000);
    expect(notifyStore.links).toMatchObject([
      { action: "file_note", personId: DAD, inboundMessageId: msg.id, expiresAt: expiry },
      { action: "file_note", personId: BOB, inboundMessageId: msg.id, expiresAt: expiry },
    ]);
    expect(sent[0].text).toContain("Dad");
    expect(sent[0].text).toContain("Uncle Bob");
    expect(sent[0].text).toContain("https://giftsaf.test/people");
    expect(store.events).toEqual([USER, USER]);
  });

  it("offers everyone, up to the most choices, when the note names nobody (AC-3)", async () => {
    store.config = { ...store.config, maxChoices: 1 };
    expect(await receive("e1", email({ text: "a fly rod" }))).toBe("asking");
    expect(notifyStore.links).toMatchObject([{ personId: DAD }]);
  });

  it("asks with only \"Someone else\" when the user has no people", async () => {
    store.peopleOf.set(USER, []);
    expect(await receive("e1", email({ text: "a fly rod" }))).toBe("asking");
    expect(notifyStore.links).toEqual([]);
    expect(sent).toHaveLength(1);
    expect(sent[0].text).toContain("Someone else");
    expect(sent[0].text).toContain("https://giftsaf.test/people");
    expect(sent[0].text).not.toContain("/a/");
  });

  it("saves the asking body without forwarded headers or addresses (T42)", async () => {
    const text = ["a fly rod", "---------- Forwarded message ----------", "From: shop@example.com", "To: me@example.com", "In stock, ask help@shop.example"].join("\n");
    expect(await receive("e1", email({ text }))).toBe("asking");
    expect(store.asking[0].body).toBe(["a fly rod", "---------- Forwarded message ----------", "In stock, ask [email]"].join("\n"));
  });

  it("cuts the asking body to the capture limit", async () => {
    captures.limitValues = { ...captures.limitValues, textMaxChars: 5 };
    await receive("e1", email({ text: "a fly rod" }));
    expect(store.asking[0].body).toBe("a fly");
  });
});

describe("handleInbound: mail loops", () => {
  it("doesn't send a reply that would go over the daily cap (AC-11)", async () => {
    for (let i = 0; i < 19; i++) await store.recordEvent(USER);
    expect(await receive("e1", email({ text: "Don't buy Dad socks anymore" }))).toBe("cancel_reply");
    expect(store.events.length).toBeLessThanOrEqual(20);
    expect(sent).toEqual([]);
    expect(events("inbound.reply_capped")).toMatchObject([{ email_id: "e1", kind: "notes_cant_cancel" }]);
  });

  it("drops the asking note and its image when \"Who is this about?\" would go over the cap", async () => {
    for (let i = 0; i < 19; i++) await store.recordEvent(USER);
    const out = await receive(
      "e1",
      email({ text: "a fly rod", attachments: [{ id: "att-png", content_type: "image/png", size: PNG.length }] }),
    );
    expect(out).toBe("capped");
    expect(sent).toEqual([]);
    expect(notifyStore.links).toEqual([]);
    expect(store.asking).toEqual([]);
    expect(store.uploads.size).toBe(0);
    expect(events("inbound.reply_capped")).toMatchObject([{ email_id: "e1", kind: "who_is_this" }]);
    expect(events("inbound.ask_capped")).toEqual([
      expect.objectContaining({ email_id: "e1", user_id: USER, inbound_message_id: "msg-1" }),
    ]);
  });

  it("keeps the asking row for the daily clear-out when removing its image fails", async () => {
    for (let i = 0; i < 19; i++) await store.recordEvent(USER);
    store.removeImage = async () => {
      throw new Error("storage down");
    };
    const out = await receive(
      "e1",
      email({ text: "a fly rod", attachments: [{ id: "att-png", content_type: "image/png", size: PNG.length }] }),
    );
    expect(out).toBe("capped");
    expect(store.asking).toHaveLength(1);
    expect(events("inbound.ask_capped")).toMatchObject([{ inbound_message_id: "msg-1", name: "Error" }]);
  });

  it("sends at most the daily cap back across 25 messages (AC-11)", async () => {
    for (let i = 0; i < 25; i++) await receive(`e${i}`, email({ text: "no names here" }));
    expect(sent.length).toBeLessThanOrEqual(20);
    expect(store.events.length).toBeLessThanOrEqual(20);
    expect(events("inbound.ignored").every((e) => e.reason === "capped")).toBe(true);
  });
});
